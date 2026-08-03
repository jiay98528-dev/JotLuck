// M6-05: File system watcher
//
// Monitors the active notebook directory for changes and emits simplified
// events to the frontend. The watcher is a replaceable singleton so switching
// notebooks does not leak OS watcher handles.

use crate::fs_ops::{ExternalAccessGrants, NotebookRoot};
use crate::window_session::WindowSessionRegistry;
use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

/// File change event emitted to the frontend.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct FileChangeEvent {
    pub kind: String,             // "create" | "modify" | "remove" | "rename"
    pub path: String,             // relative path within notebook
    pub old_path: Option<String>, // for rename events
    pub generation: u64,
    pub entry_kind: String, // "file" | "directory" | "unknown"
    pub rescan: bool,
}

pub struct FileWatcherState {
    windows: Mutex<HashMap<String, WindowWatcherState>>,
}

#[derive(Default)]
struct WindowWatcherState {
    guard: Option<WatcherGuard>,
    generation: u64,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    fn next_generation(&self, window_label: &str) -> Result<u64, String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|_| "file watcher state lock poisoned".to_string())?;
        let state = windows.entry(window_label.to_string()).or_default();
        state.generation = state.generation.saturating_add(1);
        Ok(state.generation)
    }

    fn replace(&self, window_label: &str, guard: WatcherGuard) -> Result<(), String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|_| "file watcher state lock poisoned".to_string())?;
        let state = windows.entry(window_label.to_string()).or_default();
        if let Some(existing) = state.guard.take() {
            existing.stop();
        }
        state.guard = Some(guard);
        Ok(())
    }

    pub fn stop_for(&self, window_label: &str) -> Result<bool, String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|_| "file watcher state lock poisoned".to_string())?;
        let Some(state) = windows.get_mut(window_label) else {
            return Ok(false);
        };
        let Some(existing) = state.guard.take() else {
            return Ok(false);
        };
        existing.stop();
        Ok(true)
    }

    pub fn remove_for(&self, window_label: &str) {
        if let Ok(mut windows) = self.windows.lock() {
            if let Some(mut state) = windows.remove(window_label) {
                if let Some(existing) = state.guard.take() {
                    existing.stop();
                }
            }
        }
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
    window_label: String,
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

            match event_result {
                Ok(event) => {
                    for change in event_to_change_events(&event, &root_path, generation) {
                        let _ = app_handle.emit_to(&window_label, "file-change", change);
                    }
                }
                Err(_) => {
                    let _ = app_handle.emit_to(
                        &window_label,
                        "file-change",
                        rescan_change_event(generation),
                    );
                }
            }
        }
    });

    Ok(WatcherGuard {
        stop_tx,
        join: Some(join),
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EntryKind {
    File,
    Directory,
    Unknown,
}

impl EntryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
            Self::Unknown => "unknown",
        }
    }
}

