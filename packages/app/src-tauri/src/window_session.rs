use crate::fs_ops::{ExternalAccessGrants, ExternalFileHandle, NotebookRoot};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{State, WebviewWindow};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenedFile {
    pub absolute_path: String,
    pub relative_path: String,
    pub access_token: String,
}

impl From<ExternalFileHandle> for ExternalOpenedFile {
    fn from(handle: ExternalFileHandle) -> Self {
        Self {
            absolute_path: handle.absolute_path,
            relative_path: handle.relative_path,
            access_token: handle.access_token,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum WindowBootstrapPayload {
    Workspace {
        #[serde(
            rename = "initialRelativePath",
            skip_serializing_if = "Option::is_none"
        )]
        initial_relative_path: Option<String>,
    },
    ExternalReadonly {
        #[serde(rename = "openedFile")]
        opened_file: ExternalOpenedFile,
    },
    ExternalEdit {
        #[serde(rename = "openedFile")]
        opened_file: ExternalOpenedFile,
    },
}

#[derive(Clone, Debug)]
struct WindowSession {
    payload: WindowBootstrapPayload,
    path_key: Option<String>,
}

#[derive(Default)]
struct WindowSessionState {
    sessions: HashMap<String, WindowSession>,
    labels_by_path: HashMap<String, String>,
}

#[derive(Default)]
pub struct WindowSessionRegistry(Mutex<WindowSessionState>);

impl WindowSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ensure_workspace(&self, window_label: &str) {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .sessions
            .entry(window_label.to_string())
            .or_insert(WindowSession {
                payload: WindowBootstrapPayload::Workspace {
                    initial_relative_path: None,
                },
                path_key: None,
            });
    }

    pub fn register_external(
        &self,
        window_label: &str,
        handle: ExternalFileHandle,
    ) -> Result<(), String> {
        let path_key = canonical_path_key(Path::new(&handle.absolute_path))?;
        let mut state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        if let Some(existing) = state.labels_by_path.get(&path_key) {
            if existing != window_label {
                return Err(format!(
                    "external file is already open in window {existing}"
                ));
            }
        }
        state
            .labels_by_path
            .insert(path_key.clone(), window_label.to_string());
        state.sessions.insert(
            window_label.to_string(),
            WindowSession {
                payload: WindowBootstrapPayload::ExternalReadonly {
                    opened_file: handle.into(),
                },
                path_key: Some(path_key),
            },
        );
        Ok(())
    }

    pub fn label_for_path(&self, path: &Path) -> Result<Option<String>, String> {
        let key = canonical_path_key(path)?;
        let state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        Ok(state.labels_by_path.get(&key).cloned())
    }

    pub fn payload_for(&self, window_label: &str) -> WindowBootstrapPayload {
        let state = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .sessions
            .get(window_label)
            .map(|session| session.payload.clone())
            .unwrap_or(WindowBootstrapPayload::Workspace {
                initial_relative_path: None,
            })
    }

    pub fn enable_external_edit(&self, window_label: &str) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get_mut(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        let opened_file = match &session.payload {
            WindowBootstrapPayload::ExternalReadonly { opened_file }
            | WindowBootstrapPayload::ExternalEdit { opened_file } => opened_file.clone(),
            WindowBootstrapPayload::Workspace { .. } => {
                return Err("workspace window is not an external-file session".to_string())
            }
        };
        session.payload = WindowBootstrapPayload::ExternalEdit { opened_file };
        Ok(())
    }

