use crate::command_error::CommandResult;
use crate::fs_ops::{ExternalAccessGrants, ExternalFileHandle, NotebookRoot};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{State, WebviewWindow};

pub const MAX_IMPORTED_SOURCE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportedDocumentKind {
    Docx,
    Pdf,
    Xlsx,
    Xls,
}

impl ImportedDocumentKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        match path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("docx") => Some(Self::Docx),
            Some("pdf") => Some(Self::Pdf),
            Some("xlsx") => Some(Self::Xlsx),
            Some("xls") => Some(Self::Xls),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Pdf => "pdf",
            Self::Xlsx => "xlsx",
            Self::Xls => "xls",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRevision {
    pub sha256: String,
    pub size: u64,
    pub modified_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImportBootstrapSource {
    pub file_name: String,
    pub kind: ImportedDocumentKind,
    pub revision: SourceRevision,
}

#[derive(Clone, Debug)]
pub struct DocumentImportSource {
    pub absolute_path: PathBuf,
    pub file_name: String,
    pub kind: ImportedDocumentKind,
    pub revision: SourceRevision,
}

pub fn source_revision(path: &Path) -> Result<SourceRevision, String> {
    let mut file =
        File::open(path).map_err(|error| format!("unable to open source file: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("unable to read source metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("document import source is not a regular file".to_string());
    }
    if metadata.len() > MAX_IMPORTED_SOURCE_BYTES {
        return Err(format!(
            "document import source exceeds the 200 MiB limit ({:.1} MiB)",
            metadata.len() as f64 / (1024.0 * 1024.0)
        ));
    }
    let mut digest = Sha256::new();
    // This function runs during desktop bootstrap on the Windows GUI thread, whose
    // default stack is too small for a 1 MiB local array. Keep the bounded read
    // buffer on the heap so importing a document cannot terminate the process with
    // STATUS_STACK_OVERFLOW before the reader is shown.
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("unable to read source file: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let modified_at_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default();
    Ok(SourceRevision {
        sha256: format!("{:x}", digest.finalize()),
        size: metadata.len(),
        modified_at_ms,
    })
}

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
    DocumentImportReadonly {
        source: DocumentImportBootstrapSource,
    },
}

#[derive(Clone, Debug)]
struct WindowSession {
    payload: WindowBootstrapPayload,
    path_key: Option<String>,
    document_source: Option<DocumentImportSource>,
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
                document_source: None,
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
                document_source: None,
            },
        );
        Ok(())
    }

    pub fn register_document_import(&self, window_label: &str, path: &Path) -> Result<(), String> {
        let absolute_path = canonicalize_opened_file(path)?;
        let kind = ImportedDocumentKind::from_path(&absolute_path)
            .ok_or_else(|| "unsupported document import extension".to_string())?;
        let revision = source_revision(&absolute_path)?;
        let file_name = absolute_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "document import file name is not valid Unicode".to_string())?
            .to_string();
        let path_key = canonical_path_key(&absolute_path)?;
        let source = DocumentImportSource {
            absolute_path,
            file_name: file_name.clone(),
            kind,
            revision: revision.clone(),
        };
        let mut state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        if let Some(existing) = state.labels_by_path.get(&path_key) {
            if existing != window_label {
                return Err(format!("document is already open in window {existing}"));
            }
        }
        state
            .labels_by_path
            .insert(path_key.clone(), window_label.to_string());
        state.sessions.insert(
            window_label.to_string(),
            WindowSession {
                payload: WindowBootstrapPayload::DocumentImportReadonly {
                    source: DocumentImportBootstrapSource {
                        file_name,
                        kind,
                        revision,
                    },
                },
                path_key: Some(path_key),
                document_source: Some(source),
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
            WindowBootstrapPayload::DocumentImportReadonly { .. } => {
                return Err("imported documents cannot be edited in place by JotLuck".to_string())
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
            WindowBootstrapPayload::DocumentImportReadonly { .. } => {
                Err("document imports must use save_converted_document_as".to_string())
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
            WindowBootstrapPayload::DocumentImportReadonly { .. } => {
                Err("document imports do not expose external note grants".to_string())
            }
        }
    }

    pub fn document_source_for(&self, window_label: &str) -> Result<DocumentImportSource, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        if !matches!(
            session.payload,
            WindowBootstrapPayload::DocumentImportReadonly { .. }
        ) {
            return Err("window is not a document import session".to_string());
        }
        session
            .document_source
            .clone()
            .ok_or_else(|| "document import source authorization is unavailable".to_string())
    }

    pub fn update_document_revision(
        &self,
        window_label: &str,
        revision: SourceRevision,
    ) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let session = state
            .sessions
            .get_mut(window_label)
            .ok_or_else(|| "window has no startup session".to_string())?;
        let source = session
            .document_source
            .as_mut()
            .ok_or_else(|| "window is not a document import session".to_string())?;
        source.revision = revision.clone();
        session.payload = WindowBootstrapPayload::DocumentImportReadonly {
            source: DocumentImportBootstrapSource {
                file_name: source.file_name.clone(),
                kind: source.kind,
                revision,
            },
        };
        Ok(())
    }

    pub fn replace_document_with_external_edit(
        &self,
        window_label: &str,
        handle: ExternalFileHandle,
    ) -> Result<(), String> {
        let new_key = canonical_path_key(Path::new(&handle.absolute_path))?;
        let mut state = self
            .0
            .lock()
            .map_err(|_| "window session registry lock poisoned".to_string())?;
        let old_key = state
            .sessions
            .get(window_label)
            .and_then(|session| session.path_key.clone())
            .ok_or_else(|| "window is not a document import session".to_string())?;
        if let Some(existing) = state.labels_by_path.get(&new_key) {
            if existing != window_label {
                return Err(format!(
                    "saved Markdown file is already open in window {existing}"
                ));
            }
        }
        state.labels_by_path.remove(&old_key);
        state
            .labels_by_path
            .insert(new_key.clone(), window_label.to_string());
        state.sessions.insert(
            window_label.to_string(),
            WindowSession {
                payload: WindowBootstrapPayload::ExternalEdit {
                    opened_file: handle.into(),
                },
                path_key: Some(new_key),
                document_source: None,
            },
        );
        Ok(())
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
            WindowBootstrapPayload::DocumentImportReadonly { .. } => {
                return Err("document imports cannot be promoted to notebooks".to_string())
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
) -> CommandResult<()> {
    let opened_file = sessions.external_file_for(window.label())?;
    access.enable_file_write(
        &opened_file.access_token,
        window.label(),
        &opened_file.absolute_path,
    )?;
    if let Err(error) = sessions.enable_external_edit(window.label()) {
        access.disable_file_write(&opened_file.access_token);
        return Err(error.into());
    }
    Ok(())
}

#[tauri::command]
pub fn promote_external_file_to_notebook(
    window: WebviewWindow,
    sessions: State<'_, WindowSessionRegistry>,
    access: State<'_, ExternalAccessGrants>,
    notebook_root: State<'_, NotebookRoot>,
) -> CommandResult<PromotedNotebookPayload> {
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
    fn document_import_session_exposes_no_note_grant_and_transitions_only_after_save() {
        let root =
            std::env::temp_dir().join(format!("JotLuck-document-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("report.docx");
        let saved = root.join("report.md");
        std::fs::write(&source, b"read-only source bytes").unwrap();
        std::fs::write(&saved, b"# Converted").unwrap();

        let registry = WindowSessionRegistry::new();
        registry
            .register_document_import("document-window", &source)
            .unwrap();
        assert!(registry
            .register_document_import("other-window", &source)
            .is_err());

        let payload = serde_json::to_value(registry.payload_for("document-window")).unwrap();
        assert_eq!(payload["mode"], "document-import-readonly");
        assert_eq!(payload["source"]["fileName"], "report.docx");
        assert!(payload["source"].get("absolutePath").is_none());
        assert!(registry.external_file_for("document-window").is_err());
        assert!(registry.enable_external_edit("document-window").is_err());
        assert!(registry.assert_save_as_allowed("document-window").is_err());
        assert!(registry
            .promote_external::<()>("document-window", |_| Ok(()))
            .is_err());
        assert!(registry.document_source_for("other-window").is_err());

        let access = ExternalAccessGrants::new();
        let saved_handle = access
            .grant_for_saved_file(&saved.to_string_lossy(), "document-window")
            .unwrap();
        registry
            .replace_document_with_external_edit("document-window", saved_handle.clone())
            .unwrap();
        assert!(registry.document_source_for("document-window").is_err());
        assert!(registry
            .assert_external_edit("document-window", &saved_handle.access_token)
            .is_ok());
        assert!(registry.label_for_path(&source).unwrap().is_none());
        assert_eq!(
            registry.label_for_path(&saved).unwrap().as_deref(),
            Some("document-window")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn document_source_hashing_is_safe_on_a_small_gui_style_stack() {
        let root =
            std::env::temp_dir().join(format!("JotLuck-source-hash-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("report.pdf");
        std::fs::write(&source, vec![0x5a; 1024 * 1024 + 17]).unwrap();
        let source_for_thread = source.clone();

        let revision = std::thread::Builder::new()
            .name("gui-stack-source-hash".to_string())
            .stack_size(512 * 1024)
            .spawn(move || source_revision(&source_for_thread))
            .unwrap()
            .join()
            .expect("source hashing must not overflow a GUI-sized stack")
            .unwrap();

        assert_eq!(revision.size, 1024 * 1024 + 17);
        assert_eq!(revision.sha256.len(), 64);
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
