use crate::command_error::CommandResult;
use crate::fs_ops::{
    commit_staged_text_file, stage_text_file, ExternalAccessGrants, ExternalFileHandle,
    FileMutationCoordinator,
};
use crate::window_session::{
    source_revision, DocumentImportSource, ImportedDocumentKind, SourceRevision,
    WindowSessionRegistry, MAX_IMPORTED_SOURCE_BYTES,
};
use calamine::{open_workbook_auto, Data, Reader, SheetType, SheetVisible};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, Weak};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const WORKER_ARGUMENT: &str = "--jotluck-document-worker";
const PROTOCOL_VERSION: u32 = 1;
const MAX_ACTIVE_WORKERS: usize = 2;
const MAX_MARKDOWN_BYTES: usize = 5 * 1024 * 1024;
const MAX_OOXML_EXPANDED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OOXML_ENTRY_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PDF_PAGE_EXPANDED_BYTES: usize = 32 * 1024 * 1024;
const MAX_DOCX_ASSET_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const WORKER_MEMORY_LIMIT_BYTES: usize = 768 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentProgressUnit {
    Bytes,
    Pages,
    Sheets,
    Rows,
    Blocks,
    Assets,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentConversionEvent {
    Phase {
        phase: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        unit: Option<DocumentProgressUnit>,
        #[serde(skip_serializing_if = "Option::is_none")]
        completed: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
    },
    Chunk {
        sequence: u64,
        markdown: String,
    },
    Asset {
        asset_id: String,
        file_name: String,
        media_type: String,
        bytes: u64,
    },
    Warning {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        context: Option<String>,
    },
    Complete {
        conversion_id: String,
        revision: SourceRevision,
        markdown_bytes: u64,
    },
    Stale {
        revision: SourceRevision,
    },
    Cancelled,
    Error {
        code: String,
        message: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentAssetPayload {
    pub bytes: Vec<u8>,
    pub media_type: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConvertedDocumentDialogRequest {
    pub default_file_name: String,
    pub dialog_title: String,
    pub filter_name: String,
    pub original_preservation_confirmed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ConvertedAsset {
    pub id: String,
    pub file_name: String,
    pub media_type: String,
    pub path: PathBuf,
    pub bytes: u64,
}

#[derive(Debug, Default)]
struct ConversionData {
    markdown: String,
    assets: HashMap<String, ConvertedAsset>,
    revision: Option<SourceRevision>,
    completed: bool,
    stale: bool,
}

struct ConversionJob {
    id: String,
    owner_window_label: String,
    source: DocumentImportSource,
    temp_dir: PathBuf,
    cancelled: AtomicBool,
    terminal: AtomicBool,
    child: Mutex<Option<Child>>,
    windows_job: Mutex<Option<WindowsJobHandle>>,
    data: Mutex<ConversionData>,
    channel: Channel<DocumentConversionEvent>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl ConversionJob {
    fn send(&self, event: DocumentConversionEvent) {
        let _ = self.channel.send(event);
    }

    fn fail(&self, code: impl Into<String>, message: impl Into<String>) {
        if self
            .terminal
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.send(DocumentConversionEvent::Error {
                code: code.into(),
                message: message.into(),
            });
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
            }
        }
        if self
            .terminal
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.send(DocumentConversionEvent::Cancelled);
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn mark_stale(&self, revision: SourceRevision) {
        if let Ok(mut data) = self.data.lock() {
            if data.stale {
                return;
            }
            data.stale = true;
        }
        self.terminal.store(true, Ordering::Release);
        self.send(DocumentConversionEvent::Stale { revision });
    }
}

struct WorkerGate {
    active: Mutex<usize>,
    wake: Condvar,
}

impl WorkerGate {
    fn new() -> Self {
        Self {
            active: Mutex::new(0),
            wake: Condvar::new(),
        }
    }

    fn acquire(self: &Arc<Self>, job: &ConversionJob) -> Option<WorkerPermit> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *active >= MAX_ACTIVE_WORKERS {
            if job.is_cancelled() {
                return None;
            }
            let waited = self
                .wake
                .wait_timeout(active, Duration::from_millis(100))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            active = waited.0;
        }
        *active += 1;
        Some(WorkerPermit { gate: self.clone() })
    }
}

struct WorkerPermit {
    gate: Arc<WorkerGate>,
}

impl Drop for WorkerPermit {
    fn drop(&mut self) {
        let mut active = self
            .gate
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *active = active.saturating_sub(1);
        self.gate.wake.notify_one();
    }
}

struct DocumentImportInner {
    jobs: Mutex<HashMap<String, Arc<ConversionJob>>>,
    gate: Arc<WorkerGate>,
}

pub struct DocumentImportState {
    inner: Arc<DocumentImportInner>,
}

impl DocumentImportState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DocumentImportInner {
                jobs: Mutex::new(HashMap::new()),
                gate: Arc::new(WorkerGate::new()),
            }),
        }
    }

    fn job_for(
        &self,
        conversion_id: &str,
        window_label: &str,
    ) -> Result<Arc<ConversionJob>, String> {
        let jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "document conversion registry lock poisoned".to_string())?;
        let job = jobs
            .get(conversion_id)
            .cloned()
            .ok_or_else(|| "document conversion is unavailable or expired".to_string())?;
        if job.owner_window_label != window_label {
            return Err("document conversion does not belong to this window".to_string());
        }
        Ok(job)
    }

    fn remove_for_window(&self, window_label: &str) -> Vec<Arc<ConversionJob>> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let ids = jobs
            .iter()
            .filter_map(|(id, job)| (job.owner_window_label == window_label).then_some(id.clone()))
            .collect::<Vec<_>>();
        ids.into_iter().filter_map(|id| jobs.remove(&id)).collect()
    }

    pub fn cleanup_for_window(&self, window_label: &str) {
        for job in self.remove_for_window(window_label) {
            job.cancel();
            let _ = fs::remove_dir_all(&job.temp_dir);
        }
    }

    fn completed_job(
        &self,
        conversion_id: &str,
        window_label: &str,
    ) -> Result<Arc<ConversionJob>, String> {
        let job = self.job_for(conversion_id, window_label)?;
        let data = job
            .data
            .lock()
            .map_err(|_| "document conversion state lock poisoned".to_string())?;
        if !data.completed {
            return Err("document conversion has not completed".to_string());
        }
        if data.stale {
            return Err(
                "document conversion is stale; reconvert the source before editing".to_string(),
            );
        }
        drop(data);
        Ok(job)
    }

    fn completed_job_for_window(&self, window_label: &str) -> Result<Arc<ConversionJob>, String> {
        let jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "document conversion registry lock poisoned".to_string())?;
        jobs.values()
            .find(|job| job.owner_window_label == window_label)
            .cloned()
            .ok_or_else(|| "document conversion is unavailable or expired".to_string())
            .and_then(|job| {
                let is_ready = job
                    .data
                    .lock()
                    .map_err(|_| "document conversion state lock poisoned".to_string())?
                    .completed;
                if is_ready {
                    Ok(job)
                } else {
                    Err("document conversion has not completed".to_string())
                }
            })
    }

    pub(crate) fn fresh_source_for_window(
        &self,
        window_label: &str,
    ) -> Result<DocumentImportSource, String> {
        let job = self.completed_job_for_window(window_label)?;
        verify_job_source_is_current(&job)?;
        Ok(job.source.clone())
    }

    pub(crate) fn remove_job(&self, conversion_id: &str, window_label: &str) {
        if let Ok(mut jobs) = self.inner.jobs.lock() {
            if jobs
                .get(conversion_id)
                .is_some_and(|job| job.owner_window_label == window_label)
            {
                if let Some(job) = jobs.remove(conversion_id) {
                    let _ = fs::remove_dir_all(&job.temp_dir);
                }
            }
        }
    }
}

#[tauri::command]
pub fn start_document_conversion(
    window: WebviewWindow,
    channel: Channel<DocumentConversionEvent>,
    sessions: State<'_, WindowSessionRegistry>,
    imports: State<'_, DocumentImportState>,
) -> CommandResult<String> {
    let source = sessions.document_source_for(window.label())?;
    for previous in imports.remove_for_window(window.label()) {
        previous.cancel();
    }

    let id = Uuid::new_v4().simple().to_string();
    let temp_dir = document_import_temp_root().join(&id);
    let job = Arc::new(ConversionJob {
        id: id.clone(),
        owner_window_label: window.label().to_string(),
        source,
        temp_dir,
        cancelled: AtomicBool::new(false),
        terminal: AtomicBool::new(false),
        child: Mutex::new(None),
        windows_job: Mutex::new(None),
        data: Mutex::new(ConversionData::default()),
        channel,
        watcher: Mutex::new(None),
    });
    imports
        .inner
        .jobs
        .lock()
        .map_err(|_| "document conversion registry lock poisoned".to_string())?
        .insert(id.clone(), job.clone());

    let worker_inner = imports.inner.clone();
    let app = window.app_handle().clone();
    if let Err(error) = thread::Builder::new()
        .name(format!("document-import-{}", &id[..8]))
        .spawn(move || run_conversion_job(job, worker_inner, app))
    {
        imports.remove_job(&id, window.label());
        return Err(format!("unable to start document conversion: {error}").into());
    }
    Ok(id)
}

#[tauri::command]
pub fn cancel_document_conversion(
    window: WebviewWindow,
    conversion_id: String,
    imports: State<'_, DocumentImportState>,
) -> CommandResult<()> {
    imports.job_for(&conversion_id, window.label())?.cancel();
    Ok(())
}

#[tauri::command]
pub fn read_document_conversion_asset(
    window: WebviewWindow,
    conversion_id: String,
    asset_id: String,
    imports: State<'_, DocumentImportState>,
) -> CommandResult<DocumentAssetPayload> {
    let job = imports.job_for(&conversion_id, window.label())?;
    let asset = job
        .data
        .lock()
        .map_err(|_| "document conversion state lock poisoned".to_string())?
        .assets
        .get(&asset_id)
        .cloned()
        .ok_or_else(|| "document conversion asset was not found".to_string())?;
    let bytes = fs::read(&asset.path)
        .map_err(|error| format!("unable to read converted asset: {error}"))?;
    if bytes.len() as u64 != asset.bytes {
        return Err("converted asset changed after registration".into());
    }
    Ok(DocumentAssetPayload {
        bytes,
        media_type: asset.media_type,
        file_name: asset.file_name,
    })
}