    pub fn assert_external_edit(
        &self,
        window_label: &str,
        access_token: &str,
    ) -> Result<(), String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        match &session.payload {
            WindowBootstrapPayload::ExternalEdit { opened_file }
                if opened_file.access_token == access_token =>
            {
                Ok(())
            }
            WindowBootstrapPayload::ExternalEdit { .. } => {
                Err("external edit token does not belong to this window bootstrap".to_string())
            }
            _ => Err("external file is not in single-file edit mode".to_string()),
        }
    }

    pub fn assert_workspace(&self, window_label: &str) -> Result<(), String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        if matches!(&session.payload, WindowBootstrapPayload::Workspace { .. }) {
            Ok(())
        } else {
            Err("external-file windows must use the session promotion command".to_string())
        }
    }

    /// A user-selected Save As destination is allowed from a workspace or an external file that
    /// the user has explicitly placed into edit mode. Read-only external previews stay blocked.
    pub fn assert_save_as_allowed(&self, window_label: &str) -> Result<(), String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        match &session.payload {
            WindowBootstrapPayload::Workspace { .. }
            | WindowBootstrapPayload::ExternalEdit { .. } => Ok(()),
            WindowBootstrapPayload::ExternalReadonly { .. } => {
                Err("read-only external files cannot be saved as a copy".to_string())
            }
        }
    }

    pub fn external_file_for(&self, window_label: &str) -> Result<ExternalOpenedFile, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        match &session.payload {
            WindowBootstrapPayload::ExternalReadonly { opened_file }
            | WindowBootstrapPayload::ExternalEdit { opened_file } => Ok(opened_file.clone()),
            WindowBootstrapPayload::Workspace { .. } => {
                Err("workspace window is not an external-file session".to_string())
            }
        }
    }

    pub fn promote_external<T>(
        &self,
        window_label: &str,
        promote_grant: impl FnOnce(&ExternalOpenedFile) -> Result<T, String>,
    ) -> Result<(ExternalOpenedFile, T), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get_mut(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        let opened_file = match &session.payload {
            WindowBootstrapPayload::ExternalReadonly { opened_file }
            | WindowBootstrapPayload::ExternalEdit { opened_file } => opened_file.clone(),
            WindowBootstrapPayload::Workspace { .. } => {
                return Err("workspace window is not an external-file session".to_string())
            }
        };
        let promoted = promote_grant(&opened_file)?;
        session.payload = WindowBootstrapPayload::Workspace {
            initial_relative_path: Some(opened_file.relative_path.clone()),
        };
        Ok((opened_file, promoted))
    }

    pub fn remove(&self, window_label: &str) {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(session) = state.sessions.remove(window_label) {
            if let Some(key) = session.path_key {
                state.labels_by_path.remove(&key);
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotedNotebookPayload {
    root_path: String,
    name: String,
    initial_relative_path: String,
}

#[tauri::command]
pub fn get_window_bootstrap(
    window: WebviewWindow,
    sessions: State<'_, WindowSessionRegistry>,
) -> WindowBootstrapPayload {
    sessions.payload_for(window.label())
}

#[tauri::command]
pub fn enable_external_edit(
    window: WebviewWindow,
    sessions: State<'_, WindowSessionRegistry>,
    access: State<'_, ExternalAccessGrants>,
) -> Result<(), String> {
    let opened_file = sessions.external_file_for(window.label())?;
    access.enable_file_write(
        &opened_file.access_token,
        window.label(),
        &opened_file.absolute_path,
    )?;
    if let Err(error) = sessions.enable_external_edit(window.label()) {
        access.disable_file_write(&opened_file.access_token);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn promote_external_file_to_notebook(
    window: WebviewWindow,
    sessions: State<'_, WindowSessionRegistry>,
    access: State<'_, ExternalAccessGrants>,
    notebook_root: State<'_, NotebookRoot>,
) -> Result<PromotedNotebookPayload, String> {
    let snapshot = sessions.external_file_for(window.label())?;
    access.assert_owner(&snapshot.access_token, window.label())?;
    let prepared = access.prepare_notebook_promotion(&snapshot.access_token, window.label())?;
    let (opened_file, root) = sessions.promote_external(window.label(), |opened_file| {
        if opened_file.access_token != snapshot.access_token
            || opened_file.absolute_path != snapshot.absolute_path
        {
            return Err("external file session changed during notebook promotion".to_string());
        }
        access.commit_prepared_notebook_promotion(&prepared, |root| {
            notebook_root.set_for(window.label(), root.to_path_buf())
        })
    })?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("笔记")
        .to_string();
    Ok(PromotedNotebookPayload {
        root_path: path_to_slash(&root),
        name,
        initial_relative_path: opened_file.relative_path,
    })
}

pub fn canonicalize_opened_file(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("unable to resolve current directory: {error}"))?
            .join(path)
    };
    absolute
        .canonicalize()
        .map_err(|error| format!("unable to resolve opened file: {error}"))
}

pub fn canonical_path_key(path: &Path) -> Result<String, String> {
    let canonical = canonicalize_opened_file(path)?;
    let key = path_to_slash(&canonical);
    #[cfg(windows)]
    let key = key.to_lowercase();
    Ok(key)
}

pub fn path_to_slash(path: &Path) -> String {
    let slash = path.to_string_lossy().replace('\\', "/");
    if let Some(unc) = slash.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        slash.strip_prefix("//?/").unwrap_or(&slash).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle(path: &Path, token: &str) -> ExternalFileHandle {
        ExternalFileHandle {
            access_token: token.to_string(),
            absolute_path: path_to_slash(path),
            notebook_root: path_to_slash(path.parent().unwrap()),
            relative_path: format!("/{}", path.file_name().unwrap().to_string_lossy()),
            capabilities: crate::fs_ops::ExternalAccessCapabilities {
                read: true,
                write: false,
                list: false,
                watch: false,
            },
        }
    }

    #[test]
    fn bootstrap_payload_uses_discriminated_mode() {
        let payload = WindowBootstrapPayload::ExternalReadonly {
            opened_file: ExternalOpenedFile {
                absolute_path: "C:/notes/a.md".to_string(),
                relative_path: "/a.md".to_string(),
                access_token: "token".to_string(),
            },
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["mode"], "external-readonly");
        assert_eq!(json["openedFile"]["relativePath"], "/a.md");
    }

    #[test]
    fn display_path_hides_windows_verbatim_prefix() {
        assert_eq!(
            path_to_slash(Path::new(r"\\?\C:\notes\a.md")),
            "C:/notes/a.md"
        );
        assert_eq!(
            path_to_slash(Path::new(r"\\?\UNC\server\share\a.md")),
            "//server/share/a.md"
        );
    }

    #[test]
    fn registry_deduplicates_canonical_paths_and_keeps_window_modes_isolated() {
        let root = std::env::temp_dir().join(format!("JotLuck-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let first = root.join("first.md");
        let second = root.join("second.txt");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&second, "second").unwrap();

        let registry = WindowSessionRegistry::new();
        registry
            .register_external("first-window", handle(&first, "first-token"))
            .unwrap();
        registry
            .register_external("second-window", handle(&second, "second-token"))
            .unwrap();
        assert_eq!(
            registry.label_for_path(&first).unwrap().as_deref(),
            Some("first-window")
        );
        assert!(registry
            .register_external("duplicate-window", handle(&first, "duplicate-token"))
            .is_err());

        registry.enable_external_edit("first-window").unwrap();
        assert!(matches!(
            registry.payload_for("first-window"),
            WindowBootstrapPayload::ExternalEdit { .. }
        ));
        assert!(matches!(
            registry.payload_for("second-window"),
            WindowBootstrapPayload::ExternalReadonly { .. }
        ));
        assert!(registry.assert_workspace("first-window").is_err());
        assert!(registry.assert_save_as_allowed("first-window").is_ok());
        assert!(registry.assert_save_as_allowed("second-window").is_err());
        assert!(registry
            .assert_external_edit("first-window", "first-token")
            .is_ok());
        assert!(registry
            .assert_external_edit("first-window", "second-token")
            .is_err());

        let failed = registry.promote_external::<()>("second-window", |_| {
            Err("simulated grant promotion failure".to_string())
        });
        assert!(failed.is_err());
        assert!(matches!(
            registry.payload_for("second-window"),
            WindowBootstrapPayload::ExternalReadonly { .. }
        ));

        let (promoted_file, marker) = registry
            .promote_external("first-window", |_| Ok("promoted"))
            .unwrap();
        assert_eq!(promoted_file.access_token, "first-token");
        assert_eq!(marker, "promoted");
        assert!(registry.assert_workspace("first-window").is_ok());
        assert!(registry.assert_save_as_allowed("first-window").is_ok());

        registry.remove("first-window");
        assert!(registry.label_for_path(&first).unwrap().is_none());
        assert_eq!(
            registry.label_for_path(&second).unwrap().as_deref(),
            Some("second-window")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_external_promotion_keeps_the_external_session() {
        let root = std::env::temp_dir().join(format!("JotLuck-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("external.md");
        std::fs::write(&target, "# External").unwrap();

        let access = ExternalAccessGrants::new();
        let file_handle = access
            .grant_for_existing_file(&target.to_string_lossy(), "window-a")
            .unwrap();
        let registry = WindowSessionRegistry::new();
        registry.register_external("window-a", file_handle).unwrap();

        std::fs::remove_dir_all(&root).unwrap();

        assert!(registry
            .promote_external("window-a", |opened_file| {
                access.assert_owner(&opened_file.access_token, "window-a")?;
                access.promote_to_notebook_after_validation(&opened_file.access_token, |_| Ok(()))
            })
            .is_err());
        assert!(matches!(
            registry.payload_for("window-a"),
            WindowBootstrapPayload::ExternalReadonly { .. }
        ));
    }
}
