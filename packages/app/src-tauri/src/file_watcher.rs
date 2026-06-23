// M6-05: File system watcher
//
// Monitors the notebook directory for changes (create, modify, delete, rename)
// and emits events to the frontend via Tauri's event system.

use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use tauri::{AppHandle, Emitter};

/// File change event emitted to the frontend.
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub kind: String,             // "create" | "modify" | "remove" | "rename"
    pub path: String,             // relative path within notebook
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

            // Watch notes and supported image assets.
            let is_supported = event.paths.iter().any(is_supported_path);
            if !is_supported {
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
    let path_for = |path: &PathBuf| -> Option<String> {
        path.strip_prefix(root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
    };

    if let EventKind::Modify(ModifyKind::Name(ref mode)) = event.kind {
        let (old_path, new_path) = match mode {
            RenameMode::Both => (
                event.paths.first().and_then(path_for),
                event.paths.get(1).and_then(path_for),
            ),
            RenameMode::To => (None, event.paths.first().and_then(path_for)),
            RenameMode::From => return None,
            _ => (
                event.paths.first().and_then(path_for),
                event.paths.last().and_then(path_for),
            ),
        };

        return Some(FileChangeEvent {
            kind: "rename".to_string(),
            path: new_path?,
            old_path,
        });
    }

    let path = event.paths.first().and_then(path_for)?;

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
        _ => return None,
    };

    Some(FileChangeEvent {
        kind: kind.to_string(),
        path,
        old_path: None,
    })
}

fn is_supported_path(path: &PathBuf) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase()),
        Some(ext)
            if matches!(
                ext.as_str(),
                "md" | "markdown" | "txt" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp"
            )
    )
}

/// Stop watching. Called when the app closes.
pub fn stop_watching() {
    // Watcher is dropped when the app exits.
    // The thread will terminate when the channel closes.
}

#[tauri::command]
pub fn start_file_watcher(app_handle: AppHandle, root_path: String) -> Result<(), String> {
    let path = PathBuf::from(&root_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("无效的监控路径: {}", root_path));
    }
    start_watching(app_handle, path)
}