#[tauri::command]
pub fn refresh_document_source_revision(
    window: WebviewWindow,
    conversion_id: String,
    imports: State<'_, DocumentImportState>,
) -> CommandResult<bool> {
    let job = imports.job_for(&conversion_id, window.label())?;
    Ok(verify_job_source_is_current(&job).is_ok())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_converted_document_as(
    window: WebviewWindow,
    app: tauri::AppHandle,
    conversion_id: String,
    dialog_request: SaveConvertedDocumentDialogRequest,
    imports: State<'_, DocumentImportState>,
    sessions: State<'_, WindowSessionRegistry>,
    access: State<'_, ExternalAccessGrants>,
    coordinator: State<'_, FileMutationCoordinator>,
) -> CommandResult<Option<ExternalFileHandle>> {
    if !dialog_request.original_preservation_confirmed {
        return Err("saving a converted copy requires confirming that the source document remains unchanged".into());
    }
    let job = imports.completed_job(&conversion_id, window.label())?;
    verify_job_source_is_current(&job)?;
    let selected = app
        .dialog()
        .file()
        .set_title(dialog_request.dialog_title)
        .set_file_name(force_markdown_file_name(&dialog_request.default_file_name))
        .add_filter(dialog_request.filter_name, &["md"])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    verify_job_source_is_current(&job)?;
    let selected_path = selected
        .into_path()
        .map_err(|error| format!("unable to resolve selected Markdown destination: {error}"))?;
    let mut target = selected_path.clone();
    target.set_extension("md");
    if target != selected_path && target.exists() {
        return Err(
            "the forced .md destination already exists; choose that file explicitly or use another name"
                .into(),
        );
    }
    if let Some(existing) = sessions.label_for_path(&target)? {
        if existing != window.label() {
            return Err(format!("saved Markdown file is already open in window {existing}").into());
        }
    }
    let parent = target
        .parent()
        .ok_or_else(|| "selected Markdown destination has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("unable to create Markdown destination directory: {error}"))?;
    let (markdown, assets) = {
        let data = job
            .data
            .lock()
            .map_err(|_| "document conversion state lock poisoned".to_string())?;
        (
            data.markdown.clone(),
            data.assets.values().cloned().collect::<Vec<_>>(),
        )
    };
    let assets_destination = (!assets.is_empty()).then(|| unique_assets_destination(&target));
    let rendered_markdown =
        rewrite_asset_references(&markdown, assets_destination.as_deref(), &assets)?;
    let staged_assets = if let Some(destination) = assets_destination.as_deref() {
        Some(stage_converted_assets(parent, destination, &assets)?)
    } else {
        None
    };
    let staged_markdown = match stage_text_file(&target, &rendered_markdown) {
        Ok(path) => path,
        Err(error) => {
            if let Some(staged) = &staged_assets {
                let _ = fs::remove_dir_all(staged);
            }
            return Err(error.into());
        }
    };
    let mut coordinated_paths = vec![target.clone()];
    if let Some(destination) = &assets_destination {
        coordinated_paths.push(destination.clone());
    }
    let commit_result = coordinator.with_paths(&coordinated_paths, || {
        commit_converted_document(
            &job,
            &staged_markdown,
            &target,
            staged_assets.as_deref(),
            assets_destination.as_deref(),
        )
    });
    if let Err(error) = commit_result {
        let _ = fs::remove_file(&staged_markdown);
        if let Some(staged) = &staged_assets {
            let _ = fs::remove_dir_all(staged);
        }
        return Err(error.into());
    }

    let path_text = target.to_string_lossy().to_string();
    let handle = access.grant_for_saved_file(&path_text, window.label())?;
    if let Err(error) = sessions.replace_document_with_external_edit(window.label(), handle.clone())
    {
        access.revoke(&handle.access_token);
        return Err(error.into());
    }
    imports.remove_job(&conversion_id, window.label());
    Ok(Some(handle))
}

fn commit_converted_document(
    job: &ConversionJob,
    staged_markdown: &Path,
    target: &Path,
    staged_assets: Option<&Path>,
    assets_destination: Option<&Path>,
) -> Result<(), String> {
    // Staging assets and Markdown can take long enough for a professional editor to
    // replace the source after the post-dialog check. This is the final revision
    // gate and must stay before the first destination mutation.
    verify_job_source_is_current(job)?;

    let mut committed_assets = false;
    if let (Some(staged), Some(destination)) = (staged_assets, assets_destination) {
        if destination.exists() {
            return Err("selected Markdown asset directory already exists".to_string());
        }
        fs::rename(staged, destination)
            .map_err(|error| format!("unable to commit Markdown assets: {error}"))?;
        committed_assets = true;
    }
    if let Err(error) = commit_staged_text_file(staged_markdown, target) {
        if committed_assets {
            if let Some(destination) = assets_destination {
                let _ = fs::remove_dir_all(destination);
            }
        }
        return Err(error);
    }
    Ok(())
}

fn force_markdown_file_name(value: &str) -> String {
    let trimmed = value.trim();
    let base = if trimmed.is_empty() {
        "converted-document"
    } else {
        trimmed
    };
    let path = Path::new(base);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("converted-document");
    format!("{stem}.md")
}

fn unique_assets_destination(markdown_target: &Path) -> PathBuf {
    let parent = markdown_target.parent().unwrap_or_else(|| Path::new("."));
    let stem = markdown_target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("converted-document");
    let first = parent.join(format!("{stem}.assets"));
    if !first.exists() {
        return first;
    }
    for suffix in 2_u32.. {
        let candidate = parent.join(format!("{stem}-{suffix}.assets"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn stage_converted_assets(
    parent: &Path,
    destination: &Path,
    assets: &[ConvertedAsset],
) -> Result<PathBuf, String> {
    let staging = parent.join(format!(".jotluck-assets-{}", Uuid::new_v4().simple()));
    fs::create_dir(&staging)
        .map_err(|error| format!("unable to stage Markdown assets: {error}"))?;
    let mut used = HashMap::<String, usize>::new();
    let result = (|| {
        for asset in assets {
            let name = unique_saved_asset_name(&asset.file_name, &mut used);
            let target = staging.join(name);
            fs::copy(&asset.path, &target)
                .map_err(|error| format!("unable to stage converted asset: {error}"))?;
            File::open(&target)
                .and_then(|file| file.sync_all())
                .map_err(|error| format!("unable to sync converted asset: {error}"))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if destination.exists() {
        let _ = fs::remove_dir_all(&staging);
        return Err("selected Markdown asset directory already exists".to_string());
    }
    Ok(staging)
}

fn rewrite_asset_references(
    markdown: &str,
    destination: Option<&Path>,
    assets: &[ConvertedAsset],
) -> Result<String, String> {
    if assets.is_empty() {
        return Ok(markdown.to_string());
    }
    let directory_name = destination
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Markdown asset directory name is invalid Unicode".to_string())?;
    let mut used = HashMap::<String, usize>::new();
    let mut output = markdown.to_string();
    for asset in assets {
        let saved_name = unique_saved_asset_name(&asset.file_name, &mut used);
        output = output.replace(
            &format!("jotluck-asset://{}", asset.id),
            &format!("{directory_name}/{saved_name}"),
        );
    }
    Ok(output)
}

fn unique_saved_asset_name(value: &str, used: &mut HashMap<String, usize>) -> String {
    let sanitized = sanitize_asset_file_name(value);
    let count = used.entry(sanitized.to_ascii_lowercase()).or_insert(0);
    *count += 1;
    if *count == 1 {
        return sanitized;
    }
    let path = Path::new(&sanitized);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => format!("{stem}-{}.{}", *count, extension),
        None => format!("{stem}-{}", *count),
    }
}

fn document_import_temp_root() -> PathBuf {
    std::env::temp_dir().join("JotLuck").join("document-import")
}

fn run_conversion_job(
    job: Arc<ConversionJob>,
    inner: Arc<DocumentImportInner>,
    app: tauri::AppHandle,
) {
    job.send(DocumentConversionEvent::Phase {
        phase: "queued".to_string(),
        unit: None,
        completed: None,
        total: None,
    });
    let Some(_permit) = inner.gate.acquire(&job) else {
        cleanup_terminal_job(&inner, &job);
        return;
    };
    if job.is_cancelled() {
        cleanup_terminal_job(&inner, &job);
        return;
    }
    let result = run_conversion_job_inner(&job, &app);
    let failed = result.is_err();
    if let Err(error) = result {
        if !job.is_cancelled() {
            job.fail(error.code, error.message);
        }
        if let Ok(mut child) = job.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
            }
        }
    }
    if failed || job.is_cancelled() {
        cleanup_terminal_job(&inner, &job);
    }
}

fn cleanup_terminal_job(inner: &DocumentImportInner, job: &Arc<ConversionJob>) {
    if let Ok(mut jobs) = inner.jobs.lock() {
        if jobs
            .get(&job.id)
            .is_some_and(|registered| Arc::ptr_eq(registered, job))
        {
            jobs.remove(&job.id);
        }
    }
    let _ = fs::remove_dir_all(&job.temp_dir);
}

struct ConversionFailure {
    code: String,
    message: String,
}

impl ConversionFailure {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<String> for ConversionFailure {
    fn from(message: String) -> Self {
        Self::new("conversion_failed", message)
    }
}

fn run_conversion_job_inner(
    job: &Arc<ConversionJob>,
    app: &tauri::AppHandle,
) -> Result<(), ConversionFailure> {
    fs::create_dir_all(&job.temp_dir).map_err(|error| {
        ConversionFailure::new(
            "temporary_storage_failed",
            format!("unable to create private conversion directory: {error}"),
        )
    })?;
    let snapshot_path = job
        .temp_dir
        .join(format!("source.{}", job.source.kind.extension()));
    let snapshot_revision = copy_source_snapshot(job, &snapshot_path)?;
    app.state::<WindowSessionRegistry>()
        .update_document_revision(&job.owner_window_label, snapshot_revision.clone())
        .map_err(ConversionFailure::from)?;
    if job.is_cancelled() {
        return Ok(());
    }

    job.send(DocumentConversionEvent::Phase {
        phase: "starting-worker".to_string(),
        unit: None,
        completed: None,
        total: None,
    });
    let output_dir = job.temp_dir.join("assets");
    fs::create_dir_all(&output_dir).map_err(|error| {
        ConversionFailure::new(
            "temporary_storage_failed",
            format!("unable to create conversion asset directory: {error}"),
        )
    })?;
    let request = WorkerRequest {
        protocol_version: PROTOCOL_VERSION,
        kind: job.source.kind,
        snapshot_path,
        output_dir,
    };

    let mut command = Command::new(std::env::current_exe().map_err(|error| {
        ConversionFailure::new(
            "worker_start_failed",
            format!("unable to locate JotLuck executable: {error}"),
        )
    })?);
    command
        .arg(WORKER_ARGUMENT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_worker_command(&mut command);
    let mut child = command.spawn().map_err(|error| {
        ConversionFailure::new(
            "worker_start_failed",
            format!("unable to launch conversion worker: {error}"),
        )
    })?;
    let windows_job = assign_worker_limits(&child)
        .map_err(|message| ConversionFailure::new("worker_limit_failed", message))?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        ConversionFailure::new(
            "worker_protocol_failed",
            "conversion worker stdin is unavailable",
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ConversionFailure::new(
            "worker_protocol_failed",
            "conversion worker stdout is unavailable",
        )
    })?;
    write_frame(&mut stdin, &request).map_err(|error| {
        ConversionFailure::new(
            "worker_protocol_failed",
            format!("unable to send conversion request: {error}"),
        )
    })?;
    drop(stdin);
    *job.windows_job
        .lock()
        .map_err(|_| ConversionFailure::new("worker_start_failed", "worker job lock poisoned"))? =
        windows_job;
    *job.child.lock().map_err(|_| {
        ConversionFailure::new("worker_start_failed", "worker process lock poisoned")
    })? = Some(child);
    if job.is_cancelled() {
        if let Ok(mut child) = job.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
            }
        }
        return Ok(());
    }

    let mut reader = BufReader::new(stdout);
    let mut next_sequence = 1_u64;
    let mut worker_complete = false;
    while !job.is_cancelled() {
        let frame: WorkerFrame = match read_frame(&mut reader) {
            Ok(frame) => frame,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => {
                return Err(ConversionFailure::new(
                    "worker_protocol_failed",
                    format!("unable to read conversion worker event: {error}"),
                ))
            }
        };
        if frame.protocol_version != PROTOCOL_VERSION {
            return Err(ConversionFailure::new(
                "worker_protocol_failed",
                "conversion worker protocol version does not match JotLuck",
            ));
        }
        match frame.event {
            WorkerEvent::Phase {
                phase,
                unit,
                completed,
                total,
            } => job.send(DocumentConversionEvent::Phase {
                phase,
                unit,
                completed,
                total,
            }),
            WorkerEvent::Chunk { sequence, markdown } => {
                if sequence != next_sequence {
                    return Err(ConversionFailure::new(
                        "worker_protocol_failed",
                        "conversion worker emitted an out-of-order Markdown chunk",
                    ));
                }
                next_sequence += 1;
                let mut data = job.data.lock().map_err(|_| {
                    ConversionFailure::new(
                        "conversion_failed",
                        "document conversion state lock poisoned",
                    )
                })?;
                if data.markdown.len().saturating_add(markdown.len()) > MAX_MARKDOWN_BYTES {
                    return Err(ConversionFailure::new(
                        "markdown_limit_exceeded",
                        "converted Markdown exceeds the 5 MiB limit",
                    ));
                }
                data.markdown.push_str(&markdown);
                drop(data);
                job.send(DocumentConversionEvent::Chunk { sequence, markdown });
            }
            WorkerEvent::Asset {
                asset_id,
                file_name,
                media_type,
                relative_path,
                bytes,
            } => {
                let asset_path =
                    resolve_worker_asset_path(&job.temp_dir.join("assets"), &relative_path)?;
                let metadata = fs::metadata(&asset_path).map_err(|error| {
                    ConversionFailure::new(
                        "worker_protocol_failed",
                        format!("worker asset is missing: {error}"),
                    )
                })?;
                if metadata.len() != bytes {
                    return Err(ConversionFailure::new(
                        "worker_protocol_failed",
                        "worker asset size does not match its event",
                    ));
                }
                let asset = ConvertedAsset {
                    id: asset_id.clone(),
                    file_name: file_name.clone(),
                    media_type: media_type.clone(),
                    path: asset_path,
                    bytes,
                };
                let mut data = job.data.lock().map_err(|_| {
                    ConversionFailure::new(
                        "conversion_failed",
                        "document conversion state lock poisoned",
                    )
                })?;
                if data.assets.insert(asset_id.clone(), asset).is_some() {
                    return Err(ConversionFailure::new(
                        "worker_protocol_failed",
                        "conversion worker emitted a duplicate asset identifier",
                    ));
                }
                drop(data);
                job.send(DocumentConversionEvent::Asset {
                    asset_id,
                    file_name,
                    media_type,
                    bytes,
                });
            }
            WorkerEvent::Warning {
                code,
                message,
                context,
            } => job.send(DocumentConversionEvent::Warning {
                code,
                message,
                context,
            }),
            WorkerEvent::Complete => {
                worker_complete = true;
                break;
            }
            WorkerEvent::Error { code, message } => {
                return Err(ConversionFailure::new(code, message));
            }
        }
    }

    let status = job
        .child
        .lock()
        .map_err(|_| ConversionFailure::new("worker_failed", "worker process lock poisoned"))?
        .as_mut()
        .ok_or_else(|| ConversionFailure::new("worker_failed", "worker process disappeared"))?
        .wait()
        .map_err(|error| {
            ConversionFailure::new(
                "worker_failed",
                format!("unable to wait for conversion worker: {error}"),
            )
        })?;
    if let Ok(mut child) = job.child.lock() {
        child.take();
    }
    if let Ok(mut windows_job) = job.windows_job.lock() {
        windows_job.take();
    }
    if job.is_cancelled() {
        return Ok(());
    }
    if !status.success() || !worker_complete {
        return Err(ConversionFailure::new(
            "worker_failed",
            format!("conversion worker exited before completing ({status})"),
        ));
    }
    verify_snapshot_matches_source(job, &snapshot_revision)?;
    let markdown_bytes = {
        let mut data = job.data.lock().map_err(|_| {
            ConversionFailure::new(
                "conversion_failed",
                "document conversion state lock poisoned",
            )
        })?;
        data.completed = true;
        data.revision = Some(snapshot_revision.clone());
        data.markdown.len() as u64
    };
    // Publish the completed UI state only after the source watcher is active. Otherwise
    // an editor can replace the source in the small interval between `complete` reaching
    // the WebView and watcher registration, leaving an old conversion incorrectly fresh.
    start_source_watcher(job);
    job.terminal.store(true, Ordering::Release);
    job.send(DocumentConversionEvent::Complete {
        conversion_id: job.id.clone(),
        revision: snapshot_revision,
        markdown_bytes,
    });
    Ok(())
}

fn copy_source_snapshot(
    job: &ConversionJob,
    snapshot_path: &Path,
) -> Result<SourceRevision, ConversionFailure> {
    let initial = source_revision(&job.source.absolute_path)
        .map_err(|message| ConversionFailure::new("source_read_failed", message))?;
    let mut source = File::open(&job.source.absolute_path).map_err(|error| {
        ConversionFailure::new(
            "source_read_failed",
            format!("unable to open document source: {error}"),
        )
    })?;
    let mut snapshot = File::create(snapshot_path).map_err(|error| {
        ConversionFailure::new(
            "temporary_storage_failed",
            format!("unable to create source snapshot: {error}"),
        )
    })?;
    job.send(DocumentConversionEvent::Phase {
        phase: "snapshot".to_string(),
        unit: Some(DocumentProgressUnit::Bytes),
        completed: Some(0),
        total: Some(initial.size),
    });
    let mut digest = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        if job.is_cancelled() {
            return Err(ConversionFailure::new(
                "cancelled",
                "document conversion was cancelled",
            ));
        }
        let read = source.read(&mut buffer).map_err(|error| {
            ConversionFailure::new(
                "source_read_failed",
                format!("unable to read document source: {error}"),
            )
        })?;
        if read == 0 {
            break;
        }
        copied = copied.saturating_add(read as u64);
        if copied > MAX_IMPORTED_SOURCE_BYTES {
            return Err(ConversionFailure::new(
                "source_limit_exceeded",
                "document source exceeds the 200 MiB limit",
            ));
        }
        digest.update(&buffer[..read]);
        snapshot.write_all(&buffer[..read]).map_err(|error| {
            ConversionFailure::new(
                "temporary_storage_failed",
                format!("unable to write source snapshot: {error}"),
            )
        })?;
        job.send(DocumentConversionEvent::Phase {
            phase: "snapshot".to_string(),
            unit: Some(DocumentProgressUnit::Bytes),
            completed: Some(copied),
            total: Some(initial.size),
        });
    }
    snapshot.sync_all().map_err(|error| {
        ConversionFailure::new(
            "temporary_storage_failed",
            format!("unable to sync source snapshot: {error}"),
        )
    })?;
    let snapshot_hash = format!("{:x}", digest.finalize());
    let current = source_revision(&job.source.absolute_path)
        .map_err(|message| ConversionFailure::new("source_read_failed", message))?;
    if copied != initial.size || snapshot_hash != initial.sha256 || current != initial {
        job.mark_stale(current);
        return Err(ConversionFailure::new(
            "source_changed_during_snapshot",
            "the source document changed while JotLuck was creating its private snapshot; reconvert to continue",
        ));
    }
    Ok(initial)
}

fn verify_snapshot_matches_source(
    job: &ConversionJob,
    snapshot_revision: &SourceRevision,
) -> Result<(), ConversionFailure> {
    let current = source_revision(&job.source.absolute_path)
        .map_err(|message| ConversionFailure::new("source_read_failed", message))?;
    if &current != snapshot_revision {
        job.mark_stale(current);
        return Err(ConversionFailure::new(
            "source_changed_during_conversion",
            "the source document changed during conversion; reconvert to continue",
        ));
    }
    Ok(())
}

fn verify_job_source_is_current(job: &ConversionJob) -> Result<SourceRevision, String> {
    let expected = job
        .data
        .lock()
        .map_err(|_| "document conversion state lock poisoned".to_string())?
        .revision
        .clone()
        .ok_or_else(|| "document conversion has no completed source revision".to_string())?;
    let current = source_revision(&job.source.absolute_path)?;
    if current != expected {
        job.mark_stale(current);
        return Err(
            "document conversion is stale; reconvert the source before editing".to_string(),
        );
    }
    Ok(expected)
}

fn start_source_watcher(job: &Arc<ConversionJob>) {
    let weak: Weak<ConversionJob> = Arc::downgrade(job);
    let source_path = job.source.absolute_path.clone();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(_event) = event else {
            return;
        };
        // Windows applications use several save strategies (in-place write, metadata
        // update, rename/replace). The watcher is scoped to this one source file, so the
        // source hash is the authority for every emitted event rather than a backend-
        // specific EventKind classification.
        let Some(job) = weak.upgrade() else {
            return;
        };
        let expected = job.data.lock().ok().and_then(|data| data.revision.clone());
        match source_revision(&source_path) {
            Ok(current)
                if expected
                    .as_ref()
                    .is_some_and(|expected| expected != &current) =>
            {
                job.mark_stale(current);
            }
            Err(_) => {
                if let Some(last_known_revision) = expected {
                    job.mark_stale(last_known_revision);
                }
            }
            _ => {}
        }
    });
    match watcher {
        Ok(mut watcher) => {
            if watcher
                .watch(&job.source.absolute_path, RecursiveMode::NonRecursive)
                .is_ok()
            {
                if let Ok(mut slot) = job.watcher.lock() {
                    *slot = Some(watcher);
                }
            } else {
                job.send(DocumentConversionEvent::Warning {
                    code: "source-watch-unavailable".to_string(),
                    message: "JotLuck will recheck the source when the window regains focus and before saving.".to_string(),
                    context: None,
                });
            }
        }
        Err(_) => job.send(DocumentConversionEvent::Warning {
            code: "source-watch-unavailable".to_string(),
            message:
                "JotLuck will recheck the source when the window regains focus and before saving."
                    .to_string(),
            context: None,
        }),
    }
}

fn resolve_worker_asset_path(root: &Path, relative: &str) -> Result<PathBuf, ConversionFailure> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err(ConversionFailure::new(
            "worker_protocol_failed",
            "conversion worker returned an unsafe asset path",
        ));
    }
    let path = root.join(relative_path);
    let canonical_root = root.canonicalize().map_err(|error| {
        ConversionFailure::new(
            "worker_protocol_failed",
            format!("unable to resolve asset root: {error}"),
        )
    })?;
    let canonical = path.canonicalize().map_err(|error| {
        ConversionFailure::new(
            "worker_protocol_failed",
            format!("unable to resolve worker asset: {error}"),
        )
    })?;
    if !canonical.starts_with(&canonical_root) {
        return Err(ConversionFailure::new(
            "worker_protocol_failed",
            "conversion worker asset escaped its private directory",
        ));
    }
    Ok(canonical)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest {
    protocol_version: u32,
    kind: ImportedDocumentKind,
    snapshot_path: PathBuf,
    output_dir: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerFrame {
    protocol_version: u32,
    event: WorkerEvent,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum WorkerEvent {
    Phase {
        phase: String,
        unit: Option<DocumentProgressUnit>,
        completed: Option<u64>,
        total: Option<u64>,
    },
    Chunk {
        sequence: u64,
        markdown: String,
    },
    Asset {
        asset_id: String,
        file_name: String,
        media_type: String,
        relative_path: String,
        bytes: u64,
    },
    Warning {
        code: String,
        message: String,
        context: Option<String>,
    },
    Complete,
    Error {
        code: String,
        message: String,
    },
}

fn write_frame<T: Serialize>(writer: &mut impl Write, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame exceeds limit",
        ));
    }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

fn read_frame<T: for<'de> Deserialize<'de>>(reader: &mut impl Read) -> io::Result<T> {
    let mut length = [0_u8; 4];
    reader.read_exact(&mut length)?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(windows)]
fn configure_worker_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::{BELOW_NORMAL_PRIORITY_CLASS, CREATE_NO_WINDOW};
    command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
}

