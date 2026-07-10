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

fn joined_notebook_path(root: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        root.join(target)
    }
}

fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path;
    loop {
        if current.exists() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}

/// Validate that `target` is within `root` after resolving symlinks/junctions.
pub fn is_safe_path(root: &Path, target: &Path) -> bool {
    let Ok(root_canon) = root.canonicalize() else {
        return false;
    };

    let full = joined_notebook_path(root, target);
    if let Ok(target_canon) = full.canonicalize() {
        return target_canon.starts_with(&root_canon);
    };

    let Some(existing_parent) = nearest_existing_ancestor(full.parent().unwrap_or(&full)) else {
        return false;
    };
    let Ok(parent_canon) = existing_parent.canonicalize() else {
        return false;
    };
    parent_canon.starts_with(&root_canon)
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

    // The frontend uses notebook-rooted paths such as `/note.md` and `/folder/a.md`.
    // Treat leading slashes as notebook-root markers, not OS absolute paths.
    let notebook_relative = normalized.trim_start_matches('/');
    let target = Path::new(notebook_relative);

    if target.is_absolute() {
        return Err(PathError::PathTraversal(normalized));
    }

    let full = root.join(target);

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
    use std::io;

    #[cfg(unix)]
    fn create_dir_link(source: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(source, link)
    }

    #[cfg(windows)]
    fn create_dir_link(source: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_dir(source, link)
    }

    #[test]
    fn test_safe_path_within_root() {
        let root = env::temp_dir().join("JotLuck-test-safe");
        let _ = std::fs::create_dir_all(root.join("notes"));
        let target = Path::new("notes/test.md");
        assert!(is_safe_path(&root, target));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_reject_traversal() {
        let root = env::temp_dir().join("JotLuck-test-traversal");
        let _ = std::fs::create_dir_all(&root);
        let target = Path::new("../../etc/passwd");
        assert!(!is_safe_path(&root, target));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_resolve_notebook_root_marker() {
        let root = env::temp_dir().join("JotLuck-test-root-marker");
        let _ = std::fs::create_dir_all(root.join("notes"));
        let resolved = resolve_safe_path(&root, "/notes/test.md").unwrap();
        assert_eq!(resolved, root.join("notes/test.md"));
        let resolved_root = resolve_safe_path(&root, "/").unwrap();
        assert_eq!(resolved_root, root);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_reject_absolute_path_after_normalization() {
        let root = env::temp_dir().join("JotLuck-test-absolute");
        let _ = std::fs::create_dir_all(&root);
        let outside = env::temp_dir().join("JotLuck-outside.md");
        let outside_str = outside.to_string_lossy().to_string();
        let result = resolve_safe_path(&root, &outside_str);
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_reject_symlink_or_junction_escape_when_available() {
        let root = env::temp_dir().join("JotLuck-test-link-root");
        let outside = env::temp_dir().join("JotLuck-test-link-outside");
        let link = root.join("linked");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        if create_dir_link(&outside, &link).is_ok() {
            std::fs::write(outside.join("secret.md"), "outside").unwrap();
            assert!(!is_safe_path(&root, Path::new("linked/secret.md")));
            assert!(resolve_safe_path(&root, "/linked/new.md").is_err());
        }

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }
}
