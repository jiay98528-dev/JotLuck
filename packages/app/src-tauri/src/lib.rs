// JotLuck Tauri Backend
//
// The desktop host runs as one process with window-scoped notebook and
// external-file sessions. A file association never replaces another window.

mod completion_retrieval;
mod file_watcher;
mod fs_ops;
mod indexer;
mod path;
mod template;
mod window_session;

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use uuid::Uuid;

/// Force-close the calling window after the frontend has completed its save guard.
/// `close()` would emit another CloseRequested event and re-enter the guard.
#[tauri::command]
fn destroy_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|error| error.to_string())
}

fn is_supported_opened_file_extension(ext: &str) -> bool {
    matches!(ext, "md" | "markdown" | "mdx" | "txt")
}

fn opened_file_path_from_arg(arg: &str, cwd: &Path) -> Option<PathBuf> {
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
        cwd.join(raw_path)
    };
    let canonical = absolute.canonicalize().ok()?;
    canonical.is_file().then_some(canonical)
}

fn capture_opened_files_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();
    for arg in args {
        let Some(path) = opened_file_path_from_arg(arg, cwd) else {
            continue;
        };
        let duplicate = files.iter().any(|existing| {
            window_session::canonical_path_key(existing).ok()
                == window_session::canonical_path_key(&path).ok()
        });
        if !duplicate {
            files.push(path);
        }
    }
    files
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

fn report_window_error(app: &tauri::AppHandle, message: &str) {
    write_startup_error(message);
    if let Some(window) = app.webview_windows().into_values().next() {
        let _ = window.emit("jotluck://startup-error", message.to_string());
    }
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        write_startup_error(&format!("panic while running jotluck: {info}"));
    }));
}

fn attach_window_cleanup(window: &WebviewWindow) {
    let label = window.label().to_string();
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        app.state::<window_session::WindowSessionRegistry>()
            .remove(&label);
        app.state::<fs_ops::NotebookRoot>().remove_for(&label);
        app.state::<indexer::SearchIndexState>().remove_for(&label);
        app.state::<file_watcher::FileWatcherState>()
            .remove_for(&label);
        app.state::<completion_retrieval::CompletionRetrievalStates>()
            .remove_for(&label);
        app.state::<fs_ops::ExternalAccessGrants>()
            .revoke_for_window(&label);
    });
}

fn cloned_window_config(
    app: &tauri::AppHandle,
    label: String,
) -> Result<tauri::utils::config::WindowConfig, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "missing desktop window configuration".to_string())?;
    config.label = label;
    config.title = "JotLuck".to_string();
    Ok(config)
}

fn build_window(app: &tauri::AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let config = cloned_window_config(app, label.to_string())?;
    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
}

fn focus_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn open_external_file_in_window(
    app: &tauri::AppHandle,
    path: &Path,
    preferred_label: Option<&str>,
) -> Result<(), String> {
    let sessions = app.state::<window_session::WindowSessionRegistry>();
    if let Some(existing_label) = sessions.label_for_path(path)? {
        if let Some(existing) = app.get_webview_window(&existing_label) {
            focus_window(&existing);
            return Ok(());
        }
        sessions.remove(&existing_label);
        app.state::<fs_ops::ExternalAccessGrants>()
            .revoke_for_window(&existing_label);
    }

    let label = preferred_label
        .map(str::to_string)
        .unwrap_or_else(|| format!("file-{}", Uuid::new_v4().simple()));
    let existing_window = app.get_webview_window(&label);
    let access = app.state::<fs_ops::ExternalAccessGrants>();
    let handle = access.grant_for_existing_file(&path.to_string_lossy(), &label)?;
    if let Err(error) = sessions.register_external(&label, handle) {
        access.revoke_for_window(&label);
        return Err(error);
    }

    let window = match existing_window {
        Some(window) => window,
        None => match build_window(app, &label) {
            Ok(window) => window,
            Err(error) => {
                sessions.remove(&label);
                access.revoke_for_window(&label);
                return Err(format!(
                    "failed to create window for {}: {error}",
                    path.display()
                ));
            }
        },
    };
    attach_window_cleanup(&window);
    focus_window(&window);
    Ok(())
}

