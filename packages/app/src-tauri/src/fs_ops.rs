// M6-03: File system operations
//
// Tauri IPC commands for reading, writing, deleting, and listing markdown files.
// All operations go through path::resolve_safe_path for security.

use crate::path::resolve_safe_path;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

/// In-memory state: the current notebook root directory.
pub struct NotebookRoot(pub std::sync::Mutex<Option<PathBuf>>);

impl NotebookRoot {
    pub fn new() -> Self {
        Self(std::sync::Mutex::new(None))
    }

    pub fn get(&self) -> Option<PathBuf> {
        self.0.lock().ok()?.clone()
    }

    pub fn set(&self, path: PathBuf) {
        if let Ok(mut root) = self.0.lock() {
            *root = Some(path);
        }
    }
}

/// Directory entry returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: u64,
}

// ============================================================
// IPC Commands
// ============================================================

/// Open a notebook folder — all subsequent operations are relative to this root.
#[tauri::command]
pub fn open_notebook(path: String, root: State<NotebookRoot>) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("文件夹不存在: {}", path));
    }
    if !p.is_dir() {
        return Err(format!("路径不是文件夹: {}", path));
    }
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {}", e))?;
    root.set(canonical.clone());
    Ok(canonical.to_string_lossy().to_string())
}

/// Get the current notebook root path.
#[tauri::command]
pub fn get_notebook_root(root: State<NotebookRoot>) -> Result<String, String> {
    root.get()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "未打开笔记本".to_string())
}

/// List all .md files and directories in a given directory (relative to notebook root).
#[tauri::command]
pub fn list_directory(
    relative_path: String,
    root: State<NotebookRoot>,
) -> Result<Vec<DirEntry>, String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let dir_iter = fs::read_dir(&target).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in dir_iter {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        let metadata = entry.metadata().ok();

        // Show text notes, supported image assets, and directories
        let name = entry.file_name().to_string_lossy().to_string();
        let lower_name = name.to_lowercase();
        let is_supported = lower_name.ends_with(".md")
            || lower_name.ends_with(".markdown")
            || lower_name.ends_with(".txt")
            || lower_name.ends_with(".png")
            || lower_name.ends_with(".jpg")
            || lower_name.ends_with(".jpeg")
            || lower_name.ends_with(".gif")
            || lower_name.ends_with(".webp")
            || lower_name.ends_with(".svg")
            || lower_name.ends_with(".bmp");
        if !file_type.is_dir() && !is_supported {
            continue;
        }

        let rel = crate::path::display_path(&root_path, &entry.path());

        entries.push(DirEntry {
            name,
            path: format!("/{}", rel),
            is_dir: file_type.is_dir(),
            size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
            modified_at: metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Read a file's content (relative to notebook root).
#[tauri::command]
pub fn read_file(relative_path: String, root: State<NotebookRoot>) -> Result<String, String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    fs::read_to_string(&target).map_err(|e| format!("读取文件失败: {}", e))
}

/// Write content to a file (relative to notebook root).
/// Uses atomic write: write to temp file first, then rename.
#[tauri::command]
pub fn write_file(
    relative_path: String,
    content: String,
    root: State<NotebookRoot>,
) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    // Atomic write: write to .tmp then rename
    let tmp_path = target.with_extension("md.tmp");
    fs::write(&tmp_path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    fs::rename(&tmp_path, &target).map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(())
}

/// Write binary content to a file (base64 payload, relative to notebook root).
#[tauri::command]
pub fn write_binary_file(
    relative_path: String,
    base64: String,
    root: State<NotebookRoot>,
) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("图片数据解码失败: {}", e))?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    fs::write(&target, bytes).map_err(|e| format!("写入二进制文件失败: {}", e))
}

/// Read binary content from a file (returns base64 payload).
#[tauri::command]
pub fn read_binary_file(
    relative_path: String,
    root: State<NotebookRoot>,
) -> Result<String, String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    let bytes = fs::read(&target).map_err(|e| format!("读取二进制文件失败: {}", e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

/// Delete a file — moves to system recycle bin (Windows/macOS/Linux).
#[tauri::command]
pub fn delete_file(relative_path: String, root: State<NotebookRoot>) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    trash::delete(&target).map_err(|e| format!("删除失败: {}", e))
}

/// Create a new directory (relative to notebook root).
#[tauri::command]
pub fn create_directory(relative_path: String, root: State<NotebookRoot>) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(&target).map_err(|e| format!("创建文件夹失败: {}", e))
}

/// Rename / move a file within the notebook.
#[tauri::command]
pub fn rename_file(
    old_relative_path: String,
    new_relative_path: String,
    root: State<NotebookRoot>,
) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let old_target =
        resolve_safe_path(&root_path, &old_relative_path).map_err(|e| e.to_string())?;
    let new_target =
        resolve_safe_path(&root_path, &new_relative_path).map_err(|e| e.to_string())?;

    if !old_target.exists() {
        return Err(format!("文件不存在: {}", old_relative_path));
    }
    if let Some(parent) = new_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
    }
    fs::rename(&old_target, &new_target).map_err(|e| format!("重命名失败: {}", e))
}

/// Get file metadata (mtime, size) for conflict detection.
#[tauri::command]
pub fn get_file_meta(relative_path: String, root: State<NotebookRoot>) -> Result<DirEntry, String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    let metadata = target
        .metadata()
        .map_err(|e| format!("读取元数据失败: {}", e))?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(DirEntry {
        name,
        path: relative_path,
        is_dir: false,
        size: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}
