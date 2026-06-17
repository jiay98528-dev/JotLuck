// MarkLuck Tauri Backend
//
// M6: Full-platform Rust backend with:
//   M6-03: fs_ops — file read/write/delete/list with atomic writes
//   M6-04: indexer — tantivy full-text search
//   M6-05: file_watcher — notify file change events
//   M6-06: template — Rust template rendering
//   M6-07: path — safe path validation

mod file_watcher;
mod fs_ops;
mod indexer;
mod path;
mod template;

use std::sync::Mutex;
use tauri::Emitter;

/// Stores the file path from command-line args (file association / double-click open).
static OPENED_FILE: Mutex<Option<String>> = Mutex::new(None);

/// Get the file path that was passed via command-line (e.g. double-clicked .md file).
/// Returns null if the app was launched normally.
#[tauri::command]
fn get_opened_file() -> Option<String> {
    OPENED_FILE.lock().unwrap().clone()
}

/// Initialize all IPC commands and plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Capture command-line args for file association handling (Windows double-click).
    let args: Vec<String> = std::env::args().collect();
    // Skip the first arg (exe path). The first real arg should be a file path.
    if let Some(file_path) = args.get(1) {
        let path = file_path.replace('\\', "/");
        if path.ends_with(".md") || path.ends_with(".markdown") {
            *OPENED_FILE.lock().unwrap() = Some(path);
        }
    }

    tauri::Builder::default()
        .manage(fs_ops::NotebookRoot::new())
        .manage(Mutex::new(indexer::SearchIndex::new()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Emit opened-file event to frontend after setup
            if let Some(ref path) = *OPENED_FILE.lock().unwrap() {
                let _ = app.emit("opened-file", path.clone());
            }

            log::info!("MarkLuck Tauri backend initialized");
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // M6-03: File system operations
            fs_ops::open_notebook,
            fs_ops::get_notebook_root,
            fs_ops::list_directory,
            fs_ops::read_file,
            fs_ops::write_file,
            fs_ops::delete_file,
            fs_ops::create_directory,
            fs_ops::rename_file,
            fs_ops::get_file_meta,
            // M6-04: Search
            indexer::build_index,
            indexer::update_index_document,
            indexer::search_index,
            // M6-05: File watcher
            file_watcher::start_file_watcher,
            // M6-06: Template
            template::render_template,
            template::get_builtin_template,
            // File association handler
            get_opened_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkLuck");
}