fn relative_event_path(path: &Path, root: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn classify_path(path: &Path, hint: Option<EntryKind>) -> EntryKind {
    if let Some(hint) = hint {
        return hint;
    }
    if path.is_dir() {
        EntryKind::Directory
    } else if path.is_file() || is_supported_path(path) {
        EntryKind::File
    } else {
        EntryKind::Unknown
    }
}

fn change_for_path(
    kind: &str,
    path: &Path,
    old_path: Option<&Path>,
    entry_kind: EntryKind,
    root: &Path,
    generation: u64,
) -> Option<FileChangeEvent> {
    if entry_kind == EntryKind::File && !is_supported_path(path) {
        return None;
    }
    Some(FileChangeEvent {
        kind: kind.to_string(),
        path: relative_event_path(path, root)?,
        old_path: old_path.and_then(|old| relative_event_path(old, root)),
        generation,
        entry_kind: entry_kind.as_str().to_string(),
        rescan: entry_kind != EntryKind::File,
    })
}

fn rescan_change_event(generation: u64) -> FileChangeEvent {
    FileChangeEvent {
        kind: "modify".to_string(),
        path: String::new(),
        old_path: None,
        generation,
        entry_kind: "unknown".to_string(),
        rescan: true,
    }
}

fn rename_pair_to_events(
    old: &Path,
    new: &Path,
    root: &Path,
    generation: u64,
) -> Vec<FileChangeEvent> {
    let old_inside = relative_event_path(old, root).is_some();
    let new_inside = relative_event_path(new, root).is_some();
    if !old_inside && !new_inside {
        return Vec::new();
    }

    // Atomic saves move an unsupported hidden temp file onto the supported
    // note path. That is a modification, never a user-visible move-away.
    if old_inside
        && new_inside
        && !new.is_dir()
        && !is_supported_path(old)
        && is_supported_path(new)
    {
        return change_for_path("modify", new, None, EntryKind::File, root, generation)
            .into_iter()
            .collect();
    }

    let entry_kind = if old.is_dir() || new.is_dir() {
        EntryKind::Directory
    } else if is_supported_path(old) || is_supported_path(new) {
        EntryKind::File
    } else {
        EntryKind::Unknown
    };

    let change = match (old_inside, new_inside, entry_kind) {
        (true, true, EntryKind::File) if is_supported_path(old) && is_supported_path(new) => {
            change_for_path("rename", new, Some(old), entry_kind, root, generation)
        }
        (true, true, EntryKind::File) if is_supported_path(old) => {
            change_for_path("remove", old, None, entry_kind, root, generation)
        }
        (true, true, EntryKind::File) => {
            change_for_path("create", new, None, entry_kind, root, generation)
        }
        (true, true, _) => change_for_path("rename", new, Some(old), entry_kind, root, generation),
        (true, false, _) => change_for_path("remove", old, None, entry_kind, root, generation),
        (false, true, _) => change_for_path("create", new, None, entry_kind, root, generation),
        (false, false, _) => None,
    };
    change.into_iter().collect()
}

/// Convert one notify event into every relevant note/tree event. notify may
/// batch multiple paths into one callback, especially on Windows.
fn event_to_change_events(event: &Event, root: &Path, generation: u64) -> Vec<FileChangeEvent> {
    if let EventKind::Modify(ModifyKind::Name(ref mode)) = event.kind {
        return match mode {
            RenameMode::Both => event
                .paths
                .chunks(2)
                .flat_map(|pair| match pair {
                    [old, new] => rename_pair_to_events(old, new, root, generation),
                    [path] => {
                        change_for_path("modify", path, None, EntryKind::Unknown, root, generation)
                            .into_iter()
                            .collect()
                    }
                    _ => Vec::new(),
                })
                .collect(),
            RenameMode::From => event
                .paths
                .iter()
                .filter_map(|path| {
                    change_for_path(
                        "remove",
                        path,
                        None,
                        classify_path(path, None),
                        root,
                        generation,
                    )
                })
                .collect(),
            RenameMode::To => event
                .paths
                .iter()
                .filter_map(|path| {
                    change_for_path(
                        "create",
                        path,
                        None,
                        classify_path(path, None),
                        root,
                        generation,
                    )
                })
                .collect(),
            _ if event.paths.len() == 2 => {
                rename_pair_to_events(&event.paths[0], &event.paths[1], root, generation)
            }
            _ => event
                .paths
                .iter()
                .filter_map(|path| {
                    change_for_path("modify", path, None, EntryKind::Unknown, root, generation)
                })
                .collect(),
        };
    }

    let (kind, hint, ambiguous) = match event.kind {
        EventKind::Create(ref create) => (
            "create",
            match create {
                CreateKind::File => Some(EntryKind::File),
                CreateKind::Folder => Some(EntryKind::Directory),
                _ => None,
            },
            false,
        ),
        EventKind::Modify(ModifyKind::Data(_)) => ("modify", Some(EntryKind::File), false),
        EventKind::Modify(ModifyKind::Metadata(_)) => ("modify", None, false),
        EventKind::Modify(_) => ("modify", None, true),
        EventKind::Remove(ref remove) => (
            "remove",
            match remove {
                RemoveKind::File => Some(EntryKind::File),
                RemoveKind::Folder => Some(EntryKind::Directory),
                _ => None,
            },
            false,
        ),
        EventKind::Any | EventKind::Other => ("modify", None, true),
        _ => return Vec::new(),
    };

    if event.paths.is_empty() && ambiguous {
        return vec![rescan_change_event(generation)];
    }
    event
        .paths
        .iter()
        .filter_map(|path| {
            let entry_kind = if ambiguous {
                EntryKind::Unknown
            } else {
                classify_path(path, hint)
            };
            change_for_path(kind, path, None, entry_kind, root, generation)
        })
        .collect()
}

fn is_supported_path(path: &Path) -> bool {
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
// Tauri injects managed state as individual command parameters; grouping them would change the IPC ABI.
#[allow(clippy::too_many_arguments)]
pub fn start_file_watcher(
    window: WebviewWindow,
    app_handle: AppHandle,
    state: State<'_, FileWatcherState>,
    root_path: String,
    access_token: Option<String>,
    _relative_path: Option<String>,
    notebook_root: State<'_, NotebookRoot>,
    _external_grants: State<'_, ExternalAccessGrants>,
    sessions: State<'_, WindowSessionRegistry>,
) -> Result<u64, String> {
    sessions.assert_workspace(window.label())?;
    let (canonical, notebook_allowed, external_allowed) = if access_token.is_some() {
        return Err("external file windows cannot start directory watchers".to_string());
    } else {
        let path = PathBuf::from(&root_path);
        if !path.exists() || !path.is_dir() {
            return Err(format!("invalid watcher root path: {root_path}"));
        }
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("invalid watcher root path: {root_path}: {e}"))?;
        let notebook_allowed = notebook_root
            .get_for(window.label())
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
    state.stop_for(window.label())?;
    let generation = state.next_generation(window.label())?;
    let guard = start_watching(
        app_handle,
        window.label().to_string(),
        canonical,
        generation,
    )?;
    state.replace(window.label(), guard)?;
    Ok(generation)
}

#[tauri::command]
pub fn stop_file_watcher(
    window: WebviewWindow,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let _ = state.stop_for(window.label())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("JotLuck-watcher-{name}-{suffix}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn rename_event(old_path: &str, new_path: &str) -> Event {
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(PathBuf::from(old_path))
            .add_path(PathBuf::from(new_path))
    }

    fn rename_from_event(old_path: &str) -> Event {
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
            .add_path(PathBuf::from(old_path))
    }

    fn rename_to_event(new_path: &str) -> Event {
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
            .add_path(PathBuf::from(new_path))
    }

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

        state.replace("main", first).unwrap();
        state.replace("main", second).unwrap();

        assert!(first_rx.recv_timeout(Duration::from_millis(200)).is_ok());
    }

    #[test]
    fn stopping_idle_watcher_is_noop() {
        let state = FileWatcherState::new();

        assert!(!state.stop_for("main").unwrap());
    }

    #[test]
    fn stopping_active_watcher_sends_stop_signal() {
        let state = FileWatcherState::new();
        let (guard, stop_rx) = guard_with_receiver();

        state.replace("main", guard).unwrap();

        assert!(state.stop_for("main").unwrap());
        assert!(stop_rx.recv_timeout(Duration::from_millis(200)).is_ok());
    }

    #[test]
    fn stopping_one_window_keeps_other_watcher_alive() {
        let state = FileWatcherState::new();
        let (first, first_rx) = guard_with_receiver();
        let (second, second_rx) = guard_with_receiver();
        state.replace("first", first).unwrap();
        state.replace("second", second).unwrap();

        assert!(state.stop_for("first").unwrap());
        assert!(first_rx.recv_timeout(Duration::from_millis(200)).is_ok());
        assert!(second_rx.recv_timeout(Duration::from_millis(50)).is_err());
    }

    #[test]
    fn atomic_temp_file_replacement_is_reported_as_modify() {
        let root = Path::new("notebook");
        let event = rename_event("notebook/.history.md.123.456.0.tmp", "notebook/history.md");

        let change = event_to_change_events(&event, root, 7).remove(0);

        assert_eq!(change.kind, "modify");
        assert_eq!(change.path, "history.md");
        assert_eq!(change.old_path, None);
        assert_eq!(change.generation, 7);
        assert_eq!(change.entry_kind, "file");
        assert!(!change.rescan);
    }

    #[test]
    fn real_note_rename_keeps_its_direction() {
        let root = Path::new("notebook");
        let event = rename_event("notebook/history.md", "notebook/archive.md");

        let change = event_to_change_events(&event, root, 8).remove(0);

        assert_eq!(change.kind, "rename");
        assert_eq!(change.path, "archive.md");
        assert_eq!(change.old_path.as_deref(), Some("history.md"));
        assert_eq!(change.generation, 8);
    }

    #[test]
    fn split_rename_from_reports_the_old_note_as_removed() {
        let root = Path::new("notebook");
        let event = rename_from_event("notebook/history.md");

        let change = event_to_change_events(&event, root, 9).remove(0);

        assert_eq!(change.kind, "remove");
        assert_eq!(change.path, "history.md");
        assert_eq!(change.old_path, None);
        assert_eq!(change.generation, 9);
    }

    #[test]
    fn note_moved_out_of_root_is_reported_as_remove() {
        let root = Path::new("notebook");
        let event = rename_event("notebook/history.md", "archive/history.md");

        let change = event_to_change_events(&event, root, 10).remove(0);

        assert_eq!(change.kind, "remove");
        assert_eq!(change.path, "history.md");
        assert_eq!(change.entry_kind, "file");
    }

    #[test]
    fn note_moved_into_root_is_reported_as_create() {
        let root = Path::new("notebook");
        let event = rename_event("archive/history.md", "notebook/history.md");

        let change = event_to_change_events(&event, root, 11).remove(0);

        assert_eq!(change.kind, "create");
        assert_eq!(change.path, "history.md");
    }

    #[test]
    fn split_rename_to_reports_the_new_note_as_created() {
        let root = Path::new("notebook");
        let event = rename_to_event("notebook/history.md");

        let change = event_to_change_events(&event, root, 12).remove(0);

        assert_eq!(change.kind, "create");
        assert_eq!(change.path, "history.md");
    }

    #[test]
    fn folder_remove_requests_full_rescan() {
        let root = Path::new("notebook");
        let event = Event::new(EventKind::Remove(RemoveKind::Folder))
            .add_path(PathBuf::from("notebook/folder"));

        let change = event_to_change_events(&event, root, 13).remove(0);

        assert_eq!(change.kind, "remove");
        assert_eq!(change.path, "folder");
        assert_eq!(change.entry_kind, "directory");
        assert!(change.rescan);
    }

    #[test]
    fn folder_rename_keeps_direction_and_requests_full_rescan() {
        let root = temp_root("folder-rename");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&new).unwrap();
        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(old)
            .add_path(new);

        let change = event_to_change_events(&event, &root, 15).remove(0);

        assert_eq!(change.kind, "rename");
        assert_eq!(change.path, "new");
        assert_eq!(change.old_path.as_deref(), Some("old"));
        assert_eq!(change.entry_kind, "directory");
        assert!(change.rescan);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn folder_moved_out_of_root_is_removed_and_rescanned() {
        let root = temp_root("folder-move-out");
        let outside = temp_root("folder-move-out-destination");
        let old = root.join("folder");
        let new = outside.join("folder");
        std::fs::create_dir_all(&new).unwrap();
        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(old)
            .add_path(new);

        let change = event_to_change_events(&event, &root, 16).remove(0);

        assert_eq!(change.kind, "remove");
        assert_eq!(change.path, "folder");
        assert_eq!(change.entry_kind, "directory");
        assert!(change.rescan);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn multi_path_events_do_not_drop_later_notes() {
        let root = Path::new("notebook");
        let event = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Content,
        )))
        .add_path(PathBuf::from("notebook/first.md"))
        .add_path(PathBuf::from("notebook/second.md"));

        let changes = event_to_change_events(&event, root, 14);

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "first.md");
        assert_eq!(changes[1].path, "second.md");
    }
}
