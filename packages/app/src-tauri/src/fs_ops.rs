// M6-03: File system operations
//
// Tauri IPC commands for reading, writing, deleting, and listing note files.
// All operations go through path::resolve_safe_path for security.

use crate::path::{is_ignored_notebook_directory_name, resolve_safe_path};
use crate::window_session::WindowSessionRegistry;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

static WRITE_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
const MAX_EXTERNAL_NOTE_BYTES: u64 = 5 * 1024 * 1024;

/// Per-window notebook roots. A webview must never observe another window's
/// active notebook simply because both windows share the same process.
pub struct NotebookRoot(pub std::sync::Mutex<HashMap<String, PathBuf>>);

impl NotebookRoot {
    pub fn new() -> Self {
        Self(std::sync::Mutex::new(HashMap::new()))
    }

    pub fn get_for(&self, window_label: &str) -> Option<PathBuf> {
        self.0.lock().ok()?.get(window_label).cloned()
    }

    pub fn set_for(&self, window_label: &str, path: PathBuf) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "notebook root state lock poisoned".to_string())?
            .insert(window_label.to_string(), path);
        Ok(())
    }

    pub fn remove_for(&self, window_label: &str) {
        if let Ok(mut roots) = self.0.lock() {
            roots.remove(window_label);
        }
    }
}

const EXTERNAL_GRANT_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

fn external_path_to_slash(path: &Path) -> String {
    let slash = path.to_string_lossy().replace('\\', "/");
    if let Some(unc) = slash.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        slash.strip_prefix("//?/").unwrap_or(&slash).to_string()
    }
}

/// Opaque capability returned by the backend after a native file association or dialog.
/// The renderer must never use an absolute path as an authorization credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileHandle {
    pub access_token: String,
    pub absolute_path: String,
    pub notebook_root: String,
    pub relative_path: String,
    pub capabilities: ExternalAccessCapabilities,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAccessCapabilities {
    pub read: bool,
    pub write: bool,
    pub list: bool,
    pub watch: bool,
}

impl ExternalAccessCapabilities {
    const fn opened_file() -> Self {
        Self {
            read: true,
            write: false,
            list: false,
            watch: false,
        }
    }

    const fn saved_file() -> Self {
        Self {
            read: true,
            write: true,
            list: false,
            watch: false,
        }
    }
}

fn can_read(capabilities: ExternalAccessCapabilities) -> bool {
    capabilities.read
}

fn can_write(capabilities: ExternalAccessCapabilities) -> bool {
    capabilities.write
}

#[derive(Debug, Clone)]
struct ExternalAccessGrant {
    owner_window_label: String,
    root: PathBuf,
    file: PathBuf,
    directory_access: bool,
    capabilities: ExternalAccessCapabilities,
    expires_at: Instant,
}

/// In-memory, session-scoped external file capabilities.
/// Grants are never persisted and expire after inactivity.
pub struct ExternalAccessGrants(Mutex<HashMap<String, ExternalAccessGrant>>);

impl ExternalAccessGrants {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    pub fn grant_for_existing_file(
        &self,
        absolute_path: &str,
        owner_window_label: &str,
    ) -> Result<ExternalFileHandle, String> {
        let target = resolve_external_note_file(absolute_path)?;
        self.issue_grant(
            target,
            ExternalAccessCapabilities::opened_file(),
            owner_window_label,
        )
    }

    pub fn grant_for_saved_file(
        &self,
        absolute_path: &str,
        owner_window_label: &str,
    ) -> Result<ExternalFileHandle, String> {
        let target = resolve_external_note_file_for_write(absolute_path)?;
        self.issue_grant(
            target,
            ExternalAccessCapabilities::saved_file(),
            owner_window_label,
        )
    }

    fn issue_grant(
        &self,
        target: PathBuf,
        capabilities: ExternalAccessCapabilities,
        owner_window_label: &str,
    ) -> Result<ExternalFileHandle, String> {
        let root = target
            .parent()
            .ok_or_else(|| "external file has no parent directory".to_string())?
            .canonicalize()
            .map_err(|e| format!("unable to resolve external file parent: {e}"))?;
        let target = target
            .canonicalize()
            .map_err(|e| format!("unable to resolve external file: {e}"))?;
        let relative_path = format!(
            "/{}",
            crate::path::display_path(&root, &target).trim_start_matches('/')
        );
        let access_token = Uuid::new_v4().simple().to_string();
        let grant = ExternalAccessGrant {
            owner_window_label: owner_window_label.to_string(),
            root: root.clone(),
            file: target.clone(),
            directory_access: false,
            capabilities,
            expires_at: Instant::now() + EXTERNAL_GRANT_IDLE_TIMEOUT,
        };
        self.0
            .lock()
            .map_err(|_| "external access state lock poisoned".to_string())?
            .insert(access_token.clone(), grant);

        Ok(ExternalFileHandle {
            access_token,
            absolute_path: external_path_to_slash(&target),
            notebook_root: external_path_to_slash(&root),
            relative_path,
            capabilities,
        })
    }

