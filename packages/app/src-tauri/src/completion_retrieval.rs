use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::mem::size_of;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::State;
use unicode_normalization::UnicodeNormalization;

const MIN_CHINESE_CONTEXT: usize = 2;
const MAX_CHINESE_CONTEXT: usize = 8;
const MAX_ENGLISH_CONTEXT_WORDS: usize = 3;
const MAX_CANDIDATE_CODE_POINTS: usize = 24;
const MAX_ENGLISH_CANDIDATE_WORDS: usize = 3;
const MIN_DOCUMENT_SUPPORT: usize = 2;
const MAX_QUERY_CANDIDATES: usize = 8;
const CONTEXT_SEPARATOR: char = '\u{001f}';
const DEFAULT_MAX_DOCUMENTS: usize = 2_000;
const DEFAULT_MAX_DOCUMENT_INPUT_BYTES: usize = 512 * 1024;
const DEFAULT_MAX_TOTAL_INPUT_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_ENTRIES: usize = 20_000;
const DEFAULT_MAX_TOTAL_DOCUMENT_ENTRIES: usize = 300_000;
const MAX_BATCH_MUTATIONS: usize = 8;
const MAX_BATCH_INPUT_BYTES: usize = 2 * 1024 * 1024;
const LONG_BUILD_TASK: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompletionRetrievalLanguageHint {
    Zh,
    En,
    Mixed,
    Unknown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionSetScopeRequest {
    pub workspace_scope: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionReplaceRequest {
    pub workspace_scope: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRemoveRequest {
    pub workspace_scope: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRenameRequest {
    pub workspace_scope: String,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionClearRequest {
    pub workspace_scope: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase")]
pub enum CompletionBatchMutation {
    Replace {
        path: String,
        content: String,
    },
    Remove {
        path: String,
    },
    Rename {
        #[serde(rename = "oldPath")]
        old_path: String,
        #[serde(rename = "newPath")]
        new_path: String,
    },
    #[serde(alias = "reset")]
    Clear,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionBatchRequest {
    pub workspace_scope: String,
    pub mutations: Vec<CompletionBatchMutation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionQueryRequest {
    pub workspace_scope: String,
    pub context_before_cursor: String,
    pub language_hint: CompletionRetrievalLanguageHint,
    pub max_candidates: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionMutationResponse {
    pub operation: String,
    pub changed: bool,
    pub document_count: usize,
    pub revision: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRetrievalCandidate {
    pub text: String,
    pub confidence: f64,
    pub support: usize,
    pub document_support: usize,
    pub provider_id: String,
    pub source_layer: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionQueryResponse {
    pub operation: String,
    pub candidates: Vec<CompletionRetrievalCandidate>,
    pub committed_revision: usize,
    pub pending_mutations: usize,
    pub warming: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRetrievalBudget {
    pub max_documents: usize,
    pub max_document_input_bytes: usize,
    pub max_total_input_bytes: usize,
    pub max_document_entries: usize,
    pub max_total_document_entries: usize,
}

impl Default for CompletionRetrievalBudget {
    fn default() -> Self {
        Self {
            max_documents: DEFAULT_MAX_DOCUMENTS,
            max_document_input_bytes: DEFAULT_MAX_DOCUMENT_INPUT_BYTES,
            max_total_input_bytes: DEFAULT_MAX_TOTAL_INPUT_BYTES,
            max_document_entries: DEFAULT_MAX_DOCUMENT_ENTRIES,
            max_total_document_entries: DEFAULT_MAX_TOTAL_DOCUMENT_ENTRIES,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRetrievalDiagnostics {
    pub workspace_scope: String,
    pub document_count: usize,
    pub fingerprint_count: usize,
    pub input_bytes: usize,
    pub retained_content_bytes: usize,
    pub document_entries: usize,
    pub budget_rejections: usize,
    pub committed_revision: usize,
    pub pending_mutations: usize,
    pub pending_mutation_batches: usize,
    pub last_build_duration_ms: u64,
    pub total_build_duration_ms: u64,
    pub estimated_index_bytes: usize,
    pub long_tasks_over_50_ms: usize,
    pub budget: CompletionRetrievalBudget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ContentFingerprint {
    primary: u64,
    secondary: u64,
}

#[derive(Debug, Clone, Default)]
struct BranchContribution {
    count: usize,
    surfaces: BTreeMap<String, usize>,
}

type ContributionTable = BTreeMap<String, BTreeMap<String, BranchContribution>>;

#[derive(Debug, Clone)]
struct DocumentContribution {
    fingerprint: ContentFingerprint,
    input_bytes: usize,
    entry_count: usize,
    chinese: ContributionTable,
    english: ContributionTable,
}

#[derive(Debug)]
struct ContributionBuild {
    contribution: DocumentContribution,
    overflowed: bool,
}

#[derive(Debug)]
struct ContributionScanBudget {
    max_entries: usize,
    entry_count: usize,
    overflowed: bool,
}

#[derive(Debug, Clone, Default)]
struct AggregateBranch {
    support: usize,
    document_counts: BTreeMap<String, usize>,
    surface_counts: BTreeMap<String, usize>,
}

type AggregateTable = BTreeMap<String, BTreeMap<String, AggregateBranch>>;

#[derive(Debug, Clone, Default)]
struct CompletionRetrievalWriter {
    active_scope: Option<String>,
    documents: BTreeMap<String, DocumentContribution>,
    chinese: AggregateTable,
    english: AggregateTable,
    input_bytes: usize,
    document_entries: usize,
    budget_rejections: usize,
    revision: usize,
}

#[derive(Debug, Default)]
struct CommittedSnapshot {
    active_scope: Option<String>,
    chinese: AggregateTable,
    english: AggregateTable,
    document_count: usize,
    input_bytes: usize,
    document_entries: usize,
    budget_rejections: usize,
    revision: usize,
    estimated_index_bytes: usize,
}

/// In-memory V2 phrase retrieval state. Only one workspace is active at a time.
#[derive(Debug, Clone)]
pub struct CompletionRetrievalState {
    writer: Arc<Mutex<CompletionRetrievalWriter>>,
    committed: Arc<RwLock<Arc<CommittedSnapshot>>>,
    budget: CompletionRetrievalBudget,
    pending_mutations: Arc<AtomicUsize>,
    pending_batches: Arc<AtomicUsize>,
    last_build_duration_micros: Arc<AtomicU64>,
    total_build_duration_micros: Arc<AtomicU64>,
    long_task_count: Arc<AtomicUsize>,
}

struct PendingMutationGuard<'a> {
    mutations: &'a AtomicUsize,
    batches: &'a AtomicUsize,
    mutation_count: usize,
}

impl<'a> PendingMutationGuard<'a> {
    fn new(mutations: &'a AtomicUsize, batches: &'a AtomicUsize, mutation_count: usize) -> Self {
        mutations.fetch_add(mutation_count, Ordering::AcqRel);
        batches.fetch_add(1, Ordering::AcqRel);
        Self {
            mutations,
            batches,
            mutation_count,
        }
    }
}

impl Drop for PendingMutationGuard<'_> {
    fn drop(&mut self) {
        self.mutations
            .fetch_sub(self.mutation_count, Ordering::AcqRel);
        self.batches.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Default for CompletionRetrievalState {
    fn default() -> Self {
        Self {
            writer: Arc::new(Mutex::new(CompletionRetrievalWriter::default())),
            committed: Arc::new(RwLock::new(Arc::new(CommittedSnapshot::default()))),
            budget: CompletionRetrievalBudget::default(),
            pending_mutations: Arc::new(AtomicUsize::new(0)),
            pending_batches: Arc::new(AtomicUsize::new(0)),
            last_build_duration_micros: Arc::new(AtomicU64::new(0)),
            total_build_duration_micros: Arc::new(AtomicU64::new(0)),
            long_task_count: Arc::new(AtomicUsize::new(0)),
        }
    }
}

enum PreparedMutation {
    Replace {
        path: String,
        fingerprint: ContentFingerprint,
        input_bytes: usize,
        build: ContributionBuild,
    },
    Remove {
        path: String,
    },
    Rename {
        old_path: String,
        new_path: String,
    },
    Clear,
}

impl CompletionRetrievalState {
    pub fn set_scope(
        &self,
        request: CompletionSetScopeRequest,
    ) -> Result<CompletionMutationResponse, String> {
        let scope = normalize_scope(&request.workspace_scope)?;
        let mut writer = self.lock_writer()?;
        let changed = writer.active_scope.as_deref() != Some(scope.as_str());
        if changed {
            reset_workspace(&mut writer);
            writer.active_scope = Some(scope);
            self.publish_snapshot(&writer)?;
        }
        Ok(CompletionMutationResponse {
            operation: "setScope".to_string(),
            changed,
            document_count: writer.documents.len(),
            revision: writer.revision,
        })
    }

    pub fn replace_document(
        &self,
        request: CompletionReplaceRequest,
    ) -> Result<CompletionMutationResponse, String> {
        let mut response = self.apply_batch(CompletionBatchRequest {
            workspace_scope: request.workspace_scope,
            mutations: vec![CompletionBatchMutation::Replace {
                path: request.path,
                content: request.content,
            }],
        })?;
        response.operation = "replace".to_string();
        Ok(response)
    }

    pub fn remove_document(
        &self,
        request: CompletionRemoveRequest,
    ) -> Result<CompletionMutationResponse, String> {
        let mut response = self.apply_batch(CompletionBatchRequest {
            workspace_scope: request.workspace_scope,
            mutations: vec![CompletionBatchMutation::Remove { path: request.path }],
        })?;
        response.operation = "remove".to_string();
        Ok(response)
    }

    pub fn rename_document(
        &self,
        request: CompletionRenameRequest,
    ) -> Result<CompletionMutationResponse, String> {
        let mut response = self.apply_batch(CompletionBatchRequest {
            workspace_scope: request.workspace_scope,
            mutations: vec![CompletionBatchMutation::Rename {
                old_path: request.old_path,
                new_path: request.new_path,
            }],
        })?;
        response.operation = "rename".to_string();
        Ok(response)
    }

    pub fn clear(
        &self,
        request: CompletionClearRequest,
    ) -> Result<CompletionMutationResponse, String> {
        let mut response = self.apply_batch(CompletionBatchRequest {
            workspace_scope: request.workspace_scope,
            mutations: vec![CompletionBatchMutation::Clear],
        })?;
        response.operation = "clear".to_string();
        Ok(response)
    }

    pub fn apply_batch(
        &self,
        request: CompletionBatchRequest,
    ) -> Result<CompletionMutationResponse, String> {
        self.apply_batch_with_preparation_hook(request, || {})
    }

    fn apply_batch_with_preparation_hook<F>(
        &self,
        request: CompletionBatchRequest,
        before_preparation: F,
    ) -> Result<CompletionMutationResponse, String>
    where
        F: FnOnce(),
    {
        let mutation_count = request.mutations.len();
        if mutation_count == 0 {
            return Err("completion mutation batch must not be empty".to_string());
        }
        if mutation_count > MAX_BATCH_MUTATIONS {
            return Err(format!(
                "completion mutation batch exceeds {MAX_BATCH_MUTATIONS} operations"
            ));
        }
        let batch_input_bytes = request
            .mutations
            .iter()
            .map(|mutation| match mutation {
                CompletionBatchMutation::Replace { path, content } => path.len() + content.len(),
                CompletionBatchMutation::Remove { path } => path.len(),
                CompletionBatchMutation::Rename { old_path, new_path } => {
                    old_path.len() + new_path.len()
                }
                CompletionBatchMutation::Clear => 0,
            })
            .sum::<usize>();
        if batch_input_bytes > MAX_BATCH_INPUT_BYTES {
            return Err(format!(
                "completion mutation batch exceeds {MAX_BATCH_INPUT_BYTES} input bytes"
            ));
        }

        let _pending = PendingMutationGuard::new(
            &self.pending_mutations,
            &self.pending_batches,
            mutation_count,
        );
        let started = Instant::now();
        before_preparation();
        let result = self.apply_batch_inner(request);
        self.record_build_duration(started.elapsed());
        result
    }

    fn apply_batch_inner(
        &self,
        request: CompletionBatchRequest,
    ) -> Result<CompletionMutationResponse, String> {
        let scope = normalize_scope(&request.workspace_scope)?;
        let mut prepared = Vec::with_capacity(request.mutations.len());
        for mutation in request.mutations {
            prepared.push(self.prepare_mutation(mutation)?);
        }

        self.commit_prepared_batch(&scope, prepared, || {})
    }

    fn commit_prepared_batch<F>(
        &self,
        scope: &str,
        prepared: Vec<PreparedMutation>,
        before_publish: F,
    ) -> Result<CompletionMutationResponse, String>
    where
        F: FnOnce(),
    {
        let mut writer = self.lock_writer()?;
        ensure_active_scope(writer.active_scope.as_deref(), scope)?;
        let mut changed = false;
        for mutation in prepared {
            changed |= self.apply_prepared_mutation(&mut writer, mutation)?;
        }
        // A validated, non-empty batch is one atomic commit even when every
        // operation is idempotent or rejected by a resource budget.
        writer.revision = writer.revision.saturating_add(1);
        let snapshot = Arc::new(build_committed_snapshot(&writer));
        before_publish();
        self.publish_prebuilt_snapshot(snapshot)?;
        Ok(CompletionMutationResponse {
            operation: "batch".to_string(),
            changed,
            document_count: writer.documents.len(),
            revision: writer.revision,
        })
    }

    fn prepare_mutation(
        &self,
        mutation: CompletionBatchMutation,
    ) -> Result<PreparedMutation, String> {
        match mutation {
            CompletionBatchMutation::Replace { path, content } => {
                let path = normalize_path(&path)?;
                let fingerprint = fingerprint(&content);
                let input_bytes = content.len();
                // Contribution extraction is the expensive step. It intentionally
                // happens before acquiring the writer and committed snapshot locks.
                let build = build_document_contribution(
                    &content,
                    fingerprint,
                    self.budget.max_document_entries,
                );
                Ok(PreparedMutation::Replace {
                    path,
                    fingerprint,
                    input_bytes,
                    build,
                })
            }
            CompletionBatchMutation::Remove { path } => Ok(PreparedMutation::Remove {
                path: normalize_path(&path)?,
            }),
            CompletionBatchMutation::Rename { old_path, new_path } => {
                Ok(PreparedMutation::Rename {
                    old_path: normalize_path(&old_path)?,
                    new_path: normalize_path(&new_path)?,
                })
            }
            CompletionBatchMutation::Clear => Ok(PreparedMutation::Clear),
        }
    }

    fn apply_prepared_mutation(
        &self,
        writer: &mut CompletionRetrievalWriter,
        mutation: PreparedMutation,
    ) -> Result<bool, String> {
        match mutation {
            PreparedMutation::Replace {
                path,
                fingerprint,
                input_bytes,
                build,
            } => {
                if writer.documents.get(&path).is_some_and(|previous| {
                    previous.fingerprint == fingerprint && previous.input_bytes == input_bytes
                }) {
                    return Ok(false);
                }
                let previous_input_bytes = writer
                    .documents
                    .get(&path)
                    .map_or(0, |previous| previous.input_bytes);
                let previous_entries = writer
                    .documents
                    .get(&path)
                    .map_or(0, |previous| previous.entry_count);
                let next_document_count =
                    writer.documents.len() + usize::from(!writer.documents.contains_key(&path));
                let next_input_bytes = writer
                    .input_bytes
                    .saturating_sub(previous_input_bytes)
                    .saturating_add(input_bytes);
                let next_document_entries = writer
                    .document_entries
                    .saturating_sub(previous_entries)
                    .saturating_add(build.contribution.entry_count);
                if next_document_count > self.budget.max_documents
                    || input_bytes > self.budget.max_document_input_bytes
                    || next_input_bytes > self.budget.max_total_input_bytes
                    || build.overflowed
                    || next_document_entries > self.budget.max_total_document_entries
                {
                    writer.budget_rejections = writer.budget_rejections.saturating_add(1);
                    return Ok(false);
                }
                if let Some(previous) = writer.documents.remove(&path) {
                    remove_document_accounting(writer, &path, &previous);
                }
                add_document_accounting(writer, &path, &build.contribution);
                writer.documents.insert(path, build.contribution);
                Ok(true)
            }
            PreparedMutation::Remove { path } => {
                let Some(contribution) = writer.documents.remove(&path) else {
                    return Ok(false);
                };
                remove_document_accounting(writer, &path, &contribution);
                Ok(true)
            }
            PreparedMutation::Rename { old_path, new_path } => {
                if old_path == new_path || !writer.documents.contains_key(&old_path) {
                    return Ok(false);
                }
                if let Some(overwritten) = writer.documents.remove(&new_path) {
                    remove_document_accounting(writer, &new_path, &overwritten);
                }
                let contribution = writer.documents.remove(&old_path).ok_or_else(|| {
                    "completion contribution disappeared during rename".to_string()
                })?;
                remove_document_accounting(writer, &old_path, &contribution);
                add_document_accounting(writer, &new_path, &contribution);
                writer.documents.insert(new_path, contribution);
                Ok(true)
            }
            PreparedMutation::Clear => {
                let changed = !writer.documents.is_empty();
                reset_workspace(writer);
                Ok(changed)
            }
        }
    }

    pub fn query(
        &self,
        request: CompletionQueryRequest,
    ) -> Result<CompletionQueryResponse, String> {
        let scope = normalize_scope(&request.workspace_scope)?;
        // Clone the Arc under a very short read lock, then perform the complete
        // query without holding either the writer or publication lock.
        let snapshot = self.committed_snapshot()?;
        ensure_active_scope(snapshot.active_scope.as_deref(), &scope)?;
        let limit = request.max_candidates.min(MAX_QUERY_CANDIDATES);
        let language = resolve_language_hint(request.language_hint, &request.context_before_cursor);
        let candidates = match language {
            CompletionRetrievalLanguageHint::Zh if limit > 0 => {
                query_chinese(&snapshot.chinese, &request.context_before_cursor, limit)
            }
            CompletionRetrievalLanguageHint::En if limit > 0 => {
                query_english(&snapshot.english, &request.context_before_cursor, limit)
            }
            _ => Vec::new(),
        };
        let pending_mutations = self.pending_mutations.load(Ordering::Acquire);
        Ok(CompletionQueryResponse {
            operation: "query".to_string(),
            candidates,
            committed_revision: snapshot.revision,
            pending_mutations,
            warming: pending_mutations > 0,
        })
    }

    pub fn diagnostics(
        &self,
        workspace_scope: &str,
    ) -> Result<CompletionRetrievalDiagnostics, String> {
        let scope = normalize_scope(workspace_scope)?;
        let snapshot = self.committed_snapshot()?;
        ensure_active_scope(snapshot.active_scope.as_deref(), &scope)?;
        Ok(CompletionRetrievalDiagnostics {
            workspace_scope: scope,
            document_count: snapshot.document_count,
            fingerprint_count: snapshot.document_count,
            input_bytes: snapshot.input_bytes,
            retained_content_bytes: 0,
            document_entries: snapshot.document_entries,
            budget_rejections: snapshot.budget_rejections,
            committed_revision: snapshot.revision,
            pending_mutations: self.pending_mutations.load(Ordering::Acquire),
            pending_mutation_batches: self.pending_batches.load(Ordering::Acquire),
            last_build_duration_ms: self.last_build_duration_micros.load(Ordering::Acquire) / 1_000,
            total_build_duration_ms: self.total_build_duration_micros.load(Ordering::Acquire)
                / 1_000,
            estimated_index_bytes: snapshot.estimated_index_bytes,
            long_tasks_over_50_ms: self.long_task_count.load(Ordering::Acquire),
            budget: self.budget,
        })
    }

    #[cfg(test)]
    fn with_budget(budget: CompletionRetrievalBudget) -> Self {
        Self {
            writer: Arc::new(Mutex::new(CompletionRetrievalWriter::default())),
            committed: Arc::new(RwLock::new(Arc::new(CommittedSnapshot::default()))),
            budget,
            pending_mutations: Arc::new(AtomicUsize::new(0)),
            pending_batches: Arc::new(AtomicUsize::new(0)),
            last_build_duration_micros: Arc::new(AtomicU64::new(0)),
            total_build_duration_micros: Arc::new(AtomicU64::new(0)),
            long_task_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn lock_writer(&self) -> Result<std::sync::MutexGuard<'_, CompletionRetrievalWriter>, String> {
        self.writer
            .lock()
            .map_err(|_| "completion retrieval writer lock is poisoned".to_string())
    }

    fn committed_snapshot(&self) -> Result<Arc<CommittedSnapshot>, String> {
        self.committed
            .read()
            .map(|snapshot| Arc::clone(&snapshot))
            .map_err(|_| "completion retrieval snapshot lock is poisoned".to_string())
    }

    fn publish_snapshot(&self, writer: &CompletionRetrievalWriter) -> Result<(), String> {
        // Construct every map before taking the publication lock. Readers can
        // only observe the previous Arc or this complete replacement Arc.
        let snapshot = Arc::new(build_committed_snapshot(writer));
        self.publish_prebuilt_snapshot(snapshot)
    }

    fn publish_prebuilt_snapshot(&self, snapshot: Arc<CommittedSnapshot>) -> Result<(), String> {
        let mut committed = self
            .committed
            .write()
            .map_err(|_| "completion retrieval snapshot lock is poisoned".to_string())?;
        *committed = snapshot;
        Ok(())
    }

    fn record_build_duration(&self, duration: Duration) {
        let micros = duration.as_micros().min(u128::from(u64::MAX)) as u64;
        self.last_build_duration_micros
            .store(micros, Ordering::Release);
        self.total_build_duration_micros
            .fetch_add(micros, Ordering::AcqRel);
        if duration > LONG_BUILD_TASK {
            self.long_task_count.fetch_add(1, Ordering::AcqRel);
        }
    }
}

#[tauri::command]
pub async fn completion_v2_set_scope(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionSetScopeRequest,
) -> Result<CompletionMutationResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.set_scope(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_replace_document(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionReplaceRequest,
) -> Result<CompletionMutationResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.replace_document(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_remove_document(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionRemoveRequest,
) -> Result<CompletionMutationResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.remove_document(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_rename_document(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionRenameRequest,
) -> Result<CompletionMutationResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.rename_document(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_clear(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionClearRequest,
) -> Result<CompletionMutationResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.clear(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_apply_batch(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionBatchRequest,
) -> Result<CompletionMutationResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_batch(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_query(
    state: State<'_, CompletionRetrievalState>,
    request: CompletionQueryRequest,
) -> Result<CompletionQueryResponse, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.query(request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn completion_v2_diagnostics(
    state: State<'_, CompletionRetrievalState>,
    workspace_scope: String,
) -> Result<CompletionRetrievalDiagnostics, String> {
    state.diagnostics(&workspace_scope)
}

fn join_error(error: impl std::fmt::Display) -> String {
    format!("completion retrieval background task failed: {error}")
}

fn build_document_contribution(
    content: &str,
    fingerprint: ContentFingerprint,
    max_entries: usize,
) -> ContributionBuild {
    let mut chinese = ContributionTable::new();
    let mut english = ContributionTable::new();
    let mut scan_budget = ContributionScanBudget {
        max_entries,
        entry_count: 0,
        overflowed: false,
    };
    for line in extract_prose_lines(content) {
        scan_chinese_line(&line, &mut chinese, &mut scan_budget);
        if scan_budget.overflowed {
            break;
        }
        scan_english_line(&line, &mut english, &mut scan_budget);
        if scan_budget.overflowed {
            break;
        }
    }
    ContributionBuild {
        contribution: DocumentContribution {
            fingerprint,
            input_bytes: content.len(),
            entry_count: scan_budget.entry_count,
            chinese,
            english,
        },
        overflowed: scan_budget.overflowed,
    }
}

fn scan_chinese_line(
    line: &str,
    table: &mut ContributionTable,
    scan_budget: &mut ContributionScanBudget,
) {
    let points: Vec<char> = line.chars().collect();
    if !line.chars().any(is_han) || points.len() <= MIN_CHINESE_CONTEXT {
        return;
    }
    for boundary in MIN_CHINESE_CONTEXT..points.len() {
        let candidate = take_chinese_continuation(&points, boundary);
        if !is_candidate_allowed(&candidate, Language::Zh) {
            continue;
        }
        for context_length in MIN_CHINESE_CONTEXT..=MAX_CHINESE_CONTEXT.min(boundary) {
            let context = normalize_whitespace(
                &points[boundary - context_length..boundary]
                    .iter()
                    .collect::<String>(),
            );
            if is_valid_chinese_context(&context)
                && !record_contribution(
                    table,
                    context,
                    candidate.clone(),
                    normalize_zh(&candidate),
                    scan_budget,
                )
            {
                return;
            }
        }
    }
}

fn scan_english_line(
    line: &str,
    table: &mut ContributionTable,
    scan_budget: &mut ContributionScanBudget,
) {
    for sentence in line.split(is_sentence_separator) {
        let words = extract_english_tokens(sentence);
        for next_index in 1..words.len() {
            let candidate_words = longest_allowed_english_candidate(&words[next_index..]);
            if candidate_words.is_empty() {
                continue;
            }
            let surface = candidate_words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let candidate_key = normalize_en(&surface);
            for context_length in 1..=MAX_ENGLISH_CONTEXT_WORDS.min(next_index) {
                let context = words[next_index - context_length..next_index]
                    .iter()
                    .map(|word| word.normalized.as_str())
                    .collect::<Vec<_>>()
                    .join(&CONTEXT_SEPARATOR.to_string());
                if !record_contribution(
                    table,
                    context,
                    surface.clone(),
                    candidate_key.clone(),
                    scan_budget,
                ) {
                    return;
                }
            }
        }
    }
}

fn record_contribution(
    table: &mut ContributionTable,
    context: String,
    surface: String,
    candidate_key: String,
    scan_budget: &mut ContributionScanBudget,
) -> bool {
    if context.is_empty() || candidate_key.is_empty() {
        return true;
    }
    let needs_entry_allocation = match table
        .get(&context)
        .and_then(|branches| branches.get(&candidate_key))
    {
        Some(branch) => !branch.surfaces.contains_key(&surface),
        None => true,
    };
    if needs_entry_allocation && scan_budget.entry_count >= scan_budget.max_entries {
        scan_budget.overflowed = true;
        return false;
    }
    let branch = table
        .entry(context)
        .or_default()
        .entry(candidate_key)
        .or_default();
    if needs_entry_allocation {
        scan_budget.entry_count += 1;
    }
    branch.count += 1;
    *branch.surfaces.entry(surface).or_default() += 1;
    true
}

fn merge_document(
    inner: &mut CompletionRetrievalWriter,
    path: &str,
    contribution: &DocumentContribution,
    add: bool,
) {
    merge_contribution_table(&mut inner.chinese, &contribution.chinese, path, add);
    merge_contribution_table(&mut inner.english, &contribution.english, path, add);
}

fn add_document_accounting(
    inner: &mut CompletionRetrievalWriter,
    path: &str,
    contribution: &DocumentContribution,
) {
    merge_document(inner, path, contribution, true);
    inner.input_bytes = inner.input_bytes.saturating_add(contribution.input_bytes);
    inner.document_entries = inner
        .document_entries
        .saturating_add(contribution.entry_count);
}

fn remove_document_accounting(
    inner: &mut CompletionRetrievalWriter,
    path: &str,
    contribution: &DocumentContribution,
) {
    merge_document(inner, path, contribution, false);
    inner.input_bytes = inner.input_bytes.saturating_sub(contribution.input_bytes);
    inner.document_entries = inner
        .document_entries
        .saturating_sub(contribution.entry_count);
}

fn reset_workspace(inner: &mut CompletionRetrievalWriter) {
    inner.documents.clear();
    inner.chinese.clear();
    inner.english.clear();
    inner.input_bytes = 0;
    inner.document_entries = 0;
    inner.budget_rejections = 0;
}

fn build_committed_snapshot(writer: &CompletionRetrievalWriter) -> CommittedSnapshot {
    let chinese = writer.chinese.clone();
    let english = writer.english.clone();
    let snapshot_bytes = size_of::<CommittedSnapshot>()
        .saturating_add(writer.active_scope.as_ref().map_or(0, String::len))
        .saturating_add(estimate_aggregate_table_bytes(&chinese))
        .saturating_add(estimate_aggregate_table_bytes(&english));
    let estimated_index_bytes = estimate_writer_bytes(writer).saturating_add(snapshot_bytes);
    CommittedSnapshot {
        active_scope: writer.active_scope.clone(),
        chinese,
        english,
        document_count: writer.documents.len(),
        input_bytes: writer.input_bytes,
        document_entries: writer.document_entries,
        budget_rejections: writer.budget_rejections,
        revision: writer.revision,
        estimated_index_bytes,
    }
}

fn estimate_writer_bytes(writer: &CompletionRetrievalWriter) -> usize {
    let documents = writer
        .documents
        .iter()
        .fold(0usize, |total, (path, contribution)| {
            total
                .saturating_add(size_of::<(String, DocumentContribution)>())
                .saturating_add(path.len())
                .saturating_add(estimate_contribution_table_bytes(&contribution.chinese))
                .saturating_add(estimate_contribution_table_bytes(&contribution.english))
        });
    size_of::<CompletionRetrievalWriter>()
        .saturating_add(writer.active_scope.as_ref().map_or(0, String::len))
        .saturating_add(documents)
        .saturating_add(estimate_aggregate_table_bytes(&writer.chinese))
        .saturating_add(estimate_aggregate_table_bytes(&writer.english))
}

fn estimate_contribution_table_bytes(table: &ContributionTable) -> usize {
    table.iter().fold(0usize, |total, (context, branches)| {
        total
            .saturating_add(size_of::<(String, BTreeMap<String, BranchContribution>)>())
            .saturating_add(context.len())
            .saturating_add(
                branches
                    .iter()
                    .fold(0usize, |branch_total, (candidate, branch)| {
                        branch_total
                            .saturating_add(size_of::<(String, BranchContribution)>())
                            .saturating_add(candidate.len())
                            .saturating_add(branch.surfaces.iter().fold(
                                0usize,
                                |surface_total, (surface, _)| {
                                    surface_total
                                        .saturating_add(size_of::<(String, usize)>())
                                        .saturating_add(surface.len())
                                },
                            ))
                    }),
            )
    })
}

fn estimate_aggregate_table_bytes(table: &AggregateTable) -> usize {
    table.iter().fold(0usize, |total, (context, branches)| {
        total
            .saturating_add(size_of::<(String, BTreeMap<String, AggregateBranch>)>())
            .saturating_add(context.len())
            .saturating_add(
                branches
                    .iter()
                    .fold(0usize, |branch_total, (candidate, branch)| {
                        let document_bytes = branch.document_counts.iter().fold(
                            0usize,
                            |document_total, (path, _)| {
                                document_total
                                    .saturating_add(size_of::<(String, usize)>())
                                    .saturating_add(path.len())
                            },
                        );
                        let surface_bytes = branch.surface_counts.iter().fold(
                            0usize,
                            |surface_total, (surface, _)| {
                                surface_total
                                    .saturating_add(size_of::<(String, usize)>())
                                    .saturating_add(surface.len())
                            },
                        );
                        branch_total
                            .saturating_add(size_of::<(String, AggregateBranch)>())
                            .saturating_add(candidate.len())
                            .saturating_add(document_bytes)
                            .saturating_add(surface_bytes)
                    }),
            )
    })
}

fn merge_contribution_table(
    aggregate: &mut AggregateTable,
    contribution: &ContributionTable,
    path: &str,
    add: bool,
) {
    for (context, contributed_branches) in contribution {
        if add {
            let aggregate_branches = aggregate.entry(context.clone()).or_default();
            for (candidate_key, contributed) in contributed_branches {
                let branch = aggregate_branches.entry(candidate_key.clone()).or_default();
                branch.support += contributed.count;
                branch
                    .document_counts
                    .insert(path.to_string(), contributed.count);
                for (surface, count) in &contributed.surfaces {
                    *branch.surface_counts.entry(surface.clone()).or_default() += count;
                }
            }
            continue;
        }

        let mut remove_context = false;
        if let Some(aggregate_branches) = aggregate.get_mut(context) {
            for (candidate_key, contributed) in contributed_branches {
                let mut remove_branch = false;
                if let Some(branch) = aggregate_branches.get_mut(candidate_key) {
                    branch.support = branch.support.saturating_sub(contributed.count);
                    branch.document_counts.remove(path);
                    for (surface, count) in &contributed.surfaces {
                        let remaining = branch
                            .surface_counts
                            .get(surface)
                            .copied()
                            .unwrap_or_default()
                            .saturating_sub(*count);
                        if remaining == 0 {
                            branch.surface_counts.remove(surface);
                        } else {
                            branch.surface_counts.insert(surface.clone(), remaining);
                        }
                    }
                    remove_branch = branch.support == 0 || branch.document_counts.is_empty();
                }
                if remove_branch {
                    aggregate_branches.remove(candidate_key);
                }
            }
            remove_context = aggregate_branches.is_empty();
        }
        if remove_context {
            aggregate.remove(context);
        }
    }
}

fn query_chinese(
    table: &AggregateTable,
    context_before_cursor: &str,
    limit: usize,
) -> Vec<CompletionRetrievalCandidate> {
    let sentence_tail = tail_after_strong_sentence_mark(context_before_cursor).trim_end();
    let points: Vec<char> = sentence_tail.chars().collect();
    for context_length in (MIN_CHINESE_CONTEXT..=MAX_CHINESE_CONTEXT.min(points.len())).rev() {
        let context = normalize_whitespace(
            &points[points.len() - context_length..]
                .iter()
                .collect::<String>(),
        );
        if !is_valid_chinese_context(&context) {
            continue;
        }
        let candidates = candidates_for_context(table.get(&context), Language::Zh, false, limit);
        if !candidates.is_empty() {
            return candidates;
        }
    }
    Vec::new()
}

fn query_english(
    table: &AggregateTable,
    context_before_cursor: &str,
    limit: usize,
) -> Vec<CompletionRetrievalCandidate> {
    let words = extract_english_tokens(tail_after_strong_sentence_mark(context_before_cursor));
    let normalized_cursor_context: String = context_before_cursor.nfkc().collect();
    let add_leading_space = normalized_cursor_context
        .chars()
        .last()
        .is_some_and(|point| point.is_ascii_alphabetic());
    for context_length in (1..=MAX_ENGLISH_CONTEXT_WORDS.min(words.len())).rev() {
        let context = words[words.len() - context_length..]
            .iter()
            .map(|word| word.normalized.as_str())
            .collect::<Vec<_>>()
            .join(&CONTEXT_SEPARATOR.to_string());
        let candidates =
            candidates_for_context(table.get(&context), Language::En, add_leading_space, limit);
        if !candidates.is_empty() {
            return candidates;
        }
    }
    let ends_with_whitespace = context_before_cursor
        .chars()
        .last()
        .is_some_and(char::is_whitespace);
    if !ends_with_whitespace {
        if let Some((prefix_word, preceding_words)) = words.split_last() {
            if !prefix_word.normalized.is_empty() && !preceding_words.is_empty() {
                for context_length in
                    (1..=MAX_ENGLISH_CONTEXT_WORDS.min(preceding_words.len())).rev()
                {
                    let context = preceding_words[preceding_words.len() - context_length..]
                        .iter()
                        .map(|word| word.normalized.as_str())
                        .collect::<Vec<_>>()
                        .join(&CONTEXT_SEPARATOR.to_string());
                    let candidates = candidates_for_english_prefix(
                        table.get(&context),
                        &prefix_word.normalized,
                        limit,
                    );
                    if !candidates.is_empty() {
                        return candidates;
                    }
                }
            }
        }
    }
    Vec::new()
}

#[derive(Clone, Copy)]
enum Language {
    Zh,
    En,
}

fn candidates_for_context(
    branches: Option<&BTreeMap<String, AggregateBranch>>,
    language: Language,
    add_leading_space: bool,
    limit: usize,
) -> Vec<CompletionRetrievalCandidate> {
    let Some(branches) = branches else {
        return Vec::new();
    };
    let total_support: usize = branches.values().map(|branch| branch.support).sum();
    if total_support == 0 {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    for branch in branches.values() {
        let document_support = branch.document_counts.len();
        if document_support < MIN_DOCUMENT_SUPPORT {
            continue;
        }
        let Some(surface) = select_surface(&branch.surface_counts) else {
            continue;
        };
        let text = if matches!(language, Language::En) && add_leading_space {
            format!(" {surface}")
        } else {
            surface.to_string()
        };
        if !is_candidate_allowed(&text, language) {
            continue;
        }
        let branch_share = branch.support as f64 / total_support as f64;
        let evidence = 1.0 - (-(document_support as f64) / 2.0).exp();
        candidates.push(CompletionRetrievalCandidate {
            text,
            confidence: round_confidence((branch_share * evidence).min(0.99)),
            support: branch.support,
            document_support,
            provider_id: match language {
                Language::Zh => "hybrid-retrieval-zh",
                Language::En => "hybrid-retrieval-en",
            }
            .to_string(),
            source_layer: "notebook".to_string(),
        });
    }
    candidates.sort_by(compare_candidates);
    candidates.truncate(limit);
    candidates
}

fn candidates_for_english_prefix(
    branches: Option<&BTreeMap<String, AggregateBranch>>,
    prefix: &str,
    limit: usize,
) -> Vec<CompletionRetrievalCandidate> {
    let Some(branches) = branches else {
        return Vec::new();
    };
    let total_support: usize = branches.values().map(|branch| branch.support).sum();
    if total_support == 0 {
        return Vec::new();
    }
    let normalized_prefix = normalize_en(prefix);
    let prefix_length = prefix.chars().count();
    let mut candidates = Vec::new();
    for branch in branches.values() {
        let document_support = branch.document_counts.len();
        if document_support < MIN_DOCUMENT_SUPPORT {
            continue;
        }
        let Some(surface) = select_surface(&branch.surface_counts) else {
            continue;
        };
        let words = extract_english_tokens(surface);
        let Some(first) = words.first() else {
            continue;
        };
        if !first.normalized.starts_with(&normalized_prefix) {
            continue;
        }
        let suffix: String = first.text.chars().skip(prefix_length).collect();
        let remaining = words
            .iter()
            .skip(1)
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>();
        let text = if remaining.is_empty() {
            suffix
        } else {
            format!("{suffix} {}", remaining.join(" "))
        };
        if !is_candidate_allowed(&text, Language::En) {
            continue;
        }
        let branch_share = branch.support as f64 / total_support as f64;
        let evidence = 1.0 - (-(document_support as f64) / 2.0).exp();
        candidates.push(CompletionRetrievalCandidate {
            text,
            confidence: round_confidence((branch_share * evidence).min(0.99)),
            support: branch.support,
            document_support,
            provider_id: "hybrid-retrieval-en".to_string(),
            source_layer: "notebook".to_string(),
        });
    }
    candidates.sort_by(compare_candidates);
    candidates.truncate(limit);
    candidates
}

fn compare_candidates(
    left: &CompletionRetrievalCandidate,
    right: &CompletionRetrievalCandidate,
) -> std::cmp::Ordering {
    right
        .confidence
        .total_cmp(&left.confidence)
        .then_with(|| right.document_support.cmp(&left.document_support))
        .then_with(|| right.support.cmp(&left.support))
        .then_with(|| left.text.chars().count().cmp(&right.text.chars().count()))
        .then_with(|| left.text.cmp(&right.text))
}

fn select_surface(surface_counts: &BTreeMap<String, usize>) -> Option<&str> {
    surface_counts
        .iter()
        .max_by(|(left_text, left_count), (right_text, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_text.cmp(left_text))
        })
        .map(|(surface, _)| surface.as_str())
}

#[derive(Debug)]
struct EnglishToken {
    text: String,
    normalized: String,
}

fn extract_english_tokens(text: &str) -> Vec<EnglishToken> {
    let normalized_text: String = text.nfkc().collect();
    let points: Vec<char> = normalized_text.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < points.len() {
        if !points[index].is_ascii_alphabetic() {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < points.len() {
            if points[index].is_ascii_alphabetic() {
                index += 1;
                continue;
            }
            let connector = matches!(points[index], '\'' | '’' | '-' | '‑');
            if connector && index + 1 < points.len() && points[index + 1].is_ascii_alphabetic() {
                index += 2;
                continue;
            }
            break;
        }
        let surface: String = points[start..index].iter().collect();
        tokens.push(EnglishToken {
            normalized: normalize_en(&surface),
            text: surface,
        });
    }
    tokens
}

fn longest_allowed_english_candidate(words: &[EnglishToken]) -> &[EnglishToken] {
    for length in (1..=MAX_ENGLISH_CANDIDATE_WORDS.min(words.len())).rev() {
        let surface = words[..length]
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if is_candidate_allowed(&surface, Language::En)
            && is_candidate_allowed(&format!(" {surface}"), Language::En)
        {
            return &words[..length];
        }
    }
    &[]
}

fn take_chinese_continuation(points: &[char], boundary: usize) -> String {
    let tail = &points[boundary..(boundary + MAX_CANDIDATE_CODE_POINTS).min(points.len())];
    let length = tail
        .iter()
        .position(|point| is_strong_sentence_mark(*point))
        .map_or(tail.len(), |index| index + 1);
    tail[..length].iter().collect::<String>().trim().to_string()
}

fn is_candidate_allowed(candidate: &str, language: Language) -> bool {
    let normalized: String = candidate.nfkc().collect();
    let trimmed = normalized.trim();
    let length = normalized.chars().count();
    if trimmed.is_empty() || !(1..=MAX_CANDIDATE_CODE_POINTS).contains(&length) {
        return false;
    }
    let has_han = normalized.chars().any(is_han);
    let has_latin = normalized.chars().any(|point| point.is_ascii_alphabetic());
    if has_han && has_latin {
        return false;
    }
    match language {
        Language::Zh => !has_latin,
        Language::En => {
            !has_han
                && (1..=MAX_ENGLISH_CANDIDATE_WORDS)
                    .contains(&extract_english_tokens(&normalized).len())
        }
    }
}

fn extract_prose_lines(content: &str) -> Vec<String> {
    let lines: Vec<&str> = content
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    let mut excluded = vec![false; lines.len()];
    mark_frontmatter(&lines, &mut excluded);
    mark_fenced_code(&lines, &mut excluded);
    let structural = excluded.clone();
    for (index, line) in lines.iter().enumerate() {
        if structural[index] {
            continue;
        }
        if is_atx_heading(line) || is_thematic_break(line) || is_table_like_line(line) {
            excluded[index] = true;
        }
    }
    for index in 1..lines.len() {
        if structural[index] {
            continue;
        }
        if is_setext_underline(lines[index]) {
            excluded[index] = true;
            if !structural[index - 1] && !lines[index - 1].trim().is_empty() {
                excluded[index - 1] = true;
            }
        }
        if is_table_delimiter(lines[index]) {
            excluded[index] = true;
            if !structural[index - 1] && has_table_cells(lines[index - 1]) {
                excluded[index - 1] = true;
            }
            let mut body = index + 1;
            while body < lines.len() && !structural[body] && has_table_cells(lines[body]) {
                excluded[body] = true;
                body += 1;
            }
        }
    }
    lines
        .iter()
        .enumerate()
        .filter(|(index, _)| !excluded[*index])
        .filter_map(|(_, line)| clean_prose_line(line))
        .collect()
}

fn mark_frontmatter(lines: &[&str], excluded: &mut [bool]) {
    let first = lines
        .first()
        .copied()
        .unwrap_or_default()
        .trim_start_matches('\u{feff}');
    if first.trim() != "---" {
        return;
    }
    for (index, line) in lines.iter().enumerate() {
        excluded[index] = true;
        if index > 0 && line.trim() == "---" {
            return;
        }
    }
}

fn mark_fenced_code(lines: &[&str], excluded: &mut [bool]) {
    let mut fence: Option<(char, usize)> = None;
    for (index, line) in lines.iter().enumerate() {
        if excluded[index] {
            continue;
        }
        if let Some((marker, length)) = fence {
            excluded[index] = true;
            if is_fence_closer(line, marker, length) {
                fence = None;
            }
        } else if let Some(opener) = parse_fence_opener(line) {
            excluded[index] = true;
            fence = Some(opener);
        }
    }
}

fn parse_fence_opener(line: &str) -> Option<(char, usize)> {
    let line = strip_up_to_three_spaces(line)?;
    let marker = line.chars().next()?;
    if !matches!(marker, '`' | '~') {
        return None;
    }
    let length = line.chars().take_while(|point| *point == marker).count();
    if length < 3 {
        return None;
    }
    let rest: String = line.chars().skip(length).collect();
    if marker == '`' && rest.contains('`') {
        return None;
    }
    Some((marker, length))
}

fn is_fence_closer(line: &str, marker: char, minimum_length: usize) -> bool {
    let Some(line) = strip_up_to_three_spaces(line) else {
        return false;
    };
    let length = line.chars().take_while(|point| *point == marker).count();
    length >= minimum_length && line.chars().skip(length).all(char::is_whitespace)
}

fn strip_up_to_three_spaces(line: &str) -> Option<&str> {
    let spaces = line.chars().take_while(|point| *point == ' ').count();
    (spaces <= 3).then(|| &line[spaces..])
}

fn is_atx_heading(line: &str) -> bool {
    let Some(line) = strip_up_to_three_spaces(line) else {
        return false;
    };
    let hashes = line.chars().take_while(|point| *point == '#').count();
    (1..=6).contains(&hashes) && line.chars().nth(hashes).map_or(true, char::is_whitespace)
}

fn is_setext_underline(line: &str) -> bool {
    let Some(line) = strip_up_to_three_spaces(line) else {
        return false;
    };
    let trimmed = line.trim_end();
    !trimmed.is_empty()
        && (trimmed.chars().all(|point| point == '=') || trimmed.chars().all(|point| point == '-'))
}

fn is_thematic_break(line: &str) -> bool {
    let Some(line) = strip_up_to_three_spaces(line) else {
        return false;
    };
    for marker in ['*', '_', '-'] {
        let marks = line.chars().filter(|point| *point == marker).count();
        if marks >= 3
            && line
                .chars()
                .all(|point| point == marker || point == ' ' || point == '\t')
        {
            return true;
        }
    }
    false
}

fn is_table_like_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('|') && trimmed[1..].contains('|')
}

fn is_table_delimiter(line: &str) -> bool {
    let trimmed = line.trim().trim_matches('|');
    let cells: Vec<&str> = trimmed.split('|').collect();
    cells.len() >= 2
        && cells.iter().all(|cell| {
            let value = cell.trim().trim_matches(':');
            value.len() >= 3 && value.chars().all(|point| point == '-')
        })
}

fn has_table_cells(line: &str) -> bool {
    let mut escaped = false;
    for point in line.chars() {
        if point == '|' && !escaped {
            return true;
        }
        escaped = point == '\\' && !escaped;
        if point != '\\' {
            escaped = false;
        }
    }
    false
}

fn clean_prose_line(line: &str) -> Option<String> {
    let mut value = strip_up_to_three_spaces(line)?.trim_start();
    while let Some(rest) = value.strip_prefix('>') {
        value = rest.trim_start();
    }
    if let Some(rest) = strip_list_marker(value) {
        value = rest.trim_start();
    }
    if value.len() >= 3 && value.starts_with('[') && value.as_bytes()[2] == b']' {
        let marker = value.as_bytes()[1];
        if matches!(marker, b' ' | b'x' | b'X') {
            value = value[3..].trim_start();
        }
    }
    let cleaned = value.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

fn strip_list_marker(line: &str) -> Option<&str> {
    let mut chars = line.char_indices();
    let (_, first) = chars.next()?;
    if matches!(first, '-' | '+' | '*') {
        let (offset, next) = chars.next()?;
        return next.is_whitespace().then(|| &line[offset..]);
    }
    if first.is_ascii_digit() {
        let mut punctuation_end = None;
        for (offset, point) in chars.take(9) {
            if matches!(point, '.' | ')' | '、' | '．') {
                punctuation_end = Some(offset + point.len_utf8());
                break;
            }
            if !point.is_ascii_digit() {
                break;
            }
        }
        if let Some(end) = punctuation_end {
            let rest = &line[end..];
            return rest
                .chars()
                .next()
                .is_some_and(char::is_whitespace)
                .then_some(rest);
        }
    }
    None
}

fn resolve_language_hint(
    hint: CompletionRetrievalLanguageHint,
    context_before_cursor: &str,
) -> CompletionRetrievalLanguageHint {
    if hint != CompletionRetrievalLanguageHint::Unknown {
        return hint;
    }
    let tail = tail_after_strong_sentence_mark(context_before_cursor);
    let tail: String = tail
        .chars()
        .rev()
        .take(96)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let normalized_tail: String = tail.nfkc().collect();
    let has_han = normalized_tail.chars().any(is_han);
    let has_latin = normalized_tail
        .chars()
        .any(|point| point.is_ascii_alphabetic());
    match (has_han, has_latin) {
        (true, true) => CompletionRetrievalLanguageHint::Mixed,
        (true, false) => CompletionRetrievalLanguageHint::Zh,
        (false, true) => CompletionRetrievalLanguageHint::En,
        (false, false) => CompletionRetrievalLanguageHint::Unknown,
    }
}

fn tail_after_strong_sentence_mark(text: &str) -> &str {
    text.char_indices()
        .rfind(|(_, point)| is_strong_sentence_mark(*point))
        .map_or(text, |(index, point)| &text[index + point.len_utf8()..])
}

fn is_valid_chinese_context(context: &str) -> bool {
    !context.is_empty()
        && !context.chars().any(is_strong_sentence_mark)
        && context.chars().filter(|point| is_han(*point)).count() >= MIN_CHINESE_CONTEXT
}

fn is_strong_sentence_mark(point: char) -> bool {
    matches!(point, '。' | '！' | '？' | '!' | '?' | '；' | ';')
}

fn is_sentence_separator(point: char) -> bool {
    is_strong_sentence_mark(point) || matches!(point, '.' | ':' | '：')
}

fn is_han(point: char) -> bool {
    matches!(
        point as u32,
        0x3400..=0x4dbf
            | 0x4e00..=0x9fff
            | 0xf900..=0xfaff
            | 0x20000..=0x2ebef
            | 0x30000..=0x323af
    )
}

fn normalize_whitespace(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_zh(value: &str) -> String {
    normalize_whitespace(value).trim().to_string()
}

fn normalize_en(value: &str) -> String {
    normalize_whitespace(value)
        .replace('’', "'")
        .to_ascii_lowercase()
}

fn normalize_scope(value: &str) -> Result<String, String> {
    let scope = value.trim();
    if scope.is_empty() {
        Err("workspaceScope must not be empty".to_string())
    } else {
        Ok(scope.to_string())
    }
}

fn normalize_path(value: &str) -> Result<String, String> {
    let mut path = value.trim().replace('\\', "/");
    while path.contains("//") {
        path = path.replace("//", "/");
    }
    if let Some(stripped) = path.strip_prefix("./") {
        path = stripped.to_string();
    }
    if path.is_empty() {
        Err("path must not be empty".to_string())
    } else {
        Ok(path)
    }
}

fn ensure_active_scope(active_scope: Option<&str>, requested: &str) -> Result<(), String> {
    match active_scope {
        Some(active) if active == requested => Ok(()),
        Some(_) => Err("workspaceScope does not match the active completion scope".to_string()),
        None => Err("completion scope has not been initialized".to_string()),
    }
}

fn fingerprint(content: &str) -> ContentFingerprint {
    let mut primary = 0xcbf2_9ce4_8422_2325_u64;
    let mut secondary = 0x9e37_79b9_7f4a_7c15_u64;
    for byte in content.as_bytes() {
        primary ^= u64::from(*byte);
        primary = primary.wrapping_mul(0x0000_0100_0000_01b3);
        secondary ^= u64::from(*byte).wrapping_add(0x9e37_79b9);
        secondary = secondary.rotate_left(7).wrapping_mul(0x94d0_49bb_1331_11eb);
    }
    ContentFingerprint { primary, secondary }
}

fn round_confidence(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::Value;
    use std::sync::mpsc;
    use std::thread;

    #[derive(Debug, Deserialize)]
    struct GoldenFile {
        schema: String,
        scenarios: Vec<GoldenScenario>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenScenario {
        id: String,
        workspace_scope: String,
        budget: Option<CompletionRetrievalBudget>,
        batches: Vec<GoldenBatch>,
        expected_diagnostics: GoldenDiagnostics,
    }

    #[derive(Debug, Deserialize)]
    struct GoldenBatch {
        mutations: Vec<CompletionBatchMutation>,
        expected: GoldenMutationResponse,
        queries: Vec<GoldenQuery>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenMutationResponse {
        changed: bool,
        document_count: usize,
        revision: usize,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenQuery {
        context_before_cursor: String,
        language_hint: CompletionRetrievalLanguageHint,
        expected_candidates: Value,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenDiagnostics {
        document_count: usize,
        input_bytes: usize,
        document_entries: usize,
        budget_rejections: usize,
        committed_revision: usize,
    }

    fn state(scope: &str) -> CompletionRetrievalState {
        let state = CompletionRetrievalState::default();
        state
            .set_scope(CompletionSetScopeRequest {
                workspace_scope: scope.to_string(),
            })
            .expect("scope should initialize");
        state
    }

    fn state_with_budget(
        scope: &str,
        budget: CompletionRetrievalBudget,
    ) -> CompletionRetrievalState {
        let state = CompletionRetrievalState::with_budget(budget);
        state
            .set_scope(CompletionSetScopeRequest {
                workspace_scope: scope.to_string(),
            })
            .expect("scope should initialize");
        state
    }

    fn replace(state: &CompletionRetrievalState, scope: &str, path: &str, content: &str) -> bool {
        state
            .replace_document(CompletionReplaceRequest {
                workspace_scope: scope.to_string(),
                path: path.to_string(),
                content: content.to_string(),
            })
            .expect("replace should succeed")
            .changed
    }

    fn query(
        state: &CompletionRetrievalState,
        scope: &str,
        context: &str,
        language_hint: CompletionRetrievalLanguageHint,
    ) -> Vec<CompletionRetrievalCandidate> {
        state
            .query(CompletionQueryRequest {
                workspace_scope: scope.to_string(),
                context_before_cursor: context.to_string(),
                language_hint,
                max_candidates: 8,
            })
            .expect("query should succeed")
            .candidates
    }

    #[test]
    fn completion_retrieval_is_idempotent_and_retracts_edits_and_deletes() {
        let state = state("scope");
        let repeated = "项目计划需要复核风险。\n项目计划需要复核风险。";
        assert!(replace(&state, "scope", "/a.md", repeated));
        assert!(replace(&state, "scope", "/b.md", "项目计划需要复核风险。"));
        let before = query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh,
        );
        assert_eq!(before[0].support, 3);
        assert_eq!(before[0].document_support, 2);
        assert!(!replace(&state, "scope", "/a.md", repeated));
        assert_eq!(
            query(
                &state,
                "scope",
                "项目计划",
                CompletionRetrievalLanguageHint::Zh,
            )[0]
            .support,
            3
        );

        replace(&state, "scope", "/b.md", "项目计划可以稍后处理。");
        assert!(query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh
        )
        .is_empty());
        replace(&state, "scope", "/b.md", "项目计划需要复核风险。");
        state
            .remove_document(CompletionRemoveRequest {
                workspace_scope: "scope".to_string(),
                path: "/a.md".to_string(),
            })
            .expect("remove should succeed");
        assert!(query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh
        )
        .is_empty());
    }

    #[test]
    fn completion_retrieval_rename_does_not_duplicate_counts() {
        let state = state("scope");
        replace(&state, "scope", "/a.md", "项目计划需要确认。");
        replace(&state, "scope", "/b.md", "项目计划需要确认。");
        state
            .rename_document(CompletionRenameRequest {
                workspace_scope: "scope".to_string(),
                old_path: "/a.md".to_string(),
                new_path: "/renamed.md".to_string(),
            })
            .expect("rename should succeed");
        let candidate = query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh,
        );
        assert_eq!(candidate[0].support, 2);
        assert_eq!(candidate[0].document_support, 2);
    }

    #[test]
    fn completion_retrieval_switches_one_active_scope_and_rejects_stale_writes() {
        let state = state("workspace-a");
        for path in ["/a.md", "/b.md"] {
            replace(&state, "workspace-a", path, "项目计划需要确认。");
        }
        assert_eq!(
            query(
                &state,
                "workspace-a",
                "项目计划",
                CompletionRetrievalLanguageHint::Zh,
            )
            .len(),
            1
        );
        state
            .set_scope(CompletionSetScopeRequest {
                workspace_scope: "workspace-b".to_string(),
            })
            .expect("scope should switch");
        assert!(state
            .replace_document(CompletionReplaceRequest {
                workspace_scope: "workspace-a".to_string(),
                path: "/late.md".to_string(),
                content: "项目计划需要确认。".to_string(),
            })
            .is_err());
        assert!(query(
            &state,
            "workspace-b",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh
        )
        .is_empty());
        for path in ["/a.md", "/b.md"] {
            replace(&state, "workspace-b", path, "项目计划需要确认。");
        }
        assert!(
            state
                .clear(CompletionClearRequest {
                    workspace_scope: "workspace-b".to_string(),
                })
                .expect("clear should succeed")
                .changed
        );
        assert!(query(
            &state,
            "workspace-b",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh
        )
        .is_empty());
    }

    #[test]
    fn completion_retrieval_indexes_only_markdown_prose() {
        let state = state("scope");
        let blocked = [
            "---",
            "title: 项目计划需要泄漏",
            "---",
            "# 项目计划需要泄漏",
            "   ```md",
            "项目计划需要泄漏",
            "   ```",
            "| 项目计划 | 需要泄漏 |",
            "| --- | --- |",
        ]
        .join("\r\n");
        replace(&state, "scope", "/a.md", &blocked);
        replace(
            &state,
            "scope",
            "/b.md",
            &blocked.replace("title:", "name:"),
        );
        assert!(query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh
        )
        .is_empty());

        replace(&state, "scope", "/a.md", "- 项目计划需要保留。");
        replace(&state, "scope", "/b.md", "> 项目计划需要保留。");
        assert_eq!(
            query(
                &state,
                "scope",
                "项目计划",
                CompletionRetrievalLanguageHint::Zh,
            )[0]
            .text,
            "需要保留。"
        );
    }

    #[test]
    fn completion_retrieval_preserves_unicode_caps_results_and_drops_mixed_text() {
        let state = state("scope");
        let content = format!("项目计划🙂{}。", "继续推进".repeat(10));
        replace(&state, "scope", "/a.md", &content);
        replace(&state, "scope", "/b.md", &content);
        let candidate = query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh,
        );
        assert!(candidate[0].text.starts_with('🙂'));
        assert_eq!(candidate[0].text.chars().count(), 24);
        assert_eq!(candidate[0].provider_id, "hybrid-retrieval-zh");

        replace(&state, "scope", "/a.md", "项目计划API评审。");
        replace(&state, "scope", "/b.md", "项目计划API评审。");
        assert!(query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh
        )
        .is_empty());
        assert!(query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Mixed
        )
        .is_empty());
    }

    #[test]
    fn completion_retrieval_uses_longest_english_context_and_three_word_output() {
        let state = state("scope");
        for path in ["/a.md", "/b.md"] {
            replace(
                &state,
                "scope",
                path,
                "Project plan reviews the current risks.",
            );
        }
        let at_boundary = query(
            &state,
            "scope",
            "Project plan ",
            CompletionRetrievalLanguageHint::En,
        );
        assert_eq!(at_boundary[0].text, "reviews the current");
        assert_eq!(at_boundary[0].document_support, 2);
        assert_eq!(at_boundary[0].provider_id, "hybrid-retrieval-en");
        let after_word = query(
            &state,
            "scope",
            "Project plan",
            CompletionRetrievalLanguageHint::Unknown,
        );
        assert_eq!(after_word[0].text, " reviews the current");
        assert!(after_word.len() <= MAX_QUERY_CANDIDATES);
    }

    #[test]
    fn completion_retrieval_completes_an_unfinished_english_word() {
        let state = state("scope");
        for path in ["/a.md", "/b.md"] {
            replace(
                &state,
                "scope",
                path,
                "Project planning reviews the current risks.",
            );
        }
        let candidates = query(
            &state,
            "scope",
            "Project plan",
            CompletionRetrievalLanguageHint::En,
        );
        assert_eq!(candidates[0].text, "ning reviews the");
        assert_eq!(candidates[0].provider_id, "hybrid-retrieval-en");
        assert_eq!(candidates[0].document_support, 2);
    }

    #[test]
    fn completion_retrieval_nfkc_matches_fullwidth_and_compatibility_forms() {
        let state = state("nfkc");
        let fullwidth =
            "Ｐｒｏｊｅｃｔ　ｐｌａｎｎｉｎｇ　ｒｅｖｉｅｗｓ　ｔｈｅ　ｃｕｒｒｅｎｔ　ｒｉｓｋｓ．";
        for path in ["/a.md", "/b.md"] {
            replace(&state, "nfkc", path, fullwidth);
        }
        let ascii_query = query(
            &state,
            "nfkc",
            "Project plan",
            CompletionRetrievalLanguageHint::En,
        );
        assert_eq!(ascii_query[0].text, "ning reviews the");

        for path in ["/a.md", "/b.md"] {
            replace(
                &state,
                "nfkc",
                path,
                "Project planning reviews the current risks.",
            );
        }
        let fullwidth_query = query(
            &state,
            "nfkc",
            "Ｐｒｏｊｅｃｔ ｐｌａｎ",
            CompletionRetrievalLanguageHint::En,
        );
        assert_eq!(fullwidth_query[0].text, "ning reviews the");

        for path in ["/a.md", "/b.md"] {
            replace(&state, "nfkc", path, "Oﬃce plan reviews the current risks.");
        }
        let compatibility_query = query(
            &state,
            "nfkc",
            "Office plan ",
            CompletionRetrievalLanguageHint::En,
        );
        assert_eq!(compatibility_query[0].text, "reviews the current");

        for path in ["/a.md", "/b.md"] {
            replace(&state, "nfkc", path, "项目计划ＡＰＩ评审。");
        }
        assert!(query(
            &state,
            "nfkc",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh,
        )
        .is_empty());
        assert!(query(
            &state,
            "nfkc",
            "项目计划ＡＰＩ",
            CompletionRetrievalLanguageHint::Unknown,
        )
        .is_empty());
    }

    #[test]
    fn completion_retrieval_candidate_dto_matches_the_camel_case_protocol() {
        let value = serde_json::to_value(CompletionRetrievalCandidate {
            text: "需要确认。".to_string(),
            confidence: 0.75,
            support: 2,
            document_support: 2,
            provider_id: "hybrid-retrieval-zh".to_string(),
            source_layer: "notebook".to_string(),
        })
        .expect("candidate should serialize");
        assert_eq!(value["documentSupport"], 2);
        assert_eq!(value["providerId"], "hybrid-retrieval-zh");
        assert_eq!(value["sourceLayer"], "notebook");
        assert!(value.get("syntaxType").is_none());

        let reset: CompletionBatchMutation = serde_json::from_value(serde_json::json!({
            "operation": "reset",
            "workspaceScope": "ignored-by-batch-item"
        }))
        .expect("reset alias should deserialize");
        assert!(matches!(reset, CompletionBatchMutation::Clear));
    }

    #[test]
    fn completion_retrieval_enforces_hard_budgets_and_preserves_old_contributions() {
        let budget = CompletionRetrievalBudget {
            max_documents: 2,
            max_document_input_bytes: 4 * 1024,
            max_total_input_bytes: 8 * 1024,
            max_document_entries: 40,
            max_total_document_entries: 100,
        };
        let state = state_with_budget("scope", budget);
        let old_content = "项目计划需要确认。";
        replace(&state, "scope", "/a.md", old_content);
        replace(&state, "scope", "/b.md", old_content);
        let before = state.diagnostics("scope").expect("diagnostics should load");
        assert_eq!(before.document_count, 2);
        assert_eq!(before.fingerprint_count, 2);
        assert_eq!(before.input_bytes, old_content.len() * 2);
        assert_eq!(before.retained_content_bytes, 0);
        assert!(before.document_entries > 0);
        assert_eq!(before.budget, budget);

        assert!(!replace(&state, "scope", "/c.md", "项目计划需要额外确认。"));
        let oversized_edit = format!(
            "项目计划{}",
            (0..100)
                .filter_map(|offset| char::from_u32(0x4e00 + offset))
                .collect::<String>()
        );
        assert!(!replace(&state, "scope", "/a.md", &oversized_edit));

        let candidate = query(
            &state,
            "scope",
            "项目计划",
            CompletionRetrievalLanguageHint::Zh,
        );
        assert_eq!(candidate[0].text, "需要确认。");
        assert_eq!(candidate[0].document_support, 2);
        let after = state.diagnostics("scope").expect("diagnostics should load");
        assert_eq!(after.input_bytes, before.input_bytes);
        assert_eq!(after.document_entries, before.document_entries);
        assert_eq!(after.budget_rejections, 2);
    }

    #[test]
    fn completion_retrieval_counts_new_surface_variants_against_the_entry_budget() {
        let state = state_with_budget(
            "surface-budget",
            CompletionRetrievalBudget {
                max_document_entries: 1,
                max_total_document_entries: 10,
                ..CompletionRetrievalBudget::default()
            },
        );
        assert!(!replace(
            &state,
            "surface-budget",
            "/variants.md",
            "one Two\none two"
        ));
        let diagnostics = state
            .diagnostics("surface-budget")
            .expect("diagnostics should load");
        assert_eq!(diagnostics.document_count, 0);
        assert_eq!(diagnostics.document_entries, 0);
        assert_eq!(diagnostics.budget_rejections, 1);
    }

    #[test]
    fn completion_retrieval_reports_committed_revision_and_warming_state() {
        let state = state("revision-scope");
        let first = state
            .replace_document(CompletionReplaceRequest {
                workspace_scope: "revision-scope".to_string(),
                path: "/a.md".to_string(),
                content: "Project plan needs review.".to_string(),
            })
            .expect("first revision should commit");
        assert_eq!(first.revision, 1);

        let unchanged = state
            .replace_document(CompletionReplaceRequest {
                workspace_scope: "revision-scope".to_string(),
                path: "/a.md".to_string(),
                content: "Project plan needs review.".to_string(),
            })
            .expect("idempotent replace should succeed");
        assert_eq!(unchanged.revision, 2);

        state.pending_mutations.store(3, Ordering::Release);
        let response = state
            .query(CompletionQueryRequest {
                workspace_scope: "revision-scope".to_string(),
                context_before_cursor: "Project plan ".to_string(),
                language_hint: CompletionRetrievalLanguageHint::En,
                max_candidates: 8,
            })
            .expect("query should read committed snapshot");
        state.pending_mutations.store(0, Ordering::Release);
        assert_eq!(response.committed_revision, unchanged.revision);
        assert_eq!(response.pending_mutations, 3);
        assert!(response.warming);

        let value = serde_json::to_value(response).expect("query response should serialize");
        assert_eq!(value["committedRevision"], unchanged.revision);
        assert_eq!(value["pendingMutations"], 3);
        assert_eq!(value["warming"], true);
    }

    #[test]
    fn completion_retrieval_batch_commits_once_and_never_exposes_partial_state() {
        let state = state("atomic-scope");
        let initial = state
            .apply_batch(CompletionBatchRequest {
                workspace_scope: "atomic-scope".to_string(),
                mutations: ["/a.md", "/b.md"]
                    .into_iter()
                    .map(|path| CompletionBatchMutation::Replace {
                        path: path.to_string(),
                        content: "项目计划需要确认风险。".to_string(),
                    })
                    .collect(),
            })
            .expect("initial batch should commit");
        assert_eq!(initial.revision, 1);

        let prepared = ["/a.md", "/b.md"]
            .into_iter()
            .map(|path| {
                state
                    .prepare_mutation(CompletionBatchMutation::Replace {
                        path: path.to_string(),
                        content: "项目计划已经完成复核。".to_string(),
                    })
                    .expect("replacement should prepare")
            })
            .collect::<Vec<_>>();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let commit_state = state.clone();
        let handle = thread::spawn(move || {
            commit_state
                .commit_prepared_batch("atomic-scope", prepared, || {
                    ready_tx.send(()).expect("test should observe commit gate");
                    release_rx.recv().expect("test should release publication");
                })
                .expect("batch should publish")
        });
        ready_rx
            .recv()
            .expect("commit should reach publication gate");

        for _ in 0..32 {
            let during = state
                .query(CompletionQueryRequest {
                    workspace_scope: "atomic-scope".to_string(),
                    context_before_cursor: "项目计划".to_string(),
                    language_hint: CompletionRetrievalLanguageHint::Zh,
                    max_candidates: 8,
                })
                .expect("query should read the old Arc while writer is committing");
            assert_eq!(during.committed_revision, 1);
            assert_eq!(during.candidates[0].text, "需要确认风险。");
        }

        release_tx.send(()).expect("publication should resume");
        let committed = handle.join().expect("commit thread should finish");
        assert_eq!(committed.revision, 2);
        let after = state
            .query(CompletionQueryRequest {
                workspace_scope: "atomic-scope".to_string(),
                context_before_cursor: "项目计划".to_string(),
                language_hint: CompletionRetrievalLanguageHint::Zh,
                max_candidates: 8,
            })
            .expect("query should read the new Arc after publication");
        assert_eq!(after.committed_revision, 2);
        assert_eq!(after.candidates[0].text, "已经完成复核。");
    }

    #[test]
    fn completion_retrieval_query_reads_old_snapshot_during_contribution_preparation() {
        let state = state("build-scope");
        for path in ["/a.md", "/b.md"] {
            replace(&state, "build-scope", path, "项目计划需要确认风险。");
        }
        let old_revision = state
            .query(CompletionQueryRequest {
                workspace_scope: "build-scope".to_string(),
                context_before_cursor: "项目计划".to_string(),
                language_hint: CompletionRetrievalLanguageHint::Zh,
                max_candidates: 8,
            })
            .expect("initial query should work")
            .committed_revision;
        let (ready_tx, ready_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let build_state = state.clone();
        let handle = thread::spawn(move || {
            build_state
                .apply_batch_with_preparation_hook(
                    CompletionBatchRequest {
                        workspace_scope: "build-scope".to_string(),
                        mutations: ["/a.md", "/b.md"]
                            .into_iter()
                            .map(|path| CompletionBatchMutation::Replace {
                                path: path.to_string(),
                                content: format!("项目计划{}。", "继续深入复核".repeat(200)),
                            })
                            .collect(),
                    },
                    || {
                        ready_tx.send(()).expect("build gate should be visible");
                        release_rx.recv().expect("build gate should be released");
                    },
                )
                .expect("contribution batch should commit")
        });
        ready_rx
            .recv()
            .expect("preparation should reach build gate");
        let started = Instant::now();
        let during = state
            .query(CompletionQueryRequest {
                workspace_scope: "build-scope".to_string(),
                context_before_cursor: "项目计划".to_string(),
                language_hint: CompletionRetrievalLanguageHint::Zh,
                max_candidates: 8,
            })
            .expect("query should not wait for preparation");
        assert!(started.elapsed() < Duration::from_millis(50));
        assert_eq!(during.committed_revision, old_revision);
        assert_eq!(during.pending_mutations, 2);
        assert!(during.warming);
        assert_eq!(during.candidates[0].text, "需要确认风险。");
        release_tx.send(()).expect("preparation should resume");
        let committed = handle.join().expect("preparation thread should finish");
        assert_eq!(committed.revision, old_revision + 1);
        let diagnostics = state
            .diagnostics("build-scope")
            .expect("diagnostics should settle");
        assert_eq!(diagnostics.pending_mutations, 0);
        assert_eq!(diagnostics.pending_mutation_batches, 0);
    }

    #[test]
    fn completion_retrieval_batch_enforces_operation_and_input_limits() {
        let state = state("limits");
        let too_many = CompletionBatchRequest {
            workspace_scope: "limits".to_string(),
            mutations: (0..=MAX_BATCH_MUTATIONS)
                .map(|index| CompletionBatchMutation::Remove {
                    path: format!("/{index}.md"),
                })
                .collect(),
        };
        assert!(state.apply_batch(too_many).is_err());
        let too_large = CompletionBatchRequest {
            workspace_scope: "limits".to_string(),
            mutations: vec![CompletionBatchMutation::Replace {
                path: "/large.md".to_string(),
                content: "x".repeat(MAX_BATCH_INPUT_BYTES + 1),
            }],
        };
        assert!(state.apply_batch(too_large).is_err());
        let too_large_paths = CompletionBatchRequest {
            workspace_scope: "limits".to_string(),
            mutations: vec![CompletionBatchMutation::Rename {
                old_path: "a".repeat(MAX_BATCH_INPUT_BYTES / 2 + 1),
                new_path: "b".repeat(MAX_BATCH_INPUT_BYTES / 2 + 1),
            }],
        };
        assert!(state.apply_batch(too_large_paths).is_err());
        let diagnostics = state
            .diagnostics("limits")
            .expect("diagnostics should work");
        assert_eq!(diagnostics.committed_revision, 0);
        assert_eq!(diagnostics.pending_mutations, 0);
        assert_eq!(diagnostics.pending_mutation_batches, 0);
    }

    #[test]
    fn completion_retrieval_matches_shared_web_rust_golden_fixture() {
        let fixture: GoldenFile =
            serde_json::from_str(include_str!("../fixtures/completion-retrieval-golden.json"))
                .expect("golden fixture should parse");
        assert_eq!(fixture.schema, "completion-retrieval-golden-v1");
        for scenario in fixture.scenarios {
            let state = scenario.budget.map_or_else(
                CompletionRetrievalState::default,
                CompletionRetrievalState::with_budget,
            );
            let scoped = state
                .set_scope(CompletionSetScopeRequest {
                    workspace_scope: scenario.workspace_scope.clone(),
                })
                .unwrap_or_else(|error| panic!("{} scope failed: {error}", scenario.id));
            assert_eq!(scoped.revision, 0, "{} scope revision", scenario.id);

            for batch in scenario.batches {
                let response = state
                    .apply_batch(CompletionBatchRequest {
                        workspace_scope: scenario.workspace_scope.clone(),
                        mutations: batch.mutations,
                    })
                    .unwrap_or_else(|error| panic!("{} batch failed: {error}", scenario.id));
                assert_eq!(response.operation, "batch", "{} operation", scenario.id);
                assert_eq!(
                    response.changed, batch.expected.changed,
                    "{} changed",
                    scenario.id
                );
                assert_eq!(
                    response.document_count, batch.expected.document_count,
                    "{} document count",
                    scenario.id
                );
                assert_eq!(
                    response.revision, batch.expected.revision,
                    "{} revision",
                    scenario.id
                );
                for query in batch.queries {
                    let response = state
                        .query(CompletionQueryRequest {
                            workspace_scope: scenario.workspace_scope.clone(),
                            context_before_cursor: query.context_before_cursor,
                            language_hint: query.language_hint,
                            max_candidates: 8,
                        })
                        .unwrap_or_else(|error| panic!("{} query failed: {error}", scenario.id));
                    assert_eq!(response.committed_revision, batch.expected.revision);
                    assert_eq!(
                        serde_json::to_value(response.candidates)
                            .expect("candidates should serialize"),
                        query.expected_candidates,
                        "{} candidates",
                        scenario.id
                    );
                }
            }
            let diagnostics = state
                .diagnostics(&scenario.workspace_scope)
                .unwrap_or_else(|error| panic!("{} diagnostics failed: {error}", scenario.id));
            assert_eq!(
                diagnostics.document_count,
                scenario.expected_diagnostics.document_count
            );
            assert_eq!(
                diagnostics.input_bytes,
                scenario.expected_diagnostics.input_bytes
            );
            assert_eq!(
                diagnostics.document_entries,
                scenario.expected_diagnostics.document_entries
            );
            assert_eq!(
                diagnostics.budget_rejections,
                scenario.expected_diagnostics.budget_rejections
            );
            assert_eq!(
                diagnostics.committed_revision,
                scenario.expected_diagnostics.committed_revision
            );
            assert!(diagnostics.estimated_index_bytes >= size_of::<CommittedSnapshot>());
            assert_eq!(diagnostics.pending_mutations, 0);
            assert_eq!(diagnostics.pending_mutation_batches, 0);
        }
    }
}