#[cfg(not(windows))]
fn configure_worker_command(_command: &mut Command) {}

#[cfg(windows)]
struct WindowsJobHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for WindowsJobHandle {}

#[cfg(windows)]
unsafe impl Sync for WindowsJobHandle {}

#[cfg(windows)]
impl Drop for WindowsJobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(not(windows))]
struct WindowsJobHandle;

#[cfg(windows)]
fn assign_worker_limits(child: &Child) -> Result<Option<WindowsJobHandle>, String> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION, PROCESS_SET_QUOTA,
        PROCESS_TERMINATE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() || job == INVALID_HANDLE_VALUE {
            return Err(format!(
                "unable to create worker Job Object: {}",
                io::Error::last_os_error()
            ));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        limits.ProcessMemoryLimit = WORKER_MEMORY_LIMIT_BYTES;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(job);
            return Err(format!("unable to configure worker memory limit: {error}"));
        }
        let process = OpenProcess(
            PROCESS_SET_QUOTA
                | PROCESS_SET_INFORMATION
                | PROCESS_TERMINATE
                | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            child.id(),
        );
        if process.is_null() || process == INVALID_HANDLE_VALUE {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(job);
            return Err(format!("unable to open conversion worker process: {error}"));
        }
        if AssignProcessToJobObject(job, process) == 0 {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(process);
            let _ = CloseHandle(job);
            return Err(format!(
                "unable to assign conversion worker to its Job Object: {error}"
            ));
        }
        if SetPriorityClass(process, BELOW_NORMAL_PRIORITY_CLASS) == 0 {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(process);
            let _ = CloseHandle(job);
            return Err(format!(
                "unable to lower conversion worker priority: {error}"
            ));
        }
        let _ = CloseHandle(process);
        Ok(Some(WindowsJobHandle(job)))
    }
}