    pub fn revoke(&self, access_token: &str) {
        if let Ok(mut grants) = self.0.lock() {
            grants.remove(access_token);
        }
    }

    pub fn revoke_for_window(&self, window_label: &str) {
        if let Ok(mut grants) = self.0.lock() {
            grants.retain(|_, grant| grant.owner_window_label != window_label);
        }
    }

    pub fn assert_owner(&self, access_token: &str, window_label: &str) -> Result<(), String> {
        let grants = self
            .0
            .lock()
            .map_err(|_| "external access state lock poisoned".to_string())?;
        let grant = grants
            .get(access_token)
            .ok_or_else(|| "external access grant is invalid or expired".to_string())?;
        if grant.owner_window_label != window_label {
            return Err("external access grant belongs to another window".to_string());
        }
        Ok(())
    }

    /// Upgrade only the bootstrap file owned by this window.  Directory access
    /// remains disabled until the explicit notebook-promotion command runs.
    pub fn enable_file_write(
        &self,
        access_token: &str,
        window_label: &str,
        absolute_path: &str,
    ) -> Result<(), String> {
        let mut grants = self
            .0
            .lock()
            .map_err(|_| "external access state lock poisoned".to_string())?;
        let grant = grants
            .get_mut(access_token)
            .ok_or_else(|| "external access grant is invalid or expired".to_string())?;
        if grant.expires_at <= Instant::now() {
            grants.remove(access_token);
            return Err("external access grant is invalid or expired".to_string());
        }
        if grant.owner_window_label != window_label
            || external_path_to_slash(&grant.file) != absolute_path
            || grant.directory_access
        {
            return Err(
                "external edit grant does not match this window bootstrap file".to_string(),
            );
        }
        grant.capabilities.write = true;
        grant.expires_at = Instant::now() + EXTERNAL_GRANT_IDLE_TIMEOUT;
        Ok(())
    }

    pub fn disable_file_write(&self, access_token: &str) {
        if let Ok(mut grants) = self.0.lock() {
            if let Some(grant) = grants.get_mut(access_token) {
                if !grant.directory_access {
                    grant.capabilities.write = false;
                }
            }
        }
    }

    fn grant(
        &self,
        access_token: &str,
        capability: fn(ExternalAccessCapabilities) -> bool,
    ) -> Result<ExternalAccessGrant, String> {
        let mut grants = self
            .0
            .lock()
            .map_err(|_| "external access state lock poisoned".to_string())?;
        let grant = grants
            .get_mut(access_token)
            .ok_or_else(|| "external access grant is invalid or expired".to_string())?;
        if grant.expires_at <= Instant::now() {
            grants.remove(access_token);
            return Err("external access grant is invalid or expired".to_string());
        }
        if !capability(grant.capabilities) {
            return Err("external access grant does not allow this operation".to_string());
        }
        grant.expires_at = Instant::now() + EXTERNAL_GRANT_IDLE_TIMEOUT;
        Ok(grant.clone())
    }