fn create_workspace_window(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        focus_window(&window);
        return Ok(());
    }
    app.state::<window_session::WindowSessionRegistry>()
        .ensure_workspace(label);
    let window = build_window(app, label)?;
    attach_window_cleanup(&window);
    focus_window(&window);
    Ok(())
}

fn open_secondary_invocation(app: tauri::AppHandle, files: Vec<PathBuf>) {
    let schedule = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if files.is_empty() {
            if let Err(error) = create_workspace_window(&schedule, "main") {
                report_window_error(&schedule, &error);
            }
            return;
        }
        for path in files {
            if let Err(error) = open_external_file_in_window(&schedule, &path, None) {
                report_window_error(&schedule, &error);
            }
        }
    }) {
        report_window_error(
            &app,
            &format!("failed to schedule external file window: {error}"),
        );
    }
}

/// Initialize all IPC commands and plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let startup_args: Vec<String> = std::env::args().collect();
    let startup_files = capture_opened_files_from_args(&startup_args, &cwd);

    if let Err(error) = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let cwd = PathBuf::from(cwd);
            let files = capture_opened_files_from_args(&argv, &cwd);
            open_secondary_invocation(app.clone(), files);
        }))
        .manage(fs_ops::NotebookRoot::new())
        .manage(fs_ops::ExternalAccessGrants::new())
        .manage(window_session::WindowSessionRegistry::new())
        .manage(file_watcher::FileWatcherState::new())
        .manage(completion_retrieval::CompletionRetrievalStates::new())
        .manage(indexer::SearchIndexState::new())
        .setup(move |app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let main = app
                .get_webview_window("main")
                .ok_or("missing main window")?;
            if let Some(first) = startup_files.first() {
                open_external_file_in_window(app.handle(), first, Some("main"))?;
            } else {
                app.state::<window_session::WindowSessionRegistry>()
                    .ensure_workspace("main");
                attach_window_cleanup(&main);
            }
            for path in startup_files.iter().skip(1) {
                if let Err(error) = open_external_file_in_window(app.handle(), path, None) {
                    report_window_error(app.handle(), &error);
                }
            }

            log::info!("JotLuck Tauri backend initialized");
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            destroy_current_window,
            window_session::get_window_bootstrap,
            window_session::enable_external_edit,
            window_session::promote_external_file_to_notebook,
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
            indexer::build_index,
            indexer::update_index_document,
            indexer::search_index,
            completion_retrieval::completion_v2_set_scope,
            completion_retrieval::completion_v2_replace_document,
            completion_retrieval::completion_v2_remove_document,
            completion_retrieval::completion_v2_rename_document,
            completion_retrieval::completion_v2_clear,
            completion_retrieval::completion_v2_apply_batch,
            completion_retrieval::completion_v2_query,
            completion_retrieval::completion_v2_diagnostics,
            file_watcher::start_file_watcher,
            file_watcher::stop_file_watcher,
            template::render_template,
            template::get_builtin_template,
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
    fn opened_file_capture_accepts_all_supported_extensions() {
        let root = std::env::temp_dir().join(format!("JotLuck-opened-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for extension in ["md", "markdown", "mdx", "txt"] {
            fs::write(root.join(format!("target.{extension}")), "content").unwrap();
        }
        let args = ["md", "markdown", "mdx", "txt"]
            .into_iter()
            .map(|extension| format!("target.{extension}"))
            .collect::<Vec<_>>();
        let files = capture_opened_files_from_args(&args, &root);
        assert_eq!(files.len(), 4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opened_file_capture_ignores_unsupported_and_missing_files() {
        let root = std::env::temp_dir();
        let args = vec!["missing.pdf".to_string(), "missing.md".to_string()];
        assert!(capture_opened_files_from_args(&args, &root).is_empty());
    }
}