#[cfg(not(windows))]
fn assign_worker_limits(_child: &Child) -> Result<Option<WindowsJobHandle>, String> {
    Ok(None)
}

pub fn run_document_worker_if_requested() -> bool {
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() != Some(std::ffi::OsStr::new(WORKER_ARGUMENT))
        || arguments.next().is_some()
    {
        return false;
    }
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let result = read_frame::<WorkerRequest>(&mut reader)
        .map_err(|error| {
            ConversionFailure::new(
                "worker_protocol_failed",
                format!("invalid conversion worker request: {error}"),
            )
        })
        .and_then(|request| run_worker_request(request, &mut writer));
    if let Err(error) = result {
        let frame = WorkerFrame {
            protocol_version: PROTOCOL_VERSION,
            event: WorkerEvent::Error {
                code: error.code,
                message: error.message,
            },
        };
        let _ = write_frame(&mut writer, &frame);
    }
    true
}

fn run_worker_request(
    request: WorkerRequest,
    writer: &mut impl Write,
) -> Result<(), ConversionFailure> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(ConversionFailure::new(
            "worker_protocol_failed",
            "conversion worker protocol version is unsupported",
        ));
    }
    let snapshot = request.snapshot_path.canonicalize().map_err(|error| {
        ConversionFailure::new(
            "worker_protocol_failed",
            format!("unable to resolve private source snapshot: {error}"),
        )
    })?;
    let output_dir = request.output_dir.canonicalize().map_err(|error| {
        ConversionFailure::new(
            "worker_protocol_failed",
            format!("unable to resolve private asset directory: {error}"),
        )
    })?;
    let expected_parent = snapshot
        .parent()
        .ok_or_else(|| {
            ConversionFailure::new(
                "worker_protocol_failed",
                "private source snapshot has no parent",
            )
        })?
        .canonicalize()
        .map_err(|error| {
            ConversionFailure::new(
                "worker_protocol_failed",
                format!("unable to resolve private snapshot directory: {error}"),
            )
        })?;
    let import_root = document_import_temp_root()
        .canonicalize()
        .map_err(|error| {
            ConversionFailure::new(
                "worker_protocol_failed",
                format!("unable to resolve private document import root: {error}"),
            )
        })?;
    if !expected_parent.starts_with(&import_root)
        || output_dir != expected_parent.join("assets")
        || ImportedDocumentKind::from_path(&snapshot) != Some(request.kind)
    {
        return Err(ConversionFailure::new(
            "worker_protocol_failed",
            "conversion worker request escaped its private snapshot boundary",
        ));
    }

    let mut emitter = WorkerEmitter::new(writer);
    let conversion = match request.kind {
        ImportedDocumentKind::Docx => convert_docx(&snapshot, &output_dir, &mut emitter),
        ImportedDocumentKind::Pdf => convert_pdf(&snapshot, &mut emitter),
        ImportedDocumentKind::Xlsx | ImportedDocumentKind::Xls => {
            convert_spreadsheet(&snapshot, request.kind, &mut emitter)
        }
    };
    conversion.map_err(|message| classify_worker_failure(request.kind, message))?;
    emitter
        .emit(WorkerEvent::Complete)
        .map_err(|message| ConversionFailure::new("worker_protocol_failed", message))
}

fn classify_worker_failure(kind: ImportedDocumentKind, message: String) -> ConversionFailure {
    let normalized = message.to_ascii_lowercase();
    let code = if normalized.contains("converted markdown exceeds") {
        "markdown_limit_exceeded"
    } else if normalized.contains("ooxml") && normalized.contains("exceed") {
        "ooxml_limit_exceeded"
    } else if kind == ImportedDocumentKind::Pdf && normalized.contains("encrypted") {
        "pdf_encrypted"
    } else if kind == ImportedDocumentKind::Pdf && normalized.contains("no extractable text") {
        "pdf_no_extractable_text"
    } else if normalized.contains("invalid ooxml")
        || normalized.contains("unsafe path")
        || normalized.contains("unable to parse")
        || normalized.contains("unable to open workbook")
    {
        "document_invalid"
    } else {
        "conversion_failed"
    };
    ConversionFailure::new(code, message)
}

struct WorkerEmitter<'a, W: Write> {
    writer: &'a mut W,
    next_sequence: u64,
    markdown_bytes: usize,
}

impl<'a, W: Write> WorkerEmitter<'a, W> {
    fn new(writer: &'a mut W) -> Self {
        Self {
            writer,
            next_sequence: 1,
            markdown_bytes: 0,
        }
    }

    fn emit(&mut self, event: WorkerEvent) -> Result<(), String> {
        write_frame(
            self.writer,
            &WorkerFrame {
                protocol_version: PROTOCOL_VERSION,
                event,
            },
        )
        .map_err(|error| format!("unable to send conversion worker event: {error}"))
    }

    fn phase(
        &mut self,
        phase: &str,
        unit: Option<DocumentProgressUnit>,
        completed: Option<u64>,
        total: Option<u64>,
    ) -> Result<(), String> {
        self.emit(WorkerEvent::Phase {
            phase: phase.to_string(),
            unit,
            completed,
            total,
        })
    }

    fn chunk(&mut self, markdown: String) -> Result<(), String> {
        if markdown.is_empty() {
            return Ok(());
        }
        self.markdown_bytes = self.markdown_bytes.saturating_add(markdown.len());
        if self.markdown_bytes > MAX_MARKDOWN_BYTES {
            return Err("converted Markdown exceeds the 5 MiB limit".to_string());
        }
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.emit(WorkerEvent::Chunk { sequence, markdown })
    }

    fn warning(
        &mut self,
        code: &str,
        message: impl Into<String>,
        context: Option<String>,
    ) -> Result<(), String> {
        self.emit(WorkerEvent::Warning {
            code: code.to_string(),
            message: message.into(),
            context,
        })
    }
}

