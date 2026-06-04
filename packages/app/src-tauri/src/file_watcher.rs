// M6-05: File system watcher
//
// Monitors the notebook directory for changes (create, modify, delete, rename)
// and emits events to the frontend via Tauri's event system.

use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use tauri::{AppHandle, Emitter};

/// File change event emitted to the frontend.
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub kind: String,       // "create" | "modify" | "remove" | "rename"
    pub path: String,       // relative path within notebook
    pub old_path: Option<String>, // for rename events
}

/// Start watching a directory for file changes.
/// Events are emitted to the frontend via the `file-change` event.
pub fn start_watching(app_handle: AppHandle, root_path: PathBuf) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let _ = tx.send(res);
    })
    .map_err(|e| format!("创建文件监控失败: {}", e))?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("启动文件监控失败: {}", e))?;

    // Spawn a thread to process events
    thread::spawn(move || {
        for event_result in rx {
            let event = match event_result {
                Ok(e) => e,
                Err(_) => continue,
            };

            // Only watch .md files
            let is_md = event.paths.iter().any(|p| {
                p.extension()
                    .map(|e| e == "md")
                    .unwrap_or(false)
            });
            if !is_md {
                continue;
            }

            let change_event = event_to_change_event(&event, &root_path);

            if let Some(ce) = change_event {
                let _ = app_handle.emit("file-change", ce);
            }
        }
    });

    // Keep watcher alive by leaking it (it lives for the app lifetime)
    std::mem::forget(watcher);

    Ok(())
}

/// Convert a notify Event to our simplified FileChangeEvent.
fn event_to_change_event(event: &Event, root: &PathBuf) -> Option<FileChangeEvent> {
    let path = event
        .paths
        .first()?
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");

    let kind = match event.kind {
        EventKind::Create(ref c) => match c {
            CreateKind::File => "create",
            CreateKind::Folder => return None, // skip folders
            _ => return None,
        },
        EventKind::Modify(ref m) => match m {
            ModifyKind::Data(_) | ModifyKind::Metadata(_) => "modify",
            _ => return None,
        },
        EventKind::Remove(_) => "remove",
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            // Rename: path is the new name
            let old_path = event.paths.get(1).map(|p| {
                p.strip_prefix(root)
                    .ok()
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default()
            });
            return Some(FileChangeEvent {
                kind: "rename".to_string(),
                path,
                old_path,
            });
        }
        _ => return None,
    };

    Some(FileChangeEvent {
        kind: kind.to_string(),
        path,
        old_path: None,
    })
}

/// Stop watching. Called when the app closes.
pub fn stop_watching() {
    // Watcher is dropped when the app exits.
    // The thread will terminate when the channel closes.
}

#[tauri::command]
pub fn start_file_watcher(
    app_handle: AppHandle,
    root_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("无效的监控路径: {}", root_path));
    }
    start_watching(app_handle, path)
}
