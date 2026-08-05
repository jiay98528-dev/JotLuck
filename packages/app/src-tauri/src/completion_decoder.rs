use crate::completion_decoder_runtime::{DecoderParityTrace, DecoderRuntime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

const ENGINE_ID: &str = "public-v2-free-decoder-v1";
const MANIFEST_SCHEMA: &str = "jotluck.autocomplete.public-free-decoder.v1";
const WORKER_ARGUMENT: &str = "--jotluck-completion-worker";
const PARITY_ARGUMENT: &str = "--jotluck-completion-parity";
const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 128 * 1024;
const STATIC_LIMIT_BYTES: u64 = 24 * 1024 * 1024;
const PEAK_MEMORY_LIMIT_BYTES: usize = 192 * 1024 * 1024;
const TRAINING_POOL_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
const WARMUP_TIMEOUT: Duration = Duration::from_secs(10);
const ACTOR_POLL_INTERVAL: Duration = Duration::from_millis(2);
const RESPONSE_GRACE: Duration = Duration::from_millis(5);
const MODEL_MAGIC: &[u8; 8] = b"JLFDQ02\0";
const MAX_MODEL_HEADER_BYTES: usize = 256 * 1024;
const QUANTIZED_MODEL_SCHEMA: &str = "jotluck.autocomplete.quantized-decoder.v2";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDecoderWarmupRequest {
    manifest_path: String,
    expected_candidate_id: String,
    protocol_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDecoderReadyResponse {
    protocol_version: u32,
    engine_id: String,
    candidate_id: String,
    worker_pid: u32,
    manifest_bytes: u64,
    model_bytes: u64,
    tokenizer_bytes: u64,
    runtime_static_delta_bytes: u64,
    peak_memory_limit_bytes: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDecoderGenerateCommand {
    request_id: u64,
    request: DecoderGenerateRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDecoderCancelRequest {
    request_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDecoderGenerateEnvelope {
    request_id: u64,
    response: DecoderGenerateResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecoderGenerateRequest {
    engine_epoch: u64,
    workspace_scope: String,
    document_version: String,
    cursor_pos: usize,
    context_tail: String,
    context_tail_utf8_bytes: usize,
    context_capsule: DecoderContextCapsule,
    language_hint: String,
    block_type: String,
    cursor_boundary: String,
    max_candidates: usize,
    deadline_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DecoderContextCapsule {
    schema_version: u32,
    max_tokens: usize,
    language_hint: String,
    heading_trail: Vec<String>,
    current_paragraph: String,
    previous_paragraph_tail: String,
    retrieval_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecoderRawCandidate {
    candidate_id: String,
    text: String,
    confidence: f64,
    model_score: f64,
    gate_score: f64,
    language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecoderGenerateResponse {
    protocol_version: u32,
    engine_epoch: u64,
    workspace_scope: String,
    document_version: String,
    cursor_pos: usize,
    candidates: Vec<DecoderRawCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecoderManifest {
    schema: String,
    schema_version: u32,
    engine: String,
    candidate_id: String,
    candidate_artifact_sha256: String,
    lifecycle: String,
    evaluation_only: bool,
    runtime_eligible: bool,
    release_eligible: bool,
    parameter_count: u64,
    quantization: String,
    tokenizer: TokenizerContract,
    context: ContextContract,
    output: OutputContract,
    training: TrainingContract,
    oracle_precheck: OraclePrecheck,
    assets: DecoderAssets,
    runtime_static_delta_bytes: u64,
    measured_peak_memory_bytes: u64,
    release_evidence: Option<ReleaseEvidence>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseEvidence {
    schema: String,
    cold_final_sha256: String,
    workspace_final_sha256: String,
    windows_gui_evidence_sha256: String,
    baseline_sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenizerContract {
    kind: String,
    vocabulary_size: usize,
    byte_fallback: bool,
    bilingual: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextContract {
    maximum_tokens: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputContract {
    chinese_maximum_code_points: usize,
    english_maximum_code_points: usize,
    preserve_complete_english_word: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrainingContract {
    cleaned_pool_bytes: u64,
    license_audit_passed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OraclePrecheck {
    checkpoints: usize,
    oracle_at8: f64,
    oracle_at32: f64,
    chinese_oracle_at8: f64,
    english_oracle_at8: f64,
    passed: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct DecoderAssets {
    model: DecoderAsset,
    tokenizer: DecoderAsset,
}

#[derive(Debug, Clone, Deserialize)]
struct DecoderAsset {
    file: String,
    sha256: String,
    bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuantizedDecoderHeader {
    schema: String,
    engine: String,
    candidate_id: String,
    nominal_parameter_count: u64,
    actual_parameter_count: u64,
    quantization: String,
    vocabulary_size: usize,
    maximum_context_tokens: usize,
    architecture: QuantizedDecoderArchitecture,
    payload_sha256: String,
    tensors: Vec<QuantizedTensorDescriptor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuantizedDecoderArchitecture {
    width: usize,
    layers: usize,
    heads: usize,
    feed_forward: usize,
    activation: String,
    tied_embedding: bool,
    layer_norm_epsilon: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuantizedTensorDescriptor {
    name: String,
    #[serde(default)]
    alias_of: Option<String>,
    #[serde(default)]
    shape: Option<Vec<usize>>,
    #[serde(default)]
    dtype: Option<String>,
    #[serde(default)]
    group_size: Option<usize>,
    #[serde(default)]
    groups: Option<usize>,
    #[serde(default)]
    scale_offset: Option<usize>,
    #[serde(default)]
    scale_bytes: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    bytes: Option<usize>,
}

#[derive(Debug, Clone)]
struct LoadedCandidate {
    manifest: DecoderManifest,
    manifest_path: PathBuf,
    manifest_bytes: u64,
    runtime: Arc<DecoderRuntime>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerFrame {
    protocol_version: u32,
    request_id: u64,
    event: WorkerEvent,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WorkerEvent {
    Ready(CompletionDecoderReadyResponse),
    Generated(CompletionDecoderGenerateEnvelope),
    Error { code: String, message: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostFrame {
    protocol_version: u32,
    request_id: u64,
    command: HostCommand,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HostCommand {
    Generate {
        request: Box<DecoderGenerateRequest>,
    },
    Cancel,
    Shutdown,
}

enum ActorCommand {
    Generate {
        command: Box<CompletionDecoderGenerateCommand>,
        response: mpsc::SyncSender<Result<CompletionDecoderGenerateEnvelope, String>>,
    },
    Cancel(u64),
    Dispose,
}

type GenerateResponseSender = mpsc::SyncSender<Result<CompletionDecoderGenerateEnvelope, String>>;
type ActiveRequest = (u64, u64, GenerateResponseSender);

struct RuntimeHandle {
    command_tx: mpsc::Sender<ActorCommand>,
    ready: CompletionDecoderReadyResponse,
}

impl Drop for RuntimeHandle {
    fn drop(&mut self) {
        let _ = self.command_tx.send(ActorCommand::Dispose);
    }
}

#[derive(Clone, Default)]
pub struct CompletionDecoderState {
    runtime: Arc<Mutex<Option<RuntimeHandle>>>,
}

impl CompletionDecoderState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[tauri::command]
pub async fn completion_decoder_warmup(
    app: tauri::AppHandle,
    state: State<'_, CompletionDecoderState>,
    mut request: CompletionDecoderWarmupRequest,
) -> Result<CompletionDecoderReadyResponse, String> {
    request.manifest_path = resolve_requested_manifest_path(&app, &request.manifest_path)?
        .to_string_lossy()
        .into_owned();
    let runtime = Arc::clone(&state.runtime);
    tauri::async_runtime::spawn_blocking(move || warmup_runtime(&runtime, request))
        .await
        .map_err(|error| format!("completion decoder warmup task failed: {error}"))?
}

#[tauri::command]
pub async fn completion_decoder_generate(
    state: State<'_, CompletionDecoderState>,
    request: CompletionDecoderGenerateCommand,
) -> Result<CompletionDecoderGenerateEnvelope, String> {
    let runtime = Arc::clone(&state.runtime);
    tauri::async_runtime::spawn_blocking(move || generate_with_runtime(&runtime, request))
        .await
        .map_err(|error| format!("completion decoder generate task failed: {error}"))?
}

#[tauri::command]
pub fn completion_decoder_cancel(
    state: State<'_, CompletionDecoderState>,
    request: CompletionDecoderCancelRequest,
) -> Result<(), String> {
    let guard = state
        .runtime
        .lock()
        .map_err(|_| "completion decoder state lock poisoned".to_string())?;
    if let Some(runtime) = guard.as_ref() {
        runtime
            .command_tx
            .send(ActorCommand::Cancel(request.request_id))
            .map_err(|_| "completion decoder worker is unavailable".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn completion_decoder_dispose(state: State<'_, CompletionDecoderState>) -> Result<(), String> {
    let mut guard = state
        .runtime
        .lock()
        .map_err(|_| "completion decoder state lock poisoned".to_string())?;
    guard.take();
    Ok(())
}

mod candidate;
mod host_actor;
mod parity;
mod protocol;
mod tensor_layout;
mod worker;

use candidate::*;
use host_actor::*;
pub(crate) use parity::run_completion_parity_if_requested;
use protocol::*;
use tensor_layout::*;
pub(crate) use worker::run_completion_worker_if_requested;

#[cfg(test)]
use worker::{request_is_stale, serialized_capsule, validate_generate_request};

#[cfg(test)]
mod tests;