#[derive(Clone, Debug)]
struct DocxAssetRef {
    id: String,
    file_name: String,
    supported: bool,
    relationship_ids: Vec<String>,
}

fn preflight_ooxml(path: &Path) -> Result<Vec<String>, String> {
    let file =
        File::open(path).map_err(|error| format!("unable to open OOXML snapshot: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("invalid OOXML ZIP container: {error}"))?;
    let mut total = 0_u64;
    let mut names = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("unable to inspect OOXML entry: {error}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "OOXML archive contains an unsafe path".to_string())?;
        if entry.size() > MAX_OOXML_ENTRY_BYTES {
            return Err(format!(
                "OOXML entry exceeds the 128 MiB limit: {}",
                enclosed.display()
            ));
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| "OOXML expanded size overflow".to_string())?;
        if total > MAX_OOXML_EXPANDED_BYTES {
            return Err("OOXML expanded content exceeds the 512 MiB limit".to_string());
        }
        names.push(enclosed.to_string_lossy().replace('\\', "/"));
    }
    Ok(names)
}

fn convert_docx(
    path: &Path,
    output_dir: &Path,
    emitter: &mut WorkerEmitter<'_, impl Write>,
) -> Result<(), String> {
    let names = preflight_ooxml(path)?;
    emitter.phase("parse-docx", None, None, None)?;
    let bytes = fs::read(path).map_err(|error| format!("unable to read DOCX snapshot: {error}"))?;
    let document = docx_rs::read_docx(&bytes)
        .map_err(|error| format!("unable to parse DOCX document: {error:?}"))?;
    let mut assets = extract_docx_assets(path, output_dir, emitter)?;
    for (relationship_id, media_path, _, _) in &document.images {
        let Some(file_name) = Path::new(media_path)
            .file_name()
            .and_then(|value| value.to_str())
        else {
            continue;
        };
        if let Some(asset) = assets
            .iter_mut()
            .find(|asset| asset.file_name.eq_ignore_ascii_case(file_name))
        {
            asset.relationship_ids.push(relationship_id.clone());
        }
    }
    let mut asset_index = 0_usize;
    let mut referenced_assets = HashSet::new();
    let numbering_formats = docx_numbering_formats(&document);
    let hyperlinks = document
        .hyperlinks
        .iter()
        .map(|(relationship_id, target, _)| (relationship_id.clone(), target.clone()))
        .collect::<HashMap<_, _>>();
    let total_blocks = document.document.children.len() as u64;
    let document_json = serde_json::to_value(&document)
        .map_err(|error| format!("unable to inspect DOCX structures: {error}"))?;
    let serialized = document_json.to_string();
    let serialized_lower = serialized.to_ascii_lowercase();
    if serialized_lower.contains("\"type\":\"delete\"")
        || serialized_lower.contains("\"type\":\"insert\"")
    {
        emitter.warning(
            "docx-revisions-flattened",
            "Tracked revisions were flattened to their visible text.",
            None,
        )?;
    }
    if serialized_lower.contains("textbox")
        || serialized.contains("gridSpan")
        || serialized.contains("vMerge")
    {
        emitter.warning(
            "docx-layout-flattened",
            "Text boxes or merged cells were flattened because Markdown has no equivalent layout.",
            None,
        )?;
    }

    for (index, child) in document.document.children.iter().enumerate() {
        use docx_rs::DocumentChild;
        let markdown = match child {
            DocumentChild::Paragraph(paragraph) => render_docx_paragraph(
                paragraph,
                &hyperlinks,
                &assets,
                &mut asset_index,
                &mut referenced_assets,
                &numbering_formats,
            ),
            DocumentChild::Table(table) => render_docx_table(table),
            other => {
                let value = serde_json::to_value(other).unwrap_or(Value::Null);
                let text = collect_docx_plain_text(&value);
                if text.trim().is_empty() {
                    String::new()
                } else {
                    format!("{}\n\n", escape_markdown(text.trim()))
                }
            }
        };
        emitter.chunk(markdown)?;
        emitter.phase(
            "docx-blocks",
            Some(DocumentProgressUnit::Blocks),
            Some((index + 1) as u64),
            Some(total_blocks),
        )?;
    }

    let footnote_text = document_json
        .get("footnotes")
        .map(collect_docx_plain_text)
        .unwrap_or_default();
    if !footnote_text.trim().is_empty() {
        emitter.chunk(format!(
            "## Footnotes\n\n{}\n\n",
            escape_markdown(footnote_text.trim())
        ))?;
    }
    if assets
        .iter()
        .any(|asset| asset.supported && !referenced_assets.contains(&asset.id))
    {
        let mut appendix = String::from("## Images\n\n");
        for asset in &assets {
            if asset.supported && !referenced_assets.contains(&asset.id) {
                appendix.push_str(&format!(
                    "![{}](jotluck-asset://{})\n\n",
                    escape_markdown(&asset.file_name),
                    asset.id
                ));
            }
        }
        emitter.chunk(appendix)?;
    }
    if names
        .iter()
        .any(|name| name.ends_with(".emf") || name.ends_with(".wmf"))
    {
        emitter.warning(
            "docx-unsupported-image",
            "EMF/WMF images were kept as placeholders; JotLuck does not add a raster conversion engine.",
            None,
        )?;
    }
    Ok(())
}

fn extract_docx_assets(
    path: &Path,
    output_dir: &Path,
    emitter: &mut WorkerEmitter<'_, impl Write>,
) -> Result<Vec<DocxAssetRef>, String> {
    let file =
        File::open(path).map_err(|error| format!("unable to open DOCX snapshot: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("invalid DOCX ZIP container: {error}"))?;
    let mut assets = Vec::new();
    let mut total_asset_bytes = 0_u64;
    let media_indices = (0..archive.len())
        .filter(|index| {
            archive
                .by_index(*index)
                .ok()
                .and_then(|entry| entry.enclosed_name())
                .is_some_and(|name| {
                    name.to_string_lossy()
                        .replace('\\', "/")
                        .starts_with("word/media/")
                })
        })
        .collect::<Vec<_>>();
    let media_total = media_indices.len() as u64;
    for (position, index) in media_indices.into_iter().enumerate() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("unable to read DOCX media entry: {error}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "DOCX media contains an unsafe path".to_string())?
            .to_path_buf();
        let original_name = enclosed
            .file_name()
            .and_then(|value| value.to_str())
            .map(sanitize_asset_file_name)
            .unwrap_or_else(|| format!("image-{}", position + 1));
        total_asset_bytes = total_asset_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "DOCX image asset size overflow".to_string())?;
        if total_asset_bytes > MAX_DOCX_ASSET_BYTES {
            return Err("DOCX image assets exceed the 50 MiB limit".to_string());
        }
        let extension = Path::new(&original_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let media_type = media_type_for_extension(&extension);
        let supported = media_type.is_some();
        let id = format!("asset-{}", position + 1);
        if supported {
            let stored_name = format!("{}-{}", position + 1, original_name);
            let target = output_dir.join(&stored_name);
            let mut output = File::create(&target)
                .map_err(|error| format!("unable to create converted DOCX asset: {error}"))?;
            io::copy(&mut entry, &mut output)
                .map_err(|error| format!("unable to extract converted DOCX asset: {error}"))?;
            output
                .sync_all()
                .map_err(|error| format!("unable to sync converted DOCX asset: {error}"))?;
            emitter.emit(WorkerEvent::Asset {
                asset_id: id.clone(),
                file_name: original_name.clone(),
                media_type: media_type.unwrap_or("application/octet-stream").to_string(),
                relative_path: stored_name,
                bytes: entry.size(),
            })?;
        }
        assets.push(DocxAssetRef {
            id,
            file_name: original_name,
            supported,
            relationship_ids: Vec::new(),
        });
        emitter.phase(
            "docx-assets",
            Some(DocumentProgressUnit::Assets),
            Some((position + 1) as u64),
            Some(media_total),
        )?;
    }
    Ok(assets)
}

fn sanitize_asset_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "asset.bin".to_string()
    } else {
        sanitized
    }
}

fn media_type_for_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn render_docx_paragraph(
    paragraph: &docx_rs::Paragraph,
    hyperlinks: &HashMap<String, String>,
    assets: &[DocxAssetRef],
    asset_index: &mut usize,
    referenced_assets: &mut HashSet<String>,
    numbering_formats: &HashMap<(usize, usize), String>,
) -> String {
    let value = serde_json::to_value(&paragraph.children).unwrap_or(Value::Null);
    let mut text = render_docx_value(&value, hyperlinks, assets, asset_index, referenced_assets);
    if text.trim().is_empty() {
        return "\n".to_string();
    }
    let property = serde_json::to_value(&paragraph.property).unwrap_or(Value::Null);
    if let Some(level) = docx_heading_level(&property) {
        text = format!("{} {}", "#".repeat(level), text.trim());
    } else if paragraph.has_numbering {
        let numbering = paragraph.property.numbering_property.as_ref();
        let id = numbering
            .and_then(|property| property.id.as_ref())
            .map(|value| value.id)
            .unwrap_or_default();
        let level = numbering
            .and_then(|property| property.level.as_ref())
            .map(|value| value.val)
            .unwrap_or_default()
            .min(12);
        let marker = numbering_formats
            .get(&(id, level))
            .filter(|format| !format.eq_ignore_ascii_case("bullet"))
            .map(|_| "1.")
            .unwrap_or("-");
        text = format!("{}{marker} {}", "  ".repeat(level), text.trim());
    }
    format!("{}\n\n", text.trim_end())
}

fn docx_numbering_formats(document: &docx_rs::Docx) -> HashMap<(usize, usize), String> {
    let mut formats = HashMap::new();
    for numbering in &document.numberings.numberings {
        let Some(abstract_numbering) = document
            .numberings
            .abstract_nums
            .iter()
            .find(|candidate| candidate.id == numbering.abstract_num_id)
        else {
            continue;
        };
        for level in &abstract_numbering.levels {
            formats.insert(
                (numbering.id, level.level),
                level.format.val.to_ascii_lowercase(),
            );
        }
    }
    formats
}

fn render_docx_table(table: &docx_rs::Table) -> String {
    let mut table_rows = table
        .rows
        .iter()
        .map(|row| match row {
            docx_rs::TableChild::TableRow(row) => row
                .cells
                .iter()
                .map(|cell| match cell {
                    docx_rs::TableRowChild::TableCell(cell) => {
                        let value = serde_json::to_value(&cell.children).unwrap_or(Value::Null);
                        escape_markdown(collect_docx_plain_text(&value).trim())
                            .replace('\n', "<br>")
                    }
                })
                .collect::<Vec<_>>(),
        })
        .filter(|row| !row.is_empty())
        .collect::<Vec<_>>();
    if table_rows.is_empty() {
        return String::new();
    }
    let columns = table_rows.iter().map(Vec::len).max().unwrap_or(1);
    for row in &mut table_rows {
        row.resize(columns, String::new());
    }
    let mut markdown = String::new();
    markdown.push_str(&format!("| {} |\n", table_rows[0].join(" | ")));
    markdown.push_str(&format!("| {} |\n", vec!["---"; columns].join(" | ")));
    for row in table_rows.iter().skip(1) {
        markdown.push_str(&format!("| {} |\n", row.join(" | ")));
    }
    markdown.push('\n');
    markdown
}

fn render_docx_value(
    value: &Value,
    hyperlinks: &HashMap<String, String>,
    assets: &[DocxAssetRef],
    asset_index: &mut usize,
    referenced_assets: &mut HashSet<String>,
) -> String {
    match value {
        Value::Array(values) => values
            .iter()
            .map(|value| {
                render_docx_value(value, hyperlinks, assets, asset_index, referenced_assets)
            })
            .collect(),
        Value::Object(object) => {
            if let Some(kind) = object.get("type").and_then(Value::as_str) {
                let data = object.get("data").unwrap_or(value);
                match kind.to_ascii_lowercase().as_str() {
                    "text" | "deletetext" | "instrtext" | "instrtextstring" => {
                        let text = data
                            .get("text")
                            .and_then(Value::as_str)
                            .or_else(|| data.as_str())
                            .unwrap_or_default();
                        return escape_markdown(text);
                    }
                    "run" => {
                        let raw = render_docx_value(
                            data.get("children").unwrap_or(data),
                            hyperlinks,
                            assets,
                            asset_index,
                            referenced_assets,
                        );
                        let property = data
                            .get("runProperty")
                            .or_else(|| data.get("run_property"))
                            .unwrap_or(&Value::Null);
                        return apply_docx_run_format(raw, property);
                    }
                    "hyperlink" => {
                        let label = render_docx_value(
                            data.get("children").unwrap_or(data),
                            hyperlinks,
                            assets,
                            asset_index,
                            referenced_assets,
                        );
                        if let Some(target) = find_docx_hyperlink_target(data, hyperlinks) {
                            return format!("[{}]({})", label, escape_markdown_url(&target));
                        }
                        return label;
                    }
                    "drawing" | "shape" => {
                        return render_docx_drawing(data, assets, asset_index, referenced_assets);
                    }
                    "break" | "carriagereturn" => return "  \n".to_string(),
                    "tab" | "ptab" => return "\t".to_string(),
                    _ => {
                        return render_docx_value(
                            data,
                            hyperlinks,
                            assets,
                            asset_index,
                            referenced_assets,
                        );
                    }
                }
            }
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                return escape_markdown(text);
            }
            object
                .values()
                .map(|value| {
                    render_docx_value(value, hyperlinks, assets, asset_index, referenced_assets)
                })
                .collect()
        }
        _ => String::new(),
    }
}

fn render_docx_drawing(
    value: &Value,
    assets: &[DocxAssetRef],
    asset_index: &mut usize,
    referenced_assets: &mut HashSet<String>,
) -> String {
    let mut strings = Vec::new();
    collect_strings(value, &mut strings);
    let matched_index = assets.iter().position(|asset| {
        strings.iter().any(|value| {
            asset
                .relationship_ids
                .iter()
                .any(|relationship| value.eq_ignore_ascii_case(relationship))
                || value
                    .replace('\\', "/")
                    .ends_with(&format!("/{}", asset.file_name))
                || value.eq_ignore_ascii_case(&asset.file_name)
        })
    });
    let selected_index =
        matched_index.or_else(|| (*asset_index < assets.len()).then_some(*asset_index));
    let Some(selected_index) = selected_index else {
        return "[Image]".to_string();
    };
    *asset_index = (*asset_index).max(selected_index.saturating_add(1));
    let asset = &assets[selected_index];
    referenced_assets.insert(asset.id.clone());
    if asset.supported {
        format!(
            "![{}](jotluck-asset://{})",
            escape_markdown(&asset.file_name),
            asset.id
        )
    } else {
        format!("[Unsupported image: {}]", escape_markdown(&asset.file_name))
    }
}

fn apply_docx_run_format(mut text: String, property: &Value) -> String {
    if text.is_empty() {
        return text;
    }
    let vertical =
        find_first_string_for_key(property, &["vert_align", "vertAlign", "verticalAlign"])
            .unwrap_or_default()
            .to_ascii_lowercase();
    if vertical.contains("super") {
        text = format!("<sup>{text}</sup>");
    } else if vertical.contains("sub") {
        text = format!("<sub>{text}</sub>");
    }
    if property_enabled(property, &["underline"]) {
        text = format!("<u>{text}</u>");
    }
    if property_enabled(property, &["strike", "dstrike"]) {
        text = format!("~~{text}~~");
    }
    if property_enabled(property, &["italic", "italic_cs"]) {
        text = format!("*{text}*");
    }
    if property_enabled(property, &["bold", "bold_cs"]) {
        text = format!("**{text}**");
    }
    text
}

fn property_enabled(value: &Value, names: &[&str]) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, child)| {
            let normalized = key.to_ascii_lowercase();
            if names
                .iter()
                .any(|name| normalized == name.to_ascii_lowercase())
            {
                return match child {
                    Value::Null | Value::Bool(false) => false,
                    Value::Object(object) => object
                        .get("val")
                        .or_else(|| object.get("value"))
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    _ => true,
                };
            }
            property_enabled(child, names)
        }),
        Value::Array(values) => values.iter().any(|child| property_enabled(child, names)),
        _ => false,
    }
}

