# JotLuck Rust 代码规范

> 版本：v1.0 | 日期：2026-06-03
> 关联文档：`doc/TAD.md`（Rust 模块架构）、`PRODUCT.md`（"精确"、"轻量是道德"）

---

## 一、Rust 版本与工具链

```toml
# Cargo.toml
[package]
edition = "2021"
rust-version = "1.80"  # MSRV

[profile.release]
strip = "symbols"
lto = true
panic = "abort"
opt-level = "s"  # 轻量化优先（Size）
codegen-units = 1
```

### Lint 配置

```toml
# src-tauri/Cargo.toml
[lints.clippy]
all = "warn"
pedantic = "warn"
nursery = "warn"
```

所有 Clippy 警告视为错误（`cargo clippy -- -D warnings`）。

---

## 二、模块结构

```
src-tauri/src/
├── main.rs            # Tauri 入口，插件注册，状态初始化
├── lib.rs             # 库根，re-export 模块
├── fs_ops/            # 文件系统操作
│   ├── mod.rs
│   ├── read.rs        # 文件读取 + 编码检测
│   ├── write.rs       # 原子写入（tmp → rename）
│   └── watch.rs       # notify crate 文件监控
├── indexer/           # tantivy 全文索引
│   ├── mod.rs
│   ├── schema.rs      # 索引 Schema 定义
│   ├── build.rs       # 索引构建 / 增量更新
│   └── search.rs      # 搜索查询（正则/标签/日期过滤）
├── exporter/          # 文档导出（未来）
│   └── mod.rs
└── template/          # 模板引擎
    ├── mod.rs
    └── engine.rs      # 占位符替换
```

**规则**：

- 每个目录有 `mod.rs`
- 单文件 ≤ 500 行
- 功能按模块隔离，模块间通过 `pub(crate)` 暴露

---

## 三、命名规范

| 实体           | 规范             | 示例                             |
| -------------- | ---------------- | -------------------------------- |
| Modules        | snake_case       | `fs_ops`、`file_watch`           |
| Structs        | PascalCase       | `NotebookIndex`、`SearchQuery`   |
| Enums          | PascalCase       | `FileChangeKind`、`ExportFormat` |
| Enum 成员      | PascalCase       | `FileChangeKind::Created`        |
| Traits         | PascalCase       | `FileSystem`、`Indexable`        |
| Functions      | snake_case       | `read_file`、`build_index`       |
| Constants      | UPPER_SNAKE_CASE | `MAX_FILE_SIZE`、`INDEX_DIR`     |
| Variables      | snake_case       | `file_path`、`note_content`      |
| Tauri Commands | snake_case       | `read_note`、`list_notebooks`    |

```rust
// ✅ 正确
#[tauri::command]
async fn read_note(path: String) -> Result<String, String> {
    // ...
}

// ❌ 禁止
#[tauri::command]
async fn ReadNote(path: String) -> Result<String, String> { }
```

---

## 四、错误处理

### 4.1 自定义错误类型

```rust
// ✅ 使用 thiserror 定义模块级错误
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FsError {
    #[error("文件不存在: {0}")]
    NotFound(String),

    #[error("权限不足: {0}")]
    PermissionDenied(String),

    #[error("路径遍历攻击检测: {0}")]
    PathTraversal(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

pub type FsResult<T> = Result<T, FsError>;
```

### 4.2 unwrap / expect 规则

```rust
// ✅ expect 仅在初始化阶段（程序无法继续的情况）
let config = load_config().expect("无法加载配置文件，程序退出");

// ❌ 禁止：业务逻辑中 unwrap
let content = std::fs::read_to_string(path).unwrap(); // 文件不存在会 panic

// ✅ 正确：传播错误
let content = std::fs::read_to_string(path)
    .map_err(|e| FsError::Io(e))?;
```

### 4.3 错误日志

```rust
use tracing::{info, warn, error, debug};

// ✅ 每个错误都记录上下文
if let Err(e) = save_note(&path, &content) {
    error!(path = %path, error = %e, "保存笔记失败");
    return Err(e.to_string());
}

// ✅ 关键操作记录
info!(path = %path, size = content.len(), "笔记已保存");
debug!(path = %path, "开始读取文件");
```

---

## 五、文件操作安全（最高优先级）

### 5.1 路径校验

```rust
use std::path::{Path, PathBuf};

/// 验证路径是否在笔记本根目录内（防止路径遍历攻击）
fn is_safe_path(root: &Path, target: &Path) -> bool {
    let canonical_root = root.canonicalize().unwrap_or_default();
    let canonical_target = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => return false, // 不存在的路径默认不安全
    };
    canonical_target.starts_with(&canonical_root)
}

// ✅ 每次文件操作前校验
pub fn read_note(root: &Path, relative_path: &str) -> FsResult<String> {
    let target = root.join(relative_path);
    if !is_safe_path(root, &target) {
        return Err(FsError::PathTraversal(relative_path.to_string()));
    }
    // ... 执行读取
}
```

