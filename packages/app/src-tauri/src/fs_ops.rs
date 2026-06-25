// M6-03: File system operations
//
// Tauri IPC commands for reading, writing, deleting, and listing note files.
// All operations go through path::resolve_safe_path for security.

use crate::path::resolve_safe_path;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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

fn is_supported_note_file(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    matches!(ext.as_deref(), Some("md" | "markdown" | "mdx" | "txt"))
}

fn is_markdown_like_file(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    matches!(ext.as_deref(), Some("md" | "markdown" | "mdx"))
}

fn resolve_external_root(root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path);
    if !root.is_absolute() {
        return Err("外部目录路径必须是绝对路径".to_string());
    }
    if !root.exists() {
        return Err(format!("目录不存在: {}", root_path));
    }
    if !root.is_dir() {
        return Err(format!("路径不是目录: {}", root_path));
    }
    root.canonicalize()
        .map_err(|e| format!("无法解析外部目录路径: {}", e))
}

fn resolve_external_markdown_file(absolute_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(absolute_path);
    if !path.is_absolute() {
        return Err("外部文件路径必须是绝对路径".to_string());
    }
    if !is_markdown_like_file(absolute_path) {
        return Err("仅支持打开 .md/.markdown/.mdx 文件".to_string());
    }
    if !path.exists() {
        return Err(format!("文件不存在: {}", absolute_path));
    }
    if !path.is_file() {
        return Err(format!("路径不是文件: {}", absolute_path));
    }
    path.canonicalize()
        .map_err(|e| format!("无法解析外部文件路径: {}", e))
}

fn resolve_external_note_file(absolute_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(absolute_path);
    if !path.is_absolute() {
        return Err("外部文件路径必须是绝对路径".to_string());
    }
    if !is_supported_note_file(absolute_path) {
        return Err("仅支持打开 .md/.markdown/.mdx/.txt 文件".to_string());
    }
    if !path.exists() {
        return Err(format!("文件不存在: {}", absolute_path));
    }
    if !path.is_file() {
        return Err(format!("路径不是文件: {}", absolute_path));
    }
    path.canonicalize()
        .map_err(|e| format!("无法解析外部文件路径: {}", e))
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

fn local_app_data_dir() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位本机应用数据目录".to_string())
}

fn write_sample_file_if_missing(root_path: &Path, name: &str, content: &str) -> Result<(), String> {
    let target = root_path.join(name);
    if target.exists() {
        return Ok(());
    }
    fs::write(&target, content).map_err(|e| format!("写入示例文档失败: {}", e))
}