fn docx_heading_level(property: &Value) -> Option<usize> {
    let mut strings = Vec::new();
    collect_strings(property, &mut strings);
    for value in strings {
        let normalized = value.to_ascii_lowercase().replace([' ', '-'], "");
        if let Some(level) = normalized
            .strip_prefix("heading")
            .and_then(|value| value.parse::<usize>().ok())
        {
            return Some(level.clamp(1, 6));
        }
        if let Some(level) = normalized
            .strip_prefix("标题")
            .and_then(|value| value.parse::<usize>().ok())
        {
            return Some(level.clamp(1, 6));
        }
    }
    find_numeric_key(property, &["outline_lvl", "outlineLvl"])
        .map(|value| (value as usize + 1).clamp(1, 6))
}

fn find_numeric_key(value: &Value, names: &[&str]) -> Option<u64> {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if names.iter().any(|name| key.eq_ignore_ascii_case(name)) {
                    if let Some(value) = child.as_u64() {
                        return Some(value);
                    }
                    if let Some(value) = child.as_str().and_then(|value| value.parse().ok()) {
                        return Some(value);
                    }
                    if let Some(value) = find_numeric_key(child, &["val", "value"]) {
                        return Some(value);
                    }
                }
                if let Some(value) = find_numeric_key(child, names) {
                    return Some(value);
                }
            }
            None
        }
        Value::Array(values) => values
            .iter()
            .find_map(|value| find_numeric_key(value, names)),
        _ => None,
    }
}

fn find_first_string_for_key(value: &Value, names: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if names.iter().any(|name| key.eq_ignore_ascii_case(name)) {
                    if let Some(value) = child.as_str() {
                        return Some(value.to_string());
                    }
                    let mut strings = Vec::new();
                    collect_strings(child, &mut strings);
                    if let Some(value) = strings.into_iter().next() {
                        return Some(value);
                    }
                }
                if let Some(value) = find_first_string_for_key(child, names) {
                    return Some(value);
                }
            }
            None
        }
        Value::Array(values) => values
            .iter()
            .find_map(|value| find_first_string_for_key(value, names)),
        _ => None,
    }
}

fn collect_strings(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::String(value) => output.push(value.clone()),
        Value::Array(values) => values
            .iter()
            .for_each(|value| collect_strings(value, output)),
        Value::Object(object) => object
            .values()
            .for_each(|value| collect_strings(value, output)),
        _ => {}
    }
}

fn find_docx_hyperlink_target(
    value: &Value,
    hyperlinks: &HashMap<String, String>,
) -> Option<String> {
    let mut strings = Vec::new();
    collect_strings(value, &mut strings);
    strings
        .iter()
        .find(|value| is_safe_link_target(value))
        .cloned()
        .or_else(|| {
            strings
                .iter()
                .find_map(|value| hyperlinks.get(value).cloned())
        })
        .filter(|value| is_safe_link_target(value))
}

fn is_safe_link_target(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    normalized.starts_with("https://")
        || normalized.starts_with("http://")
        || normalized.starts_with("mailto:")
        || normalized.starts_with('#')
}

fn collect_docx_plain_text(value: &Value) -> String {
    match value {
        Value::Array(values) => values.iter().map(collect_docx_plain_text).collect(),
        Value::Object(object) => {
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                return text.to_string();
            }
            if object.keys().any(|key| {
                matches!(
                    key.as_str(),
                    "Break" | "break" | "CarriageReturn" | "carriageReturn"
                )
            }) {
                return "\n".to_string();
            }
            if object
                .keys()
                .any(|key| matches!(key.as_str(), "Tab" | "tab"))
            {
                return "\t".to_string();
            }
            object.values().map(collect_docx_plain_text).collect()
        }
        _ => String::new(),
    }
}

fn convert_pdf(path: &Path, emitter: &mut WorkerEmitter<'_, impl Write>) -> Result<(), String> {
    emitter.phase("parse-pdf", None, None, None)?;
    let document = lopdf::Document::load(path)
        .map_err(|error| format!("unable to parse PDF document: {error}"))?;
    if document.is_encrypted() {
        return Err("encrypted PDF documents cannot be previewed".to_string());
    }
    let pages = document.get_pages();
    let total = pages.len() as u64;
    let mut extracted_any = false;
    emitter.warning(
        "pdf-images-not-imported",
        "PDF preview extracts selectable text only; images and OCR are not included.",
        None,
    )?;
    for (index, page_number) in pages.keys().enumerate() {
        let text = document
            .extract_text_with_limit(&[*page_number], MAX_PDF_PAGE_EXPANDED_BYTES)
            .map_err(|error| format!("unable to extract PDF page {page_number}: {error}"))?;
        if !text.trim().is_empty() {
            extracted_any = true;
        }
        let content = escape_source_block(text.trim());
        emitter.chunk(format!(
            "<!-- jotluck-pdf-page:{} -->\n\n## Page {}\n\n{}\n\n",
            page_number, page_number, content
        ))?;
        emitter.phase(
            "pdf-pages",
            Some(DocumentProgressUnit::Pages),
            Some((index + 1) as u64),
            Some(total),
        )?;
    }
    if !extracted_any {
        return Err("PDF has no extractable text; scanned documents require OCR, which JotLuck does not perform".to_string());
    }
    Ok(())
}

