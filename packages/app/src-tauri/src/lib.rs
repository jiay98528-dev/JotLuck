// JotLuck Tauri Backend
//
// M6: Full-platform Rust backend with:
//   M6-03: fs_ops — file read/write/delete/list with atomic writes
//   M6-04: indexer — tantivy full-text search
//   M6-05: file_watcher — notify file change events
//   M6-06: template — Rust template rendering
//   M6-07: path — safe path validation

mod completion_retrieval;
mod file_watcher;
mod fs_ops;
mod indexer;
mod path;
mod template;

use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager, WindowEvent};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedFile {
    absolute_path: String,
    notebook_root: String,
    relative_path: String,
    access_token: Option<String>,
}

/// Stores the file path from command-line args (file association / double-click open).
static OPENED_FILE: Mutex<Option<OpenedFile>> = Mutex::new(None);

/// Get the file path that was passed via command-line (e.g. double-clicked note file).
/// Returns null if the app was launched normally.
#[tauri::command]
fn get_opened_file() -> Option<OpenedFile> {
    OPENED_FILE.lock().unwrap().clone()
}

fn path_to_slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_supported_opened_file_extension(ext: &str) -> bool {
    matches!(ext, "md" | "markdown" | "mdx")
}

fn opened_file_from_arg(arg: &str) -> Option<OpenedFile> {
    let raw_path = PathBuf::from(arg);
    let ext = raw_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;
    if !is_supported_opened_file_extension(&ext) {
        return None;
    }

    let absolute = if raw_path.is_absolute() {
        raw_path
    } else {
        std::env::current_dir().ok()?.join(raw_path)
    };
    let absolute = absolute.canonicalize().unwrap_or(absolute);
    let notebook_root = absolute.parent()?.to_path_buf();
    let file_name = absolute.file_name()?.to_string_lossy().to_string();

    Some(OpenedFile {
        absolute_path: path_to_slash(&absolute),
        notebook_root: path_to_slash(&notebook_root),
        relative_path: format!("/{file_name}"),
        access_token: None,
    })
}

fn capture_opened_file_from_args(args: &[String]) -> Option<OpenedFile> {
    args.iter()
        .skip(1)
        .find_map(|arg| opened_file_from_arg(arg))
}

fn attach_external_grant(
    opened_file: &mut OpenedFile,
    access: &fs_ops::ExternalAccessGrants,
) -> Result<(), String> {
    let handle = access.grant_for_existing_file(&opened_file.absolute_path)?;
    opened_file.access_token = Some(handle.access_token);
    Ok(())
}

fn startup_log_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("TMP"))
        .map(PathBuf::from)?;
    let dir = base.join("JotLuck").join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("startup-error.log"))
}

fn write_startup_error(message: &str) {
    if let Some(path) = startup_log_path() {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "[{}] {}", chrono::Local::now().to_rfc3339(), message);
        }
    }

    eprintln!("{message}");
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        write_startup_error(&format!("panic while running jotluck: {info}"));
    }));
}

/// Initialize all IPC commands and plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    // Capture command-line args for file association handling (Windows double-click).
    let args: Vec<String> = std::env::args().collect();
    if let Some(opened_file) = capture_opened_file_from_args(&args) {
        *OPENED_FILE.lock().unwrap() = Some(opened_file);
    }

    if let Err(error) = tauri::Builder::default()
        .manage(fs_ops::NotebookRoot::new())
        .manage(fs_ops::ExternalAccessGrants::new())
        .manage(file_watcher::FileWatcherState::new())
        .manage(completion_retrieval::CompletionRetrievalState::default())
        .manage(Mutex::new(indexer::SearchIndex::new()))
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Emit opened-file event to frontend after setup
            if let Some(mut opened_file) = OPENED_FILE.lock().unwrap().take() {
                let access = app.state::<fs_ops::ExternalAccessGrants>();
                if attach_external_grant(&mut opened_file, &access).is_ok() {
                    let _ = app.emit("opened-file", opened_file.clone());
                    *OPENED_FILE.lock().unwrap() = Some(opened_file);
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed) {
                        app_handle
                            .state::<fs_ops::ExternalAccessGrants>()
                            .revoke_all();
                    }
                });
            }

            log::info!("JotLuck Tauri backend initialized");
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(opened_file) = capture_opened_file_from_args(&argv) {
                let mut opened_file = opened_file;
                let access = app.state::<fs_ops::ExternalAccessGrants>();
                if attach_external_grant(&mut opened_file, &access).is_ok() {
                    *OPENED_FILE.lock().unwrap() = Some(opened_file.clone());
                    let _ = app.emit("opened-file", opened_file);
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            // M6-03: File system operations
            fs_ops::open_notebook,
            fs_ops::open_external_notebook,
            fs_ops::open_sample_notebook,
            fs_ops::get_notebook_root,
            fs_ops::list_directory,
            fs_ops::list_external_note_directory,
            fs_ops::read_file,
            fs_ops::read_external_note_file,
            fs_ops::write_file,
            fs_ops::read_external_markdown_file,
            fs_ops::write_external_markdown_file,
            fs_ops::write_external_note_file,
            fs_ops::save_external_note_as,
            fs_ops::revoke_external_access,
            fs_ops::read_binary_file,
            fs_ops::write_binary_file,
            fs_ops::delete_file,
            fs_ops::create_directory,
            fs_ops::rename_file,
            fs_ops::get_file_meta,
            // M6-04: Search
            indexer::build_index,
            indexer::update_index_document,
            indexer::search_index,
            // Completion Engine V2 in-memory retrieval
            completion_retrieval::completion_v2_set_scope,
            completion_retrieval::completion_v2_replace_document,
            completion_retrieval::completion_v2_remove_document,
            completion_retrieval::completion_v2_rename_document,
            completion_retrieval::completion_v2_clear,
            completion_retrieval::completion_v2_apply_batch,
            completion_retrieval::completion_v2_query,
            completion_retrieval::completion_v2_diagnostics,
            // M6-05: File watcher
            file_watcher::start_file_watcher,
            file_watcher::stop_file_watcher,
            // M6-06: Template
            template::render_template,
            template::get_builtin_template,
            // File association handler
            get_opened_file,
        ])
        .run(tauri::generate_context!())
    {
        write_startup_error(&format!("error while running jotluck: {error:?}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opened_file_payload_uses_parent_as_notebook_root() {
        let root = std::env::temp_dir().join("JotLuck-opened-file-test");
        let _ = fs::create_dir_all(&root);
        let note_path = root.join("target.md");
        fs::write(&note_path, "# Target").unwrap();

        let opened = opened_file_from_arg(&note_path.to_string_lossy()).unwrap();

        assert_eq!(opened.relative_path, "/target.md");
        assert_eq!(
            opened.notebook_root,
            path_to_slash(&root.canonicalize().unwrap())
        );
        assert_eq!(
            opened.absolute_path,
            path_to_slash(&note_path.canonicalize().unwrap())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opened_file_payload_accepts_mdx_and_rejects_txt_files() {
        let mdx = opened_file_from_arg("C:/tmp/component.mdx");
        let txt = opened_file_from_arg("C:/tmp/plain.txt");
        assert!(mdx.is_some());
        assert!(txt.is_none());
    }

    #[test]
    fn opened_file_payload_ignores_unsupported_files() {
        let ignored = opened_file_from_arg("C:/tmp/not-a-note.pdf");
        assert!(ignored.is_none());
    }
}
