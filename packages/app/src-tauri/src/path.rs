// M6-07: Path safety validation
//
// Ensures all file operations stay within the notebook root directory.
// Prevents path traversal attacks and cross-directory access.

use std::fmt;
use std::path::{Path, PathBuf};

/// Errors that can occur during path validation.
#[derive(Debug)]
pub enum PathError {
    PathTraversal(String),
    InvalidChars(String),
    EmptyPath,
}

impl fmt::Display for PathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PathError::PathTraversal(p) => write!(f, "路径超出笔记本根目录: {}", p),
            PathError::InvalidChars(p) => write!(f, "路径包含非法字符: {}", p),
            PathError::EmptyPath => write!(f, "路径为空"),
        }
    }
}

/// Validate that `target` is within `root` and does not escape via `..` traversal.
pub fn is_safe_path(root: &Path, target: &Path) -> bool {
    let Ok(root_canon) = root.canonicalize() else {
        return false;
    };
    let Ok(target_canon) = root.join(target).canonicalize() else {
        if let Some(parent) = root.join(target).parent() {
            if let Ok(parent_canon) = parent.canonicalize() {
                return parent_canon.starts_with(&root_canon);
            }
        }
        return false;
    };
    target_canon.starts_with(&root_canon)
}

/// Resolve a relative path within the notebook root.
pub fn resolve_safe_path(root: &Path, relative: &str) -> Result<PathBuf, PathError> {
    if relative.is_empty() {
        return Err(PathError::EmptyPath);
    }

    let normalized = relative.replace('\\', "/");

    if normalized.contains('\0') {
        return Err(PathError::InvalidChars(normalized));
    }

    let target = Path::new(&normalized);

    if normalized.contains("..") && !is_safe_path(root, target) {
        return Err(PathError::PathTraversal(normalized));
    }

    let full = root.join(target);

    if let Some(parent) = full.parent() {
        if parent.starts_with(root) || is_safe_path(root, target) {
            return Ok(full);
        }
    }

    if is_safe_path(root, target) {
        Ok(full)
    } else {
        Err(PathError::PathTraversal(normalized))
    }
}

/// Get the display path (relative to root) for UI display.
pub fn display_path(root: &Path, full_path: &Path) -> String {
    full_path
        .strip_prefix(root)
        .unwrap_or(full_path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_safe_path_within_root() {
        let root = env::temp_dir().join("markluck-test-safe");
        let _ = std::fs::create_dir_all(&root);
        let target = Path::new("notes/test.md");
        assert!(is_safe_path(&root, target));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_reject_traversal() {
        let root = env::temp_dir().join("markluck-test-traversal");
        let _ = std::fs::create_dir_all(&root);
        let target = Path::new("../../etc/passwd");
        assert!(!is_safe_path(&root, target));
        let _ = std::fs::remove_dir_all(&root);
    }
}