fn convert_spreadsheet(
    path: &Path,
    kind: ImportedDocumentKind,
    emitter: &mut WorkerEmitter<'_, impl Write>,
) -> Result<(), String> {
    if kind == ImportedDocumentKind::Xlsx {
        let names = preflight_ooxml(path)?;
        if names
            .iter()
            .any(|name| name.starts_with("xl/drawings/") || name.starts_with("xl/media/"))
        {
            emitter.warning(
                "spreadsheet-visuals-flattened",
                "Charts and embedded images are not represented in Markdown preview.",
                None,
            )?;
        }
    }
    emitter.phase("parse-spreadsheet", None, None, None)?;
    let mut workbook = open_workbook_auto(path)
        .map_err(|error| format!("unable to parse spreadsheet: {error}"))?;
    let sheets = workbook.sheets_metadata().to_vec();
    let total_sheets = sheets.len() as u64;
    for (sheet_index, sheet) in sheets.iter().enumerate() {
        let hidden = sheet.visible != SheetVisible::Visible;
        if hidden {
            emitter.warning(
                "spreadsheet-hidden-sheet",
                format!("Hidden sheet '{}' was retained in the preview.", sheet.name),
                Some(sheet.name.clone()),
            )?;
        }
        if sheet.typ != SheetType::WorkSheet {
            emitter.warning(
                "spreadsheet-non-worksheet",
                format!(
                    "Sheet '{}' is not a worksheet and was flattened to a heading.",
                    sheet.name
                ),
                Some(sheet.name.clone()),
            )?;
            emitter.chunk(format!(
                "## {}{}\n\n> This sheet type has no tabular Markdown representation.\n\n",
                escape_markdown(&sheet.name),
                if hidden { " (hidden)" } else { "" }
            ))?;
            continue;
        }
        let range = workbook
            .worksheet_range(&sheet.name)
            .map_err(|error| format!("unable to read worksheet '{}': {error}", sheet.name))?;
        let formulas = workbook.worksheet_formula(&sheet.name).unwrap_or_default();
        let (row_count, column_count) = range.get_size();
        let (start_row_index, start_column_index) = range.start().unwrap_or((0, 0));
        let mut markdown = format!(
            "## {}{}\n\n",
            escape_markdown(&sheet.name),
            if hidden { " (hidden)" } else { "" }
        );
        if row_count == 0 || column_count == 0 {
            markdown.push_str("> Empty worksheet.\n\n");
        } else {
            let columns = (0..column_count)
                .map(|column| excel_column_label(start_column_index as usize + column))
                .collect::<Vec<_>>();
            markdown.push_str(&format!("| Row | {} |\n", columns.join(" | ")));
            markdown.push_str(&format!(
                "| --- | {} |\n",
                vec!["---"; column_count].join(" | ")
            ));
            let start_row = start_row_index as usize + 1;
            for (row_index, row) in range.rows().enumerate() {
                let cells = (0..column_count)
                    .map(|column| {
                        row.get(column)
                            .map(format_spreadsheet_cell)
                            .unwrap_or_default()
                            .replace(['\r', '\n'], "<br>")
                    })
                    .collect::<Vec<_>>();
                markdown.push_str(&format!(
                    "| {} | {} |\n",
                    start_row + row_index,
                    cells.join(" | ")
                ));
                emitter.phase(
                    "spreadsheet-rows",
                    Some(DocumentProgressUnit::Rows),
                    Some((row_index + 1) as u64),
                    Some(row_count as u64),
                )?;
            }
            markdown.push('\n');
        }

        let formula_entries = formulas
            .rows()
            .enumerate()
            .flat_map(|(row, values)| {
                values
                    .iter()
                    .enumerate()
                    .filter(|(_, formula)| !formula.trim().is_empty())
                    .map(move |(column, formula)| (row, column, formula.clone()))
            })
            .collect::<Vec<_>>();
        if !formula_entries.is_empty() {
            markdown.push_str(
                "### Formula appendix\n\n| Cell | Formula | Cached value |\n| --- | --- | --- |\n",
            );
            let data_start = range.start().unwrap_or((0, 0));
            let formula_start = formulas.start().unwrap_or((0, 0));
            for (row, column, formula) in formula_entries {
                let absolute_row = formula_start.0 as usize + row;
                let absolute_column = formula_start.1 as usize + column;
                let relative_row = absolute_row.saturating_sub(data_start.0 as usize);
                let relative_column = absolute_column.saturating_sub(data_start.1 as usize);
                let cached = range
                    .get((relative_row, relative_column))
                    .map(format_spreadsheet_cell)
                    .unwrap_or_default();
                let coordinate = format!(
                    "{}{}",
                    excel_column_label(absolute_column),
                    absolute_row + 1
                );
                markdown.push_str(&format!(
                    "| {} | {} | {} |\n",
                    coordinate,
                    escape_markdown(&formula),
                    cached
                ));
            }
            markdown.push('\n');
        }
        emitter.chunk(markdown)?;
        emitter.phase(
            "spreadsheet-sheets",
            Some(DocumentProgressUnit::Sheets),
            Some((sheet_index + 1) as u64),
            Some(total_sheets),
        )?;
    }
    emitter.warning(
        "spreadsheet-layout-flattened",
        "Cell styling, merged-cell geometry, charts, and embedded objects were flattened to Markdown semantics.",
        None,
    )?;
    Ok(())
}