### 5.2 原子写入

```rust
use std::fs;
use tempfile::NamedTempFile;

/// 原子写入：先写临时文件，再 rename（防止写入中断导致文件损坏）
pub fn atomic_write(path: &Path, content: &str) -> FsResult<()> {
    let parent = path.parent().ok_or(FsError::NotFound("无父目录".into()))?;

    // 写入临时文件
    let tmp = NamedTempFile::new_in(parent)?;
    fs::write(tmp.path(), content)?;

    // 原子替换
    tmp.persist(path)?;
    Ok(())
}
```

### 5.3 文件大小检查

```rust
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024; // 5MB

pub fn read_note_safe(path: &Path) -> FsResult<String> {
    let meta = fs::metadata(path)?;

    if meta.len() > MAX_FILE_SIZE {
        return Err(FsError::FileTooLarge(path.to_string_lossy().into()));
    }

    // 显式 UTF-8 编码
    let content = fs::read_to_string(path)?;
    Ok(content)
}
```

### 5.4 路径规范化

```rust
/// 统一路径分隔符为 /（处理 Windows \）
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// 拼接路径并规范化
fn join_safe(root: &Path, relative: &str) -> PathBuf {
    let joined = root.join(relative);
    PathBuf::from(normalize_path(&joined.to_string_lossy()))
}
```

---

## 六、Tauri 命令规范

```rust
// ✅ 命令是薄包装，业务逻辑在 service 层
#[tauri::command]
async fn save_note(
    state: tauri::State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    // 1. 校验
    let service = state.fs_service.lock().await;
    // 2. 委托给 service
    service.save(&path, &content).map_err(|e| e.to_string())
}

// ❌ 禁止：命令中写业务逻辑
#[tauri::command]
async fn save_note(path: String, content: String) -> Result<(), String> {
    // 直接在命令中写文件操作 → 不可测试，不可复用
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}
```

### 状态管理

```rust
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub fs_service: Arc<Mutex<FsService>>,
    pub indexer: Arc<Mutex<Indexer>>,
}

// main.rs 中注册
app.manage(AppState {
    fs_service: Arc::new(Mutex::new(FsService::new(notebook_root))),
    indexer: Arc::new(Mutex::new(Indexer::new(index_path))),
});
```

---

## 七、测试

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_atomic_write_and_read() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        let content = "# 你好世界\n\n测试内容";

        // 写入
        atomic_write(&path, content).unwrap();
        // 回读验证
        let result = read_note_safe(&path).unwrap();
        assert_eq!(result, content);
    }

    #[test]
    fn test_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let result = is_safe_path(dir.path(), Path::new("/etc/passwd"));
        assert!(!result);
    }

    #[test]
    fn test_rejects_large_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("large.md");
        // 创建 >5MB 的文件（快速分配）
        let f = std::fs::File::create(&path).unwrap();
        f.set_len(MAX_FILE_SIZE + 1).unwrap();
        let result = read_note_safe(&path);
        assert!(result.is_err());
    }
}
```

**测试要求**：

- 正常路径 + 错误路径 + 路径遍历攻击 + 边界值
- 使用 `tempfile` 创建隔离的测试环境
- `cargo test` 全量 PASS 才能提交

---

## 八、日志

```rust
use tracing::{info, warn, error, debug, trace};

// 级别定义：
// ERROR — 用户可见的失败（文件保存失败）
// WARN  — 可恢复的异常（索引不一致，触发重建）
// INFO  — 关键操作（笔记本已加载，索引已构建）
// DEBUG — 开发细节（文件内容变更，搜索查询）
// TRACE — 所有操作（每次文件读取）
```

---

## 九、依赖管理

```toml
# ✅ 指定确切版本
[dependencies]
tantivy = "0.22"
notify = { version = "7", features = ["macos_kqueue"] }
thiserror = "2"

# ❌ 禁止
some-crate = "*"
another = ">=1.0"
```

- 新增依赖前评估：维护状态、License（MIT/Apache 2.0 兼容）、体积
- `cargo audit` CI 检查

---

## 十、禁止事项

| 禁止                               | 替代方案                             |
| ---------------------------------- | ------------------------------------ |
| `unsafe { }` 无 `// SAFETY:` 注释  | 加注释解释为什么 unsafe 是安全的     |
| `unwrap()` / `expect()` 在业务代码 | 使用 `?` 传播或 `match` 处理         |
| `panic!()` 在库代码                | 返回 `Result::Err`                   |
| `std::process::exit()`             | 通过 Result 传播到 main              |
| 笔记本根目录外的文件操作           | `is_safe_path()` 校验                |
| 同步 I/O 在 async 上下文           | 使用 `tokio::fs` 或 `spawn_blocking` |
| `.clone()` 无理由                  | 优先用引用或 `Rc`/`Arc`              |
| 硬编码路径                         | 从配置/状态获取                      |
