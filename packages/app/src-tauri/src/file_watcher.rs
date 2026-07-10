// M6-05: File system watcher
//
// Monitors the active notebook directory for changes and emits simplified
// events to the frontend. The watcher is a replaceable singleton so switching
// notebooks does not leak OS watcher handles.

use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// File change event emitted to the frontend.
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub kind: String,             // "create" | "modify" | "remove" | "rename"
    pub path: String,             // relative path within notebook
    pub old_path: Option<String>, // for rename events
}

pub struct FileWatcherState {
    guard: Mutex<Option<WatcherGuard>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            guard: Mutex::new(None),
        }
    }

    fn replace(&self, guard: WatcherGuard) -> Result<(), String> {
        let mut current = self
            .guard
            .lock()
            .map_err(|_| "file watcher state lock poisoned".to_string())?;
        if let Some(existing) = current.take() {
            existing.stop();
        }
        *current = Some(guard);
        Ok(())
    }

    fn stop(&self) -> Result<bool, String> {
        let mut current = self
            .guard
            .lock()
            .map_err(|_| "file watcher state lock poisoned".to_string())?;
        let Some(existing) = current.take() else {
            return Ok(false);
        };
        existing.stop();
        Ok(true)
    }
}

struct WatcherGuard {
    stop_tx: mpsc::Sender<()>,
}

impl WatcherGuard {
    fn stop(self) {
        let _ = self.stop_tx.send(());
    }
}

/// Start watching a directory for file changes.
/// Events are emitted to the frontend via the `file-change` event.
fn start_watching(app_handle: AppHandle, root_path: PathBuf) -> Result<WatcherGuard, String> {
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let _ = tx.send(res);
    })
    .map_err(|e| format!("failed to create file watcher: {e}"))?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("failed to start file watcher: {e}"))?;

    thread::spawn(move || {
        let _watcher = watcher;

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            let event_result = match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(result) => result,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };

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

    Ok(WatcherGuard { stop_tx })
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
                "md" | "markdown" | "mdx" | "txt" | "png" | "jpg" | "jpeg" | "gif" | "webp"
                | "svg" | "bmp"
            )
    )
}

#[tauri::command]
pub fn start_file_watcher(
    app_handle: AppHandle,
    state: State<'_, FileWatcherState>,
    root_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("invalid watcher root path: {root_path}"));
    }
    let guard = start_watching(app_handle, path)?;
    state.replace(guard)
}

#[tauri::command]
pub fn stop_file_watcher(state: State<'_, FileWatcherState>) -> Result<(), String> {
    let _ = state.stop()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard_with_receiver() -> (WatcherGuard, mpsc::Receiver<()>) {
        let (stop_tx, stop_rx) = mpsc::channel();
        (WatcherGuard { stop_tx }, stop_rx)
    }

    #[test]
    fn replacing_watcher_stops_previous_guard() {
        let state = FileWatcherState::new();
        let (first, first_rx) = guard_with_receiver();
        let (second, _second_rx) = guard_with_receiver();

        state.replace(first).unwrap();
        state.replace(second).unwrap();

        assert!(first_rx.recv_timeout(Duration::from_millis(200)).is_ok());
    }

    #[test]
    fn stopping_idle_watcher_is_noop() {
        let state = FileWatcherState::new();

        assert!(!state.stop().unwrap());
    }

    #[test]
    fn stopping_active_watcher_sends_stop_signal() {
        let state = FileWatcherState::new();
        let (guard, stop_rx) = guard_with_receiver();

        state.replace(guard).unwrap();

        assert!(state.stop().unwrap());
        assert!(stop_rx.recv_timeout(Duration::from_millis(200)).is_ok());
    }
}