    pub fn resolve_file(
        &self,
        access_token: &str,
        relative_path: &str,
        markdown_only: bool,
        for_write: bool,
    ) -> Result<PathBuf, String> {
        let grant = self.grant(access_token, if for_write { can_write } else { can_read })?;
        let root = grant.root.clone();
        let target = resolve_safe_path(&root, relative_path).map_err(|e| e.to_string())?;
        let name = target
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "external relative path must name a file".to_string())?;
        if markdown_only {
            if !is_markdown_like_file(name) {
                return Err("only .md/.markdown/.mdx files are supported".to_string());
            }
        } else if !is_supported_note_file(name) {
            return Err("only .md/.markdown/.mdx/.txt files are supported".to_string());
        }
        if !for_write && (!target.exists() || !target.is_file()) {
            return Err(format!("external note does not exist: {relative_path}"));
        }
        if for_write {
            let parent = target
                .parent()
                .ok_or_else(|| "external file has no parent directory".to_string())?;
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("unable to resolve external file parent: {e}"))?;
            if !canonical_parent.starts_with(&root) {
                return Err("external path escapes the granted directory".to_string());
            }
            if target.exists() {
                let canonical_target = target
                    .canonicalize()
                    .map_err(|e| format!("unable to resolve external target: {e}"))?;
                if !canonical_target.starts_with(&root) || !canonical_target.is_file() {
                    return Err("external path is outside the granted directory".to_string());
                }
                if !grant.directory_access && canonical_target != grant.file {
                    return Err("external file grant does not allow sibling files".to_string());
                }
                return Ok(canonical_target);
            }
            if !grant.directory_access {
                return Err("external file grant does not allow creating sibling files".to_string());
            }
            return Ok(canonical_parent.join(
                target
                    .file_name()
                    .ok_or_else(|| "external file has no name".to_string())?,
            ));
        }

        let canonical_target = target
            .canonicalize()
            .map_err(|e| format!("unable to resolve external target: {e}"))?;
        if !canonical_target.starts_with(&root) || !canonical_target.is_file() {
            return Err("external path is outside the granted directory".to_string());
        }
        if !grant.directory_access && canonical_target != grant.file {
            return Err("external file grant does not allow sibling files".to_string());
        }
        Ok(canonical_target)
    }

    pub fn promote_to_notebook_after_validation(
        &self,
        access_token: &str,
        commit_root: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        let mut grants = self
            .0
            .lock()
            .map_err(|_| "external access state lock poisoned".to_string())?;
        let grant = grants
            .get_mut(access_token)
            .ok_or_else(|| "external access grant is invalid or expired".to_string())?;
        if grant.expires_at <= Instant::now() {
            grants.remove(access_token);
            return Err("external access grant is invalid or expired".to_string());
        }
        let canonical_root = canonical_readable_notebook_root(&grant.root)?;
        commit_root(&canonical_root)?;
        grant.root = canonical_root.clone();
        grant.directory_access = true;
        grant.capabilities.list = true;
        grant.capabilities.watch = true;
        grant.expires_at = Instant::now() + EXTERNAL_GRANT_IDLE_TIMEOUT;
        Ok(canonical_root)
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

fn resolve_external_note_file_for_write(absolute_path: &str) -> Result<PathBuf, String> {
    resolve_external_file_for_write(absolute_path, false)
}

fn resolve_external_file_for_write(
    absolute_path: &str,
    markdown_only: bool,
) -> Result<PathBuf, String> {
    let path = PathBuf::from(absolute_path);
    if !path.is_absolute() {
        return Err("外部文件路径必须是绝对路径".to_string());
    }
    if markdown_only && !is_markdown_like_file(absolute_path) {
        return Err("仅支持打开 .md/.markdown/.mdx 文件".to_string());
    }
    if !markdown_only && !is_supported_note_file(absolute_path) {
        return Err("仅支持打开 .md/.markdown/.mdx/.txt 文件".to_string());
    }
    if path.exists() {
        if !path.is_file() {
            return Err(format!("路径不是文件: {}", absolute_path));
        }
        return path
            .canonicalize()
            .map_err(|e| format!("无法解析外部文件路径: {}", e));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "外部文件缺少父目录".to_string())?;
    if !parent.exists() || !parent.is_dir() {
        return Err(format!("父目录不存在: {}", parent.display()));
    }
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("无法解析外部文件父目录: {}", e))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "外部文件缺少文件名".to_string())?;
    Ok(parent.join(file_name))
}

fn unique_write_temp_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "无法解析目标文件目录".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "无法解析目标文件名".to_string())?;
    let counter = WRITE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(counter as u128);
    let process_id = std::process::id();

    Ok(parent.join(format!(
        ".{file_name}.{process_id}.{timestamp}.{counter}.tmp"
    )))
}

