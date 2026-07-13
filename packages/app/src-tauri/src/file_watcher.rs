// M6-05: File system watcher
//
// Monitors the active notebook directory for changes and emits simplified
// events to the frontend. The watcher is a replaceable singleton so switching
// notebooks does not leak OS watcher handles.

use crate::fs_ops::{ExternalAccessGrants, NotebookRoot};
use notify::event::{CreateKind, ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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
    pub generation: u64,
}

pub struct FileWatcherState {
    guard: Mutex<Option<WatcherGuard>>,
    generation: AtomicU64,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            guard: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }

    fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::Relaxed) + 1
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
    join: Option<thread::JoinHandle<()>>,
}

impl WatcherGuard {
    fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Start watching a directory for file changes.
/// Events are emitted to the frontend via the `file-change` event.
fn start_watching(
    app_handle: AppHandle,
    root_path: PathBuf,
    generation: u64,
) -> Result<WatcherGuard, String> {
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let _ = tx.send(res);
    })
    .map_err(|e| format!("failed to create file watcher: {e}"))?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("failed to start file watcher: {e}"))?;

    let join = thread::spawn(move || {
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

            let change_event = event_to_change_event(&event, &root_path, generation);

            if let Some(ce) = change_event {
                let _ = app_handle.emit("file-change", ce);
            }
        }
    });

    Ok(WatcherGuard {
        stop_tx,
        join: Some(join),
    })
}

/// Convert a notify Event to our simplified FileChangeEvent.
fn event_to_change_event(
    event: &Event,
    root: &PathBuf,
    generation: u64,
) -> Option<FileChangeEvent> {
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
            generation,
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
        generation,
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
    access_token: Option<String>,
    relative_path: Option<String>,
    notebook_root: State<'_, NotebookRoot>,
    external_grants: State<'_, ExternalAccessGrants>,
) -> Result<u64, String> {
    let (canonical, notebook_allowed, external_allowed) =
        if let Some(token) = access_token.as_deref() {
            let relative = relative_path.as_deref().unwrap_or("/");
            let canonical = external_grants.resolve_watch_directory(token, relative)?;
            (canonical, false, true)
        } else {
            let path = PathBuf::from(&root_path);
            if !path.exists() || !path.is_dir() {
                return Err(format!("invalid watcher root path: {root_path}"));
            }
            let canonical = path
                .canonicalize()
                .map_err(|e| format!("invalid watcher root path: {root_path}: {e}"))?;
            let notebook_allowed = notebook_root
                .get()
                .and_then(|root| root.canonicalize().ok())
                .map(|root| canonical == root)
                .unwrap_or(false);
            (canonical, notebook_allowed, false)
        };
    if !notebook_allowed && !external_allowed {
        return Err(
            "watcher root is not an active notebook or authorized external root".to_string(),
        );
    }
    // Stop and join the previous OS watcher before creating the replacement.
    // This prevents overlapping roots from racing events during a notebook switch.
    state.stop()?;
    let generation = state.next_generation();
    let guard = start_watching(app_handle, canonical, generation)?;
    state.replace(guard)?;
    Ok(generation)
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
        (
            WatcherGuard {
                stop_tx,
                join: None,
            },
            stop_rx,
        )
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