/// Open or create the first-run sample notebook under the user's app data directory.
#[tauri::command]
pub fn open_sample_notebook(root: State<NotebookRoot>) -> Result<String, String> {
    let sample_root = local_app_data_dir()?.join("MarkLuck").join("示例笔记本");
    fs::create_dir_all(&sample_root).map_err(|e| format!("创建示例笔记本失败: {}", e))?;

    write_sample_file_if_missing(
        &sample_root,
        "快速入门.md",
        r#"---
title: 快速入门
tags:
  - 入门
  - markdown
created: 2026-06-01
---

# 欢迎使用 MarkLuck

MarkLuck 是一款轻量、本地优先、离线可用的 Markdown 笔记工具。每一条笔记都是普通的 .md 文件，文件夹就是笔记本。

## 从这里开始

- 在左侧书签中切换常用笔记。
- 点击文件抽屉浏览当前文件夹。
- 使用 Ctrl+K 搜索笔记、标签和正文。
- 通过 [[格式示例]] 查看常用 Markdown 写法。
- 关联项目资料：[[项目规划]]。
- 外部链接示例：[MarkLuck GitHub](https://github.com)。

> MarkLuck 只增强写作体验，不接管你的数据。
"#,
    )?;
    write_sample_file_if_missing(
        &sample_root,
        "格式示例.md",
        r#"---
title: 格式示例
tags:
  - markdown
  - 示例
created: 2026-06-01
---

# 格式示例

## 文本样式

普通正文、**粗体**、*斜体*、~~删除线~~、`行内代码`。

## 列表与任务

- 无序列表
- 支持嵌套
  - 子项目

- [x] 打开示例文档
- [ ] 创建第一条自己的笔记

## 代码块

~~~ts
function hello(name: string): string {
  return `Hello, ${name}`;
}
~~~

## 表格

| 功能 | 状态 |
| --- | --- |
| 本地文件 | 支持 |
| Wiki-link | 支持 |
| 离线补全 | 支持 |

关联到 [[快速入门]]。
"#,
    )?;
    write_sample_file_if_missing(
        &sample_root,
        "项目规划.md",
        r#"---
title: 项目规划
tags:
  - 规划
  - 项目
created: 2026-06-02
---

# 项目规划

## 本周目标

- [x] 打开示例笔记本
- [ ] 创建第一条自己的笔记
- [ ] 试试 [[格式示例]] 中的 Markdown 写法
"#,
    )?;

    let canonical = sample_root
        .canonicalize()
        .map_err(|e| format!("无法解析示例笔记本路径: {}", e))?;
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

/// List supported note files and directories in a given directory (relative to notebook root).
#[tauri::command]
pub fn list_directory(
    relative_path: String,
    root: State<NotebookRoot>,
) -> Result<Vec<DirEntry>, String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    list_directory_at(&root_path, &relative_path)
}

/// List supported note files and directories under an external root without opening it as notebook.
#[tauri::command]
pub fn list_external_note_directory(
    root_path: String,
    relative_path: String,
) -> Result<Vec<DirEntry>, String> {
    let root_path = resolve_external_root(&root_path)?;
    list_directory_at(&root_path, &relative_path)
}

fn list_directory_at(root_path: &PathBuf, relative_path: &str) -> Result<Vec<DirEntry>, String> {
    let target = resolve_safe_path(&root_path, &relative_path).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let dir_iter = fs::read_dir(&target).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in dir_iter {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        let metadata = entry.metadata().ok();

        // The file drawer is a note manager: show directories and editable text notes only.
        let name = entry.file_name().to_string_lossy().to_string();
        if !file_type.is_dir() && !is_supported_note_file(&name) {
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
    read_file_at(&root_path, &relative_path)
}

fn read_file_at(root_path: &PathBuf, relative_path: &str) -> Result<String, String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    fs::read_to_string(&target).map_err(|e| format!("读取文件失败: {}", e))
}

/// Read one markdown-family file by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn read_external_markdown_file(absolute_path: String) -> Result<String, String> {
    let target = resolve_external_markdown_file(&absolute_path)?;
    fs::read_to_string(&target).map_err(|e| format!("读取外部文件失败: {}", e))
}

/// Read one supported text note by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn read_external_note_file(absolute_path: String) -> Result<String, String> {
    let target = resolve_external_note_file(&absolute_path)?;
    fs::read_to_string(&target).map_err(|e| format!("读取外部文件失败: {}", e))
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
    write_file_at(&root_path, &relative_path, &content)
}

fn write_file_at(root_path: &PathBuf, relative_path: &str, content: &str) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

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

/// Write one markdown-family file by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn write_external_markdown_file(absolute_path: String, content: String) -> Result<(), String> {
    let target = resolve_external_markdown_file(&absolute_path)?;
    fs::write(&target, content).map_err(|e| format!("保存外部文件失败: {}", e))
}

/// Write one supported text note by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn write_external_note_file(absolute_path: String, content: String) -> Result<(), String> {
    let target = resolve_external_note_file(&absolute_path)?;
    fs::write(&target, content).map_err(|e| format!("保存外部文件失败: {}", e))
}

/// Write binary content to a file (base64 payload, relative to notebook root).
#[tauri::command]
pub fn write_binary_file(
    relative_path: String,
    base64: String,
    root: State<NotebookRoot>,
) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    write_binary_file_at(&root_path, &relative_path, &base64)
}

fn write_binary_file_at(
    root_path: &PathBuf,
    relative_path: &str,
    base64: &str,
) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;
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
    read_binary_file_at(&root_path, &relative_path)
}

fn read_binary_file_at(root_path: &PathBuf, relative_path: &str) -> Result<String, String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

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
    delete_file_at(&root_path, &relative_path)
}

fn delete_file_at(root_path: &PathBuf, relative_path: &str) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    trash::delete(&target).map_err(|e| format!("删除失败: {}", e))
}