#[cfg(windows)]
fn replace_file(tmp_path: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    fn to_wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let tmp_wide = to_wide(tmp_path);
    let target_wide = to_wide(target);
    let result = unsafe {
        MoveFileExW(
            tmp_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(tmp_path: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(tmp_path, target)
}

fn write_text_file_atomically(target: &Path, content: &str) -> Result<(), String> {
    let tmp_path = unique_write_temp_path(target)?;
    fs::write(&tmp_path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    replace_file(&tmp_path, target).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("保存文件失败: {}", e)
    })
}

// ============================================================
// IPC Commands
// ============================================================

fn notebook_root_for(window: &WebviewWindow, root: &NotebookRoot) -> Result<PathBuf, String> {
    root.get_for(window.label())
        .ok_or_else(|| "未打开笔记本".to_string())
}

fn assert_external_owner(
    window: &WebviewWindow,
    access: &ExternalAccessGrants,
    access_token: &str,
) -> Result<(), String> {
    access.assert_owner(access_token, window.label())
}

fn assert_workspace(
    window: &WebviewWindow,
    sessions: &WindowSessionRegistry,
) -> Result<(), String> {
    sessions.assert_workspace(window.label())
}

fn assert_external_edit(
    window: &WebviewWindow,
    sessions: &WindowSessionRegistry,
    access_token: &str,
) -> Result<(), String> {
    sessions.assert_external_edit(window.label(), access_token)
}

/// Resolve a notebook directory only after proving it can be read. Keeping this
/// separate from the Tauri command makes the bind-before-validate invariant testable.
pub(crate) fn canonical_readable_notebook_root(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("文件夹不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("路径不是文件夹: {}", path.display()));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {e}"))?;
    fs::read_dir(canonical.as_path()).map_err(|e| format!("无法读取笔记本文件夹: {e}"))?;
    Ok(canonical)
}

fn bind_notebook_root(
    root: &NotebookRoot,
    window_label: &str,
    path: &Path,
) -> Result<PathBuf, String> {
    let canonical = canonical_readable_notebook_root(path)?;
    root.set_for(window_label, canonical.clone())?;
    Ok(canonical)
}

/// Open a notebook folder — all subsequent operations are relative to this root.
#[tauri::command]
pub fn open_notebook(
    window: WebviewWindow,
    path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<String, String> {
    assert_workspace(&window, &sessions)?;
    let canonical = bind_notebook_root(&root, window.label(), Path::new(&path))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Promote an already-authorized external file grant to its parent notebook.
/// The renderer submits only the opaque grant token; the backend resolves the
/// canonical directory and becomes the sole owner of the active notebook root.
#[tauri::command]
pub fn open_external_notebook(
    window: WebviewWindow,
    access_token: String,
    access: State<ExternalAccessGrants>,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<String, String> {
    // This legacy path is retained for saving a scratch note from a workspace
    // window. External-file windows must use promote_external_file_to_notebook,
    // which updates the bootstrap session and notebook root atomically.
    sessions.assert_workspace(window.label())?;
    assert_external_owner(&window, &access, &access_token)?;
    let canonical = access.promote_to_notebook_after_validation(&access_token, |canonical| {
        root.set_for(window.label(), canonical.to_path_buf())
    })?;
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
pub fn open_sample_notebook(
    window: WebviewWindow,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<String, String> {
    assert_workspace(&window, &sessions)?;
    let sample_root = local_app_data_dir()?.join("JotLuck").join("示例笔记本");
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

# 欢迎使用 JotLuck

JotLuck 是一款轻量、本地优先、离线可用的 Markdown 笔记工具。每一条笔记都是普通的 .md 文件，文件夹就是笔记本。

## 从这里开始

- 在左侧书签中切换常用笔记。
- 点击文件抽屉浏览当前文件夹。
- 使用 Ctrl+K 搜索笔记、标签和正文。
- 通过 [[格式示例]] 查看常用 Markdown 写法。
- 关联项目资料：[[项目规划]]。
- 外部链接示例：[JotLuck GitHub](https://github.com)。

> JotLuck 只增强写作体验，不接管你的数据。
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
    root.set_for(window.label(), canonical.clone())?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Get the current notebook root path.
#[tauri::command]
pub fn get_notebook_root(
    window: WebviewWindow,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<String, String> {
    assert_workspace(&window, &sessions)?;
    root.get_for(window.label())
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "未打开笔记本".to_string())
}

/// List supported note files and directories in a given directory (relative to notebook root).
#[tauri::command]
pub fn list_directory(
    window: WebviewWindow,
    relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<Vec<DirEntry>, String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    list_directory_at(&root_path, &relative_path)
}

fn list_directory_at(root_path: &Path, relative_path: &str) -> Result<Vec<DirEntry>, String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;
    list_directory_entries(root_path, &target)
}

fn list_directory_entries(root_path: &Path, target: &Path) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let dir_iter = fs::read_dir(target).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in dir_iter {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        let metadata = entry.metadata().ok();

        // The file drawer is a note manager: show directories and editable text notes only.
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() && is_ignored_notebook_directory_name(&entry.file_name()) {
            continue;
        }
        if name.starts_with('.') {
            continue;
        }
        if !file_type.is_dir() && !is_supported_note_file(&name) {
            continue;
        }

        let rel = crate::path::display_path(root_path, &entry.path());

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
pub fn read_file(
    window: WebviewWindow,
    relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<String, String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    read_file_at(&root_path, &relative_path)
}

fn read_file_at(root_path: &Path, relative_path: &str) -> Result<String, String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    fs::read_to_string(&target).map_err(|e| format!("读取文件失败: {}", e))
}

fn read_external_note_content(target: &Path) -> Result<String, String> {
    let size = fs::metadata(target)
        .map_err(|e| format!("读取外部文件元数据失败: {e}"))?
        .len();
    if size > MAX_EXTERNAL_NOTE_BYTES {
        return Err(format!(
            "外部文件超过 5 MB，已停止加载以避免应用无响应（当前 {:.1} MB）",
            size as f64 / (1024.0 * 1024.0)
        ));
    }
    fs::read_to_string(target).map_err(|e| format!("读取外部文件失败: {e}"))
}

/// Read one markdown-family file by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn read_external_markdown_file(
    window: WebviewWindow,
    access_token: String,
    relative_path: String,
    access: State<ExternalAccessGrants>,
) -> Result<String, String> {
    assert_external_owner(&window, &access, &access_token)?;
    let target = access.resolve_file(&access_token, &relative_path, true, false)?;
    read_external_note_content(&target)
}

#[cfg(test)]
fn read_external_markdown_file_with_access(
    absolute_path: &str,
    access: &ExternalAccessGrants,
) -> Result<String, String> {
    let handle = access.grant_for_saved_file(absolute_path, "test")?;
    let target = access.resolve_file(&handle.access_token, &handle.relative_path, true, false)?;
    read_external_note_content(&target)
}

/// Read one supported text note by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn read_external_note_file(
    window: WebviewWindow,
    access_token: String,
    relative_path: String,
    access: State<ExternalAccessGrants>,
) -> Result<String, String> {
    assert_external_owner(&window, &access, &access_token)?;
    let target = access.resolve_file(&access_token, &relative_path, false, false)?;
    read_external_note_content(&target)
}

/// Write content to a file (relative to notebook root).
/// Uses atomic write: write to temp file first, then rename.
#[tauri::command]
pub fn write_file(
    window: WebviewWindow,
    relative_path: String,
    content: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    write_file_at(&root_path, &relative_path, &content)
}

fn write_file_at(root_path: &Path, relative_path: &str, content: &str) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    write_text_file_atomically(&target, content)?;

    Ok(())
}

/// Write one markdown-family file by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn write_external_markdown_file(
    window: WebviewWindow,
    access_token: String,
    relative_path: String,
    content: String,
    access: State<ExternalAccessGrants>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_external_edit(&window, &sessions, &access_token)?;
    assert_external_owner(&window, &access, &access_token)?;
    let target = access.resolve_file(&access_token, &relative_path, true, true)?;
    write_text_file_atomically(&target, &content)
}

#[cfg(test)]
fn write_external_markdown_file_with_access(
    absolute_path: &str,
    content: &str,
    access: &ExternalAccessGrants,
) -> Result<(), String> {
    let handle = access.grant_for_saved_file(absolute_path, "test")?;
    let target = access.resolve_file(&handle.access_token, &handle.relative_path, true, true)?;
    write_text_file_atomically(&target, content).map_err(|e| format!("保存外部文件失败: {}", e))
}

/// Write one supported text note by absolute path without opening its parent as notebook.
#[tauri::command]
pub fn write_external_note_file(
    window: WebviewWindow,
    access_token: String,
    relative_path: String,
    content: String,
    access: State<ExternalAccessGrants>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_external_edit(&window, &sessions, &access_token)?;
    assert_external_owner(&window, &access, &access_token)?;
    let target = access.resolve_file(&access_token, &relative_path, false, true)?;
    write_text_file_atomically(&target, &content).map_err(|e| format!("保存外部文件失败: {}", e))
}

/// Open the native save dialog, write the selected note, then issue its grant.
/// The renderer receives only the opaque handle and never authorizes the path.
#[tauri::command]
pub fn save_external_note_as(
    window: WebviewWindow,
    app: AppHandle,
    default_file_name: String,
    content: String,
    access: State<ExternalAccessGrants>,
    sessions: State<WindowSessionRegistry>,
) -> Result<ExternalFileHandle, String> {
    assert_workspace(&window, &sessions)?;
    let selected = app
        .dialog()
        .file()
        .set_title("Save Markdown note")
        .set_file_name(default_file_name)
        .add_filter("Markdown", &["md", "markdown", "mdx", "txt"])
        .blocking_save_file()
        .ok_or_else(|| "save dialog was cancelled".to_string())?;
    let path = selected
        .into_path()
        .map_err(|e| format!("unable to resolve selected save path: {e}"))?;
    let path_text = path.to_string_lossy().to_string();
    let target = resolve_external_note_file_for_write(&path_text)?;
    write_text_file_atomically(&target, &content)?;
    access.grant_for_saved_file(&path_text, window.label())
}

#[tauri::command]
pub fn revoke_external_access(
    window: WebviewWindow,
    access_token: String,
    access: State<ExternalAccessGrants>,
) -> Result<(), String> {
    assert_external_owner(&window, &access, &access_token)?;
    access.revoke(&access_token);
    Ok(())
}

/// Write binary content to a file (base64 payload, relative to notebook root).
#[tauri::command]
pub fn write_binary_file(
    window: WebviewWindow,
    relative_path: String,
    base64: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    write_binary_file_at(&root_path, &relative_path, &base64)
}

fn write_binary_file_at(root_path: &Path, relative_path: &str, base64: &str) -> Result<(), String> {
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
    window: WebviewWindow,
    relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<String, String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    read_binary_file_at(&root_path, &relative_path)
}

fn read_binary_file_at(root_path: &Path, relative_path: &str) -> Result<String, String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    let bytes = fs::read(&target).map_err(|e| format!("读取二进制文件失败: {}", e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

/// Delete a file — moves to system recycle bin (Windows/macOS/Linux).
#[tauri::command]
pub fn delete_file(
    window: WebviewWindow,
    relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    delete_file_at(&root_path, &relative_path)
}

fn delete_file_at(root_path: &Path, relative_path: &str) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;

    if !target.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }

    trash::delete(&target).map_err(|e| format!("删除失败: {}", e))
}

/// Create a new directory (relative to notebook root).
#[tauri::command]
pub fn create_directory(
    window: WebviewWindow,
    relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    create_directory_at(&root_path, &relative_path)
}

fn create_directory_at(root_path: &Path, relative_path: &str) -> Result<(), String> {
    let target = resolve_safe_path(root_path, relative_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(&target).map_err(|e| format!("创建文件夹失败: {}", e))
}

/// Rename / move a file within the notebook.
#[tauri::command]
pub fn rename_file(
    window: WebviewWindow,
    old_relative_path: String,
    new_relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<(), String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
    rename_file_at(&root_path, &old_relative_path, &new_relative_path)
}

fn rename_file_at(
    root_path: &Path,
    old_relative_path: &str,
    new_relative_path: &str,
) -> Result<(), String> {
    let old_target = resolve_safe_path(root_path, old_relative_path).map_err(|e| e.to_string())?;
    let new_target = resolve_safe_path(root_path, new_relative_path).map_err(|e| e.to_string())?;

    if !old_target.exists() {
        return Err(format!("文件不存在: {}", old_relative_path));
    }
    if old_target == new_target {
        return Ok(());
    }
    if new_target.exists() {
        return Err(format!("目标文件已存在: {}", new_relative_path));
    }
    if let Some(parent) = new_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
    }
    fs::rename(&old_target, &new_target).map_err(|e| format!("重命名失败: {}", e))
}

/// Get file metadata (mtime, size) for conflict detection.
#[tauri::command]
pub fn get_file_meta(
    window: WebviewWindow,
    relative_path: String,
    root: State<NotebookRoot>,
    sessions: State<WindowSessionRegistry>,
) -> Result<DirEntry, String> {
    assert_workspace(&window, &sessions)?;
    let root_path = notebook_root_for(&window, &root)?;
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
        let root = std::env::temp_dir().join(format!("JotLuck-{name}-{suffix}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn failed_notebook_root_binding_preserves_existing_root() {
        let root = temp_notebook("root-bind");
        let old_root = root.join("old");
        std::fs::create_dir_all(&old_root).unwrap();
        let not_a_directory = root.join("not-a-directory.md");
        std::fs::write(&not_a_directory, "# Not a directory").unwrap();

        let notebook_roots = NotebookRoot::new();
        notebook_roots
            .set_for("main", old_root.canonicalize().unwrap())
            .unwrap();

        assert!(bind_notebook_root(&notebook_roots, "main", &not_a_directory).is_err());
        assert_eq!(
            notebook_roots.get_for("main"),
            Some(old_root.canonicalize().unwrap())
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn notebook_root_binding_canonicalizes_and_checks_readability_before_replacing_root() {
        let root = temp_notebook("root-bind-valid");
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("note.md"), "# Note").unwrap();

        let notebook_roots = NotebookRoot::new();
        let bound = bind_notebook_root(&notebook_roots, "main", &target).unwrap();

        assert_eq!(bound, target.canonicalize().unwrap());
        assert_eq!(notebook_roots.get_for("main"), Some(bound));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn poisoned_notebook_root_lock_fails_closed() {
        let roots = NotebookRoot::new();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = roots.0.lock().unwrap();
            panic!("poison notebook root lock");
        }));

        assert!(roots.set_for("main", PathBuf::from("notes")).is_err());
        assert!(roots.get_for("main").is_none());
    }

    #[test]
    fn failed_external_promotion_does_not_expand_grant_capabilities() {
        let root = temp_notebook("failed-external-promotion");
        let target = root.join("external.md");
        std::fs::write(&target, "# External").unwrap();
        let access = ExternalAccessGrants::new();
        let handle = access
            .grant_for_existing_file(&target.to_string_lossy(), "window-a")
            .unwrap();

        std::fs::remove_dir_all(&root).unwrap();

        assert!(access
            .promote_to_notebook_after_validation(&handle.access_token, |_| Ok(()))
            .is_err());
        let grants = access.0.lock().unwrap();
        let grant = grants.get(&handle.access_token).unwrap();
        assert!(!grant.directory_access);
        assert!(!grant.capabilities.list);
        assert!(!grant.capabilities.watch);
    }

    #[test]
    fn failed_root_commit_does_not_expand_external_grant_capabilities() {
        let root = temp_notebook("failed-external-root-commit");
        let target = root.join("external.md");
        std::fs::write(&target, "# External").unwrap();
        let access = ExternalAccessGrants::new();
        let handle = access
            .grant_for_existing_file(&target.to_string_lossy(), "window-a")
            .unwrap();

        assert!(access
            .promote_to_notebook_after_validation(&handle.access_token, |_| {
                Err("root commit failed".to_string())
            })
            .is_err());
        {
            let grants = access.0.lock().unwrap();
            let grant = grants.get(&handle.access_token).unwrap();
            assert!(!grant.directory_access);
            assert!(!grant.capabilities.list);
            assert!(!grant.capabilities.watch);
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_temp_paths_are_unique_for_same_stem_notes() {
        let root = temp_notebook("fs-temp-paths");
        let md = root.join("notes").join("same.md");
        let txt = root.join("notes").join("same.txt");
        std::fs::create_dir_all(md.parent().unwrap()).unwrap();

        let first = unique_write_temp_path(&md).unwrap();
        let second = unique_write_temp_path(&txt).unwrap();
        let third = unique_write_temp_path(&md).unwrap();

        assert_ne!(first, second);
        assert_ne!(first, third);
        assert_eq!(first.parent(), md.parent());
        assert_eq!(second.parent(), txt.parent());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_file_overwrites_existing_note_with_unique_temp_file() {
        let root = temp_notebook("fs-overwrite");

        write_file_at(&root, "/notes/same.md", "first").unwrap();
        write_file_at(&root, "/notes/same.txt", "txt").unwrap();
        write_file_at(&root, "/notes/same.md", "second").unwrap();

        assert_eq!(read_file_at(&root, "/notes/same.md").unwrap(), "second");
        assert_eq!(read_file_at(&root, "/notes/same.txt").unwrap(), "txt");
        assert!(std::fs::read_dir(root.join("notes"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")));

        std::fs::remove_dir_all(root).unwrap();
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
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules").join("README.md"), "generated").unwrap();

        let root_entries = list_directory_at(&root, "/").unwrap();
        assert!(root_entries
            .iter()
            .any(|entry| entry.path == "/notes" && entry.is_dir));
        assert!(!root_entries
            .iter()
            .any(|entry| entry.path == "/node_modules"));
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
    fn rename_rejects_existing_destination_without_data_loss() {
        let root = temp_notebook("rename-collision");
        std::fs::write(root.join("source.md"), "# Source").unwrap();
        std::fs::write(root.join("target.md"), "# Target").unwrap();

        assert!(rename_file_at(&root, "/source.md", "/target.md").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("source.md")).unwrap(),
            "# Source"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("target.md")).unwrap(),
            "# Target"
        );

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
        let access = ExternalAccessGrants::new();
        let handle = access.grant_for_existing_file(&path, "test").unwrap();

        assert_eq!(
            std::fs::read_to_string(
                access
                    .resolve_file(&handle.access_token, &handle.relative_path, true, false)
                    .unwrap(),
            )
            .unwrap(),
            "# External"
        );
        write_external_markdown_file_with_access(&path, "# Changed\n\n内容", &access).unwrap();
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "# Changed\n\n内容"
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opened_file_grant_is_readonly_until_exact_owner_enables_write() {
        let root = temp_notebook("external-readonly-grant");
        let target = root.join("external.md");
        std::fs::write(&target, "# External").unwrap();
        let access = ExternalAccessGrants::new();
        let handle = access
            .grant_for_existing_file(&target.to_string_lossy(), "window-a")
            .unwrap();

        assert!(!handle.capabilities.write);
        assert!(access
            .resolve_file(&handle.access_token, &handle.relative_path, true, true)
            .is_err());
        assert!(access
            .enable_file_write(&handle.access_token, "window-b", &handle.absolute_path)
            .is_err());
        access
            .enable_file_write(&handle.access_token, "window-a", &handle.absolute_path)
            .unwrap();
        assert!(access
            .resolve_file(&handle.access_token, &handle.relative_path, true, true)
            .is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn promoted_grant_never_becomes_a_sibling_write_backdoor() {
        let root = temp_notebook("external-new-file");
        let target = root.join("saved.md");
        let seed = root.join("seed.md");
        std::fs::write(&seed, "# Seed").unwrap();
        std::fs::write(&target, "# Existing").unwrap();
        let access = ExternalAccessGrants::new();
        let handle = access
            .grant_for_existing_file(&seed.to_string_lossy(), "test")
            .unwrap();
        assert!(access
            .resolve_file(&handle.access_token, "/saved.md", true, false)
            .is_err());
        access
            .promote_to_notebook_after_validation(&handle.access_token, |_| Ok(()))
            .unwrap();
        assert!(access
            .resolve_file(&handle.access_token, "/saved.md", true, false)
            .is_ok());
        assert!(access
            .resolve_file(&handle.access_token, "/saved.md", true, true)
            .is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# Existing");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_grants_and_notebook_roots_are_window_scoped() {
        let root = temp_notebook("window-isolation");
        let first = root.join("first.md");
        let second = root.join("second.md");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&second, "second").unwrap();
        let access = ExternalAccessGrants::new();
        let first_handle = access
            .grant_for_existing_file(&first.to_string_lossy(), "window-a")
            .unwrap();
        let second_handle = access
            .grant_for_existing_file(&second.to_string_lossy(), "window-b")
            .unwrap();

        assert!(access
            .assert_owner(&first_handle.access_token, "window-b")
            .is_err());
        assert!(access
            .assert_owner(&second_handle.access_token, "window-a")
            .is_err());
        access.revoke_for_window("window-a");
        assert!(access
            .resolve_file(
                &first_handle.access_token,
                &first_handle.relative_path,
                true,
                false,
            )
            .is_err());
        assert!(access
            .resolve_file(
                &second_handle.access_token,
                &second_handle.relative_path,
                true,
                false,
            )
            .is_ok());

        let roots = NotebookRoot::new();
        roots.set_for("window-a", root.join("a")).unwrap();
        roots.set_for("window-b", root.join("b")).unwrap();
        roots.remove_for("window-a");
        assert!(roots.get_for("window-a").is_none());
        assert_eq!(roots.get_for("window-b"), Some(root.join("b")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_markdown_file_rejects_txt_and_directories() {
        let root = temp_notebook("external-reject");
        let txt = root.join("plain.txt");
        std::fs::write(&txt, "plain").unwrap();
        let access = ExternalAccessGrants::new();
        assert!(
            read_external_markdown_file_with_access(txt.to_string_lossy().as_ref(), &access)
                .is_err()
        );
        assert!(
            read_external_markdown_file_with_access(root.to_string_lossy().as_ref(), &access)
                .is_err()
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_markdown_file_rejects_unregistered_root() {
        let root = temp_notebook("external-unregistered");
        let target = root.join("external.md");
        std::fs::write(&target, "# External").unwrap();
        let access = ExternalAccessGrants::new();

        assert!(access
            .resolve_file("missing-token", "/external.md", true, false)
            .is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_note_read_rejects_files_larger_than_safe_startup_limit() {
        let root = temp_notebook("external-too-large");
        let target = root.join("large.md");
        let file = std::fs::File::create(&target).unwrap();
        file.set_len(MAX_EXTERNAL_NOTE_BYTES + 1).unwrap();

        let error = read_external_note_content(&target).unwrap_err();
        assert!(error.contains("超过 5 MB"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saved_file_grant_records_capabilities_without_directory_access() {
        let root = temp_notebook("external-capabilities");
        let target = root.join("external.md");
        std::fs::write(&target, "# External").unwrap();
        let access = ExternalAccessGrants::new();
        let handle = access
            .grant_for_saved_file(&target.to_string_lossy(), "test")
            .unwrap();

        assert!(handle.capabilities.read);
        assert!(handle.capabilities.write);
        assert!(!handle.capabilities.list);
        assert!(!handle.capabilities.watch);
        assert!(access
            .promote_to_notebook_after_validation(&handle.access_token, |_| Ok(()))
            .is_ok());

        std::fs::remove_dir_all(root).unwrap();
    }
}