fn format_spreadsheet_cell(value: &Data) -> String {
    use calamine::DataType;
    let raw = match value {
        Data::Empty => String::new(),
        Data::DateTime(_) => value
            .as_datetime()
            .map(|value| value.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or_else(|| value.to_string()),
        Data::DateTimeIso(value) | Data::DurationIso(value) | Data::String(value) => value.clone(),
        Data::Int(value) => value.to_string(),
        Data::Float(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::Error(value) => value.to_string(),
    };
    escape_markdown(&raw)
}

fn excel_column_label(mut column: usize) -> String {
    let mut output = String::new();
    loop {
        output.insert(0, (b'A' + (column % 26) as u8) as char);
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    output
}

fn escape_source_block(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(escape_markdown)
        .collect::<Vec<_>>()
        .join("  \n")
}

fn escape_markdown(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '{' | '}' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '.'
            | '!' | '|' => {
                output.push('\\');
                output.push(character);
            }
            _ => output.push(character),
        }
    }
    output
}

fn escape_markdown_url(value: &str) -> String {
    value
        .replace('\\', "%5C")
        .replace('(', "%28")
        .replace(')', "%29")
        .replace(' ', "%20")
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use std::io::Cursor;

    fn temp_test_directory(label: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "JotLuck-document-import-{label}-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn decoded_worker_events(bytes: Vec<u8>) -> Vec<WorkerEvent> {
        let length = bytes.len() as u64;
        let mut cursor = Cursor::new(bytes);
        let mut events = Vec::new();
        while cursor.position() < length {
            let frame: WorkerFrame = read_frame(&mut cursor).unwrap();
            assert_eq!(frame.protocol_version, PROTOCOL_VERSION);
            events.push(frame.event);
        }
        events
    }

    fn emitted_markdown(events: &[WorkerEvent]) -> String {
        events
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::Chunk { markdown, .. } => Some(markdown.as_str()),
                _ => None,
            })
            .collect()
    }

    fn create_docx_fixture(path: &Path) {
        use docx_rs::*;
        const ONE_PIXEL_PNG: &[u8] = &[
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207,
            192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
            96, 130,
        ];
        let table = Table::new(vec![
            TableRow::new(vec![
                TableCell::new()
                    .add_paragraph(Paragraph::new().add_run(Run::new().add_text("姓名"))),
                TableCell::new().add_paragraph(Paragraph::new().add_run(Run::new().add_text("值"))),
            ]),
            TableRow::new(vec![
                TableCell::new()
                    .add_paragraph(Paragraph::new().add_run(Run::new().add_text("小明"))),
                TableCell::new()
                    .add_paragraph(Paragraph::new().add_run(Run::new().add_text("A|B"))),
            ]),
        ]);
        Docx::new()
            .add_paragraph(
                Paragraph::new()
                    .style("Heading1")
                    .add_run(Run::new().add_text("季度标题")),
            )
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text("粗体").bold())
                    .add_run(Run::new().add_text("斜体").italic())
                    .add_run(Run::new().add_text("删除").strike())
                    .add_run(Run::new().add_text("下划线").underline("single")),
            )
            .add_paragraph(
                Paragraph::new().add_hyperlink(
                    Hyperlink::new("https://example.com/a b", HyperlinkType::External)
                        .add_run(Run::new().add_text("链接")),
                ),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(1))
                    .add_run(Run::new().add_text("嵌套列表")),
            )
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("# 原始标记 <script>")))
            .add_table(table)
            .add_paragraph(Paragraph::new().add_run(
                Run::new().add_image(Pic::new_with_dimensions(ONE_PIXEL_PNG.to_vec(), 1, 1)),
            ))
            .build()
            .pack(File::create(path).unwrap())
            .unwrap();
    }

    fn create_pdf_fixture(path: &Path, page_texts: &[&str]) {
        use lopdf::content::{Content, Operation};
        use lopdf::{dictionary, Document, Object, Stream};

        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = document.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let pages = page_texts
            .iter()
            .map(|text| {
                let content = Content {
                    operations: vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec!["F1".into(), 12.into()]),
                        Operation::new("Td", vec![50.into(), 700.into()]),
                        Operation::new("Tj", vec![Object::string_literal(*text)]),
                        Operation::new("ET", vec![]),
                    ],
                };
                let content_id =
                    document.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
                document
                    .add_object(dictionary! {
                        "Type" => "Page",
                        "Parent" => pages_id,
                        "Contents" => content_id,
                    })
                    .into()
            })
            .collect::<Vec<Object>>();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => pages,
                "Count" => page_texts.len() as i64,
                "Resources" => resources_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            }),
        );
        let catalog_id =
            document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        document.trailer.set("Root", catalog_id);
        document.save(path).unwrap();
    }

    fn write_zip_entry(archive: &mut zip::ZipWriter<File>, name: &str, content: &str) {
        use zip::write::SimpleFileOptions;
        archive
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        archive.write_all(content.as_bytes()).unwrap();
    }

    fn create_xlsx_fixture(path: &Path) {
        let mut archive = zip::ZipWriter::new(File::create(path).unwrap());
        write_zip_entry(
            &mut archive,
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#,
        );
        write_zip_entry(
            &mut archive,
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#,
        );
        write_zip_entry(
            &mut archive,
            "xl/workbook.xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="数据" sheetId="1" r:id="rId1"/>
    <sheet name="隐藏表" sheetId="2" state="hidden" r:id="rId2"/>
  </sheets>
</workbook>"#,
        );
        write_zip_entry(
            &mut archive,
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#,
        );
        write_zip_entry(
            &mut archive,
            "xl/styles.xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>
</styleSheet>"#,
        );
        write_zip_entry(
            &mut archive,
            "xl/worksheets/sheet1.xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>名称</t></is></c>
      <c r="B1" t="inlineStr"><is><t>计算</t></is></c>
      <c r="C1" t="inlineStr"><is><t>日期</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>#unsafe|value</t></is></c>
      <c r="B2"><f>1+2</f><v>3</v></c>
      <c r="C2" s="1"><v>45292</v></c>
    </row>
  </sheetData>
</worksheet>"#,
        );
        write_zip_entry(
            &mut archive,
            "xl/worksheets/sheet2.xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="C1" t="inlineStr"><is><t>隐藏内容</t></is></c></row></sheetData>
</worksheet>"#,
        );
        archive.finish().unwrap();
    }

    fn create_xls_fixture(path: &Path) {
        // MIT-licensed Calamine BIFF5 fixture:
        // https://github.com/tafia/calamine/blob/master/tests/biff5_write.xls
        let encoded = include_str!("../fixtures/biff5_write.xls.b64");
        let bytes = general_purpose::STANDARD.decode(encoded.trim()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn markdown_escaping_blocks_source_syntax_and_html() {
        assert_eq!(
            escape_markdown("# <script>*x*</script> | [link]"),
            "\\# &lt;script&gt;\\*x\\*&lt;/script&gt; \\| \\[link\\]"
        );
    }

    #[test]
    fn excel_column_labels_cover_multi_letter_columns() {
        assert_eq!(excel_column_label(0), "A");
        assert_eq!(excel_column_label(25), "Z");
        assert_eq!(excel_column_label(26), "AA");
        assert_eq!(excel_column_label(701), "ZZ");
        assert_eq!(excel_column_label(702), "AAA");
    }

    #[test]
    fn worker_asset_paths_cannot_escape_the_private_directory() {
        let root = std::env::temp_dir().join(format!("JotLuck-assets-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("safe.png"), b"png").unwrap();
        assert!(resolve_worker_asset_path(&root, "safe.png").is_ok());
        assert!(resolve_worker_asset_path(&root, "../escape.png").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ooxml_preflight_rejects_zip_path_traversal() {
        use zip::write::SimpleFileOptions;

        let root = temp_test_directory("unsafe-ooxml");
        let source = root.join("unsafe.docx");
        let mut archive = zip::ZipWriter::new(File::create(&source).unwrap());
        archive
            .start_file(
                "../outside.xml",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        archive.write_all(b"unsafe").unwrap();
        archive.finish().unwrap();

        let error = preflight_ooxml(&source).unwrap_err();
        assert!(error.contains("unsafe path"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn docx_fixture_maps_semantics_assets_and_source_escaping() {
        let root = temp_test_directory("docx");
        let source = root.join("fixture.docx");
        let assets = root.join("assets");
        fs::create_dir(&assets).unwrap();
        create_docx_fixture(&source);
        let mut frames = Vec::new();
        convert_docx(&source, &assets, &mut WorkerEmitter::new(&mut frames)).unwrap();
        let events = decoded_worker_events(frames);
        let markdown = emitted_markdown(&events);

        assert!(markdown.contains("# 季度标题"));
        assert!(markdown.contains("**粗体**"));
        assert!(markdown.contains("*斜体*"));
        assert!(markdown.contains("~~删除~~"));
        assert!(markdown.contains("<u>下划线</u>"));
        assert!(
            markdown.contains("[链接](https://example.com/a%20b)"),
            "{markdown}"
        );
        assert!(markdown.contains("嵌套列表"));
        assert!(markdown.contains("\\# 原始标记 &lt;script&gt;"));
        assert!(markdown.contains("| 姓名 | 值 |"));
        assert!(markdown.contains("A\\|B"));
        assert!(markdown.contains("jotluck-asset://asset-"));
        assert!(events.iter().any(|event| matches!(
            event,
            WorkerEvent::Asset { media_type, .. } if media_type == "image/png"
        )));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pdf_fixture_streams_page_boundaries_and_rejects_textless_pages() {
        let root = temp_test_directory("pdf");
        let source = root.join("fixture.pdf");
        create_pdf_fixture(&source, &["First # page", "Second page"]);
        let mut frames = Vec::new();
        convert_pdf(&source, &mut WorkerEmitter::new(&mut frames)).unwrap();
        let events = decoded_worker_events(frames);
        let markdown = emitted_markdown(&events);
        assert!(markdown.contains("## Page 1"));
        assert!(markdown.contains("First \\# page"));
        assert!(markdown.contains("## Page 2"));
        assert!(events.iter().any(|event| matches!(
            event,
            WorkerEvent::Warning { code, .. } if code == "pdf-images-not-imported"
        )));

        create_pdf_fixture(&source, &[""]);
        let mut empty_frames = Vec::new();
        let error = convert_pdf(&source, &mut WorkerEmitter::new(&mut empty_frames)).unwrap_err();
        assert!(error.contains("no extractable text"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn xlsx_fixture_maps_sheets_dates_formulas_and_hidden_state() {
        let root = temp_test_directory("xlsx");
        let source = root.join("fixture.xlsx");
        create_xlsx_fixture(&source);
        let mut frames = Vec::new();
        convert_spreadsheet(
            &source,
            ImportedDocumentKind::Xlsx,
            &mut WorkerEmitter::new(&mut frames),
        )
        .unwrap();
        let events = decoded_worker_events(frames);
        let markdown = emitted_markdown(&events);
        assert!(markdown.contains("## 数据"));
        assert!(markdown.contains("| Row | A | B | C |"));
        assert!(markdown.contains("\\#unsafe\\|value"));
        assert!(markdown.contains("### Formula appendix"));
        assert!(markdown.contains("| B2 | 1\\+2 | 3 |"));
        assert!(markdown.contains("2024\\-01\\-01T00:00:00"));
        assert!(markdown.contains("## 隐藏表 (hidden)"));
        assert!(markdown.contains("| Row | C |"));
        assert!(events.iter().any(|event| matches!(
            event,
            WorkerEvent::Warning { code, context, .. }
                if code == "spreadsheet-hidden-sheet" && context.as_deref() == Some("隐藏表")
        )));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn xls_fixture_is_imported_through_the_biff_reader() {
        let root = temp_test_directory("xls");
        let source = root.join("fixture.xls");
        create_xls_fixture(&source);
        let mut frames = Vec::new();
        convert_spreadsheet(
            &source,
            ImportedDocumentKind::Xls,
            &mut WorkerEmitter::new(&mut frames),
        )
        .unwrap();
        let events = decoded_worker_events(frames);
        let markdown = emitted_markdown(&events);

        assert!(markdown.contains("## SheetJS"));
        assert!(markdown.contains("| Row | A | B | C | D |"));
        assert!(markdown.contains("foo"));
        assert!(markdown.contains("bar"));
        assert!(events.iter().any(|event| matches!(
            event,
            WorkerEvent::Phase {
                unit: Some(DocumentProgressUnit::Sheets),
                ..
            }
        )));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_helpers_force_markdown_and_use_non_conflicting_asset_directories() {
        let root = temp_test_directory("save");
        let target = root.join("report.md");
        assert_eq!(force_markdown_file_name("report.docx"), "report.md");
        assert_eq!(
            unique_assets_destination(&target),
            root.join("report.assets")
        );
        fs::create_dir(root.join("report.assets")).unwrap();
        assert_eq!(
            unique_assets_destination(&target),
            root.join("report-2.assets")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn final_save_commit_rejects_a_source_changed_after_staging() {
        let root = temp_test_directory("save-source-race");
        let source_path = root.join("source.docx");
        fs::write(&source_path, b"source-before-staging").unwrap();
        let expected_revision = source_revision(&source_path).unwrap();
        let job = ConversionJob {
            id: "conversion-test".to_string(),
            owner_window_label: "main".to_string(),
            source: DocumentImportSource {
                absolute_path: source_path.clone(),
                file_name: "source.docx".to_string(),
                kind: ImportedDocumentKind::Docx,
                revision: expected_revision.clone(),
            },
            temp_dir: root.join("conversion-temp"),
            cancelled: AtomicBool::new(false),
            terminal: AtomicBool::new(false),
            child: Mutex::new(None),
            windows_job: Mutex::new(None),
            data: Mutex::new(ConversionData {
                revision: Some(expected_revision),
                completed: true,
                ..ConversionData::default()
            }),
            channel: Channel::new(|_| Ok(())),
            watcher: Mutex::new(None),
        };
        let target = root.join("saved.md");
        let staged_markdown = stage_text_file(&target, "old conversion").unwrap();
        let staged_assets = root.join("staged-assets");
        let assets_destination = root.join("saved.assets");
        fs::create_dir(&staged_assets).unwrap();
        fs::write(staged_assets.join("image.png"), b"asset").unwrap();

        fs::write(&source_path, b"source-changed-after-staging").unwrap();
        let error = commit_converted_document(
            &job,
            &staged_markdown,
            &target,
            Some(&staged_assets),
            Some(&assets_destination),
        )
        .unwrap_err();

        assert!(error.contains("stale"));
        assert!(!target.exists());
        assert!(!assets_destination.exists());
        assert!(staged_markdown.exists());
        assert!(staged_assets.exists());
        assert!(job.data.lock().unwrap().stale);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn worker_classifies_invalid_and_resource_limited_inputs() {
        assert_eq!(
            classify_worker_failure(
                ImportedDocumentKind::Pdf,
                "encrypted PDF documents cannot be previewed".to_string(),
            )
            .code,
            "pdf_encrypted"
        );
        assert_eq!(
            classify_worker_failure(
                ImportedDocumentKind::Docx,
                "OOXML expanded content exceeds the 512 MiB limit".to_string(),
            )
            .code,
            "ooxml_limit_exceeded"
        );
        let mut oversized_frames = Vec::new();
        let mut emitter = WorkerEmitter::new(&mut oversized_frames);
        assert!(emitter.chunk("x".repeat(MAX_MARKDOWN_BYTES + 1)).is_err());
    }
}