/// Create a new directory (relative to notebook root).
#[tauri::command]
pub fn create_directory(relative_path: String, root: State<NotebookRoot>) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    create_directory_at(&root_path, &relative_path)
}

fn create_directory_at(root_path: &PathBuf, relative_path: &str) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;
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
    rename_file_at(&root_path, &old_relative_path, &new_relative_path)
}

fn rename_file_at(
    root_path: &PathBuf,
    old_relative_path: &str,
    new_relative_path: &str,
) -> Result<(), String> {
    let old_target = resolve_safe_path(root_path, old_relative_path).map_err(|e| e.to_string())?;
    let new_target = resolve_safe_path(root_path, new_relative_path).map_err(|e| e.to_string())?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_notebook(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markluck-{name}-{suffix}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn real_fs_text_binary_rename_and_listing_roundtrip() {
        let root = temp_notebook("fs-roundtrip");

        write_file_at(&root, "/notes/hello.md", "# Hello\n\n真实 FS 验证").unwrap();
        assert_eq!(
            read_file_at(&root, "/notes/hello.md").unwrap(),
            "# Hello\n\n真实 FS 验证"
        );

        let payload = general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G', 0x0d, 0x0a]);
        write_binary_file_at(&root, "/assets/img.png", &payload).unwrap();
        assert_eq!(
            read_binary_file_at(&root, "/assets/img.png").unwrap(),
            payload
        );
        assert_ne!(
            std::fs::read_to_string(root.join("assets/img.png")).unwrap_or_default(),
            read_binary_file_at(&root, "/assets/img.png").unwrap()
        );

        rename_file_at(&root, "/notes/hello.md", "/notes/renamed.md").unwrap();
        assert!(read_file_at(&root, "/notes/hello.md").is_err());
        assert_eq!(
            read_file_at(&root, "/notes/renamed.md").unwrap(),
            "# Hello\n\n真实 FS 验证"
        );
        write_file_at(&root, "/notes/long-form.markdown", "# Markdown").unwrap();
        write_file_at(&root, "/notes/component.mdx", "# MDX").unwrap();
        write_file_at(&root, "/notes/plain.txt", "Plain text").unwrap();
        std::fs::write(root.join("notes").join("export.pdf"), b"not listed").unwrap();
        std::fs::write(root.join("notes").join("renamed.md.bak"), b"not listed").unwrap();

        let root_entries = list_directory_at(&root, "/").unwrap();
        assert!(root_entries
            .iter()
            .any(|entry| entry.path == "/notes" && entry.is_dir));
        let note_entries = list_directory_at(&root, "/notes").unwrap();
        let note_paths = note_entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert!(note_paths.contains(&"/notes/renamed.md"));
        assert!(note_paths.contains(&"/notes/long-form.markdown"));
        assert!(note_paths.contains(&"/notes/component.mdx"));
        assert!(note_paths.contains(&"/notes/plain.txt"));
        assert!(!note_paths.contains(&"/notes/export.pdf"));
        assert!(!note_paths.contains(&"/notes/renamed.md.bak"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn real_fs_rejects_path_escape() {
        let root = temp_notebook("fs-escape");
        let result = write_file_at(&root, "/../outside.md", "bad");
        assert!(result.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_markdown_file_read_write_roundtrip() {
        let root = temp_notebook("external-markdown");
        let target = root.join("external.mdx");
        std::fs::write(&target, "# External").unwrap();
        let path = target.to_string_lossy().to_string();

        assert_eq!(
            read_external_markdown_file(path.clone()).unwrap(),
            "# External"
        );
        write_external_markdown_file(path.clone(), "# Changed\n\n内容".to_string()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "# Changed\n\n内容"
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_markdown_file_rejects_txt_and_directories() {
        let root = temp_notebook("external-reject");
        let txt = root.join("plain.txt");
        std::fs::write(&txt, "plain").unwrap();

        assert!(read_external_markdown_file(txt.to_string_lossy().to_string()).is_err());
        assert!(read_external_markdown_file(root.to_string_lossy().to_string()).is_err());

        std::fs::remove_dir_all(root).unwrap();
    }
}
