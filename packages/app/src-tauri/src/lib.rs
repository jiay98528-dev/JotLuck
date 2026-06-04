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

/// Initialize all IPC commands and plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkLuck");
}
