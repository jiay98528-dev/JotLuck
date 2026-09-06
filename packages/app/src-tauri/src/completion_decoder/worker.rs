use super::*;
use crate::completion_decoder_runtime::{DecoderPrefill, TokenScore};

const BEAM_WIDTH: usize = 32;
const BEAM_BRANCHING: usize = 4;
const BEAM_LENGTH_ALPHA: f32 = 0.6;
const MAX_GENERATED_TOKENS: usize = 24;
const ONE_UNIT_GENERATED_TOKENS: usize = 8;
const BLOCK_GENERATED_TOKENS: usize = 5;
const ROUTE_SPACE: char = '\u{e101}';
const ROUTE_TAB: char = '\u{e102}';
const ROUTE_NEWLINE: char = '\u{e103}';
const ROUTE_FIM_PREFIX: char = '\u{e110}';
const ROUTE_FIM_SUFFIX: char = '\u{e111}';
const ROUTE_FIM_MIDDLE: char = '\u{e112}';
const ROUTE_HEADING: char = '\u{e120}';
const ROUTE_PREVIOUS: char = '\u{e121}';
const ROUTE_CURRENT: char = '\u{e122}';
const ROUTE_CONTINUE: char = '\u{e123}';
const ROUTE_LANGUAGE: char = '\u{e124}';

#[derive(Debug)]
struct SequenceBeam {
    cache: Option<crate::completion_decoder_runtime::DecoderCache>,
    logits: Vec<f32>,
    token_ids: Vec<usize>,
    decoded: Option<String>,
    log_probability: f32,
    normalized_score: f32,
    finished: bool,
}

#[derive(Debug, Clone)]
struct BeamChoice {
    parent_index: usize,
    token: Option<crate::completion_decoder_runtime::TokenScore>,
    token_ids: Vec<usize>,
    decoded: Option<String>,
    log_probability: f32,
    normalized_score: f32,
    finished: bool,
}

#[derive(Debug)]
struct AdvanceTask {
    index: usize,
    cache: crate::completion_decoder_runtime::DecoderCache,
    token_id: usize,
}

#[derive(Debug)]
struct AdvanceResult {
    index: usize,
    cache: crate::completion_decoder_runtime::DecoderCache,
    logits: Result<Vec<f32>, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchMode {
    Fixed1,
    Fixed4,
    Adaptive1To4,
    Fixed32,
}

#[derive(Debug, Default)]
struct SearchTrace {
    final_beam_width: usize,
    escalation_step: Option<usize>,
    escalation_reasons: Vec<String>,
}

impl SearchTrace {
    fn fixed(width: usize) -> Self {
        Self {
            final_beam_width: width,
            ..Self::default()
        }
    }
}

#[derive(Debug)]
pub(super) struct BeamParitySequence {
    pub(super) token_ids: Vec<usize>,
    pub(super) normalized_score: f32,
}

pub fn run_completion_worker_if_requested() -> bool {
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() != Some(std::ffi::OsStr::new(WORKER_ARGUMENT)) {
        return false;
    }
    let Some(manifest_path) = arguments.next() else {
        return true;
    };
    if arguments.next().is_some() {
        return true;
    }
    let result = run_worker(Path::new(&manifest_path));
    if let Err(error) = result {
        let stdout = io::stdout();
        let mut writer = BufWriter::new(stdout.lock());
        let _ = write_frame(
            &mut writer,
            &WorkerFrame {
                protocol_version: PROTOCOL_VERSION,
                request_id: 0,
                event: WorkerEvent::Error {
                    code: "worker_start_failed".to_string(),
                    message: error,
                },
            },
        );
    }
    true
}

pub(super) fn run_worker(manifest_path: &Path) -> Result<(), String> {
    let candidate = load_candidate(manifest_path)?;
    let runtime = Arc::clone(&candidate.runtime);
    let manifest = Arc::new(candidate.manifest.clone());
    let cache_store = Arc::new(Mutex::new(PrefillCacheStore::default()));
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let writer = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
    let ready = ready_response(&candidate, std::process::id());
    write_worker_frame(
        &writer,
        WorkerFrame {
            protocol_version: PROTOCOL_VERSION,
            request_id: 0,
            event: WorkerEvent::Ready(ready),
        },
    )?;
    let latest_request = Arc::new(AtomicU64::new(0));
    loop {
        let frame: HostFrame = read_frame(&mut reader)
            .map_err(|error| format!("invalid completion host frame: {error}"))?;
        if frame.protocol_version != PROTOCOL_VERSION {
            return Err("completion host protocol mismatch".to_string());
        }
        match frame.command {
            HostCommand::Generate { request } => {
                latest_request.store(frame.request_id, Ordering::Release);
                let writer = Arc::clone(&writer);
                let latest_request = Arc::clone(&latest_request);
                let runtime = Arc::clone(&runtime);
                let manifest = Arc::clone(&manifest);
                let cache_store = Arc::clone(&cache_store);
                thread::spawn(move || {
                    let event = match run_decoder_inference(
                        &runtime,
                        &manifest,
                        &cache_store,
                        frame.request_id,
                        &request,
                        &latest_request,
                    ) {
                        Ok(Some(response)) => {
                            WorkerEvent::Generated(CompletionDecoderGenerateEnvelope {
                                request_id: frame.request_id,
                                response,
                            })
                        }
                        Ok(None) => return,
                        Err(message) => WorkerEvent::Error {
                            code: "inference_failed".to_string(),
                            message,
                        },
                    };
                    if latest_request.load(Ordering::Acquire) != frame.request_id {
                        return;
                    }
                    let _ = write_worker_frame(
                        &writer,
                        WorkerFrame {
                            protocol_version: PROTOCOL_VERSION,
                            request_id: frame.request_id,
                            event,
                        },
                    );
                });
            }
            HostCommand::Cancel => {
                latest_request
                    .compare_exchange(frame.request_id, 0, Ordering::AcqRel, Ordering::Acquire)
                    .ok();
            }
            HostCommand::Shutdown => return Ok(()),
        }
    }
}

pub(super) fn run_decoder_inference(
    runtime: &DecoderRuntime,
    manifest: &DecoderManifest,
    cache_store: &Arc<Mutex<PrefillCacheStore>>,
    request_id: u64,
    request: &DecoderGenerateRequest,
    latest_request: &AtomicU64,
) -> Result<Option<DecoderGenerateResponse>, String> {
    validate_generate_request(request)?;
    let one_unit_runtime = is_v25_one_unit_runtime(manifest);
    if !one_unit_runtime && request.context_capsule.max_tokens != 256 {
        return Err("bounded context override is restricted to the one-unit runtime".to_string());
    }
    let request_route = effective_model_route(runtime, request)?;
    let search_mode = parse_search_mode(request)?;
    let generated_token_limit = if one_unit_runtime {
        ONE_UNIT_GENERATED_TOKENS
    } else {
        MAX_GENERATED_TOKENS
    };
    let search_thresholds =
        adaptive_thresholds_for_mode(search_mode, manifest.adaptive_thresholds.as_ref())?;
    let mut diagnostics = DecoderRuntimeDiagnostics {
        cache_status: "miss".to_string(),
        reused_tokens: 0,
        computed_tokens: 0,
        invalidation_reason: None,
        final_beam_width: search_mode.default_width(),
        escalation_step: None,
        escalation_reasons: Vec::new(),
    };
    if request_is_stale(request_id, request, latest_request) {
        return Ok(None);
    }
    runtime.begin_performance_profile();
    let should_stop = || request_is_stale(request_id, request, latest_request);
    let capsule = {
        let _profile = runtime.performance_profile_span("worker.capsule");
        serialized_model_context(request_route, request)?
    };
    let tokens = {
        let _profile = runtime.performance_profile_span("worker.tokenize");
        runtime.encode_generation_context_with_limit(
            &capsule,
            if runtime.is_block_decoder() {
                BLOCK_GENERATED_TOKENS
            } else {
                generated_token_limit
            },
            request.context_capsule.max_tokens,
        )
    };
    if tokens.is_empty() {
        return Err("decoder tokenizer returned an empty context".to_string());
    }
    if request.max_candidates == 0 {
        return Ok(Some(empty_generate_response(request, Some(diagnostics))));
    }
    let preparation = {
        let _profile = runtime.performance_profile_span("worker.prefill_cache");
        prepare_prefill(
            runtime,
            manifest,
            cache_store,
            request_id,
            request,
            &tokens,
            &should_stop,
        )?
    };
    diagnostics.cache_status = preparation.cache_status.to_string();
    diagnostics.reused_tokens = preparation.reused_tokens;
    diagnostics.computed_tokens = preparation.computed_tokens;
    diagnostics.invalidation_reason = preparation.invalidation_reason;
    let prefill = Some(preparation.prefill);
    let (beams, search_trace) = {
        let _profile = runtime.performance_profile_span("worker.beam_total");
        match run_model_search(
            runtime,
            &tokens,
            &request.language_hint,
            request_route,
            prefill,
            search_mode,
            search_thresholds,
            generated_token_limit,
            &should_stop,
        ) {
            Ok(result) => result,
            Err(_) if should_stop() => return Ok(None),
            Err(error) => return Err(error),
        }
    };
    diagnostics.final_beam_width = search_trace.final_beam_width;
    diagnostics.escalation_step = search_trace.escalation_step;
    diagnostics.escalation_reasons = search_trace.escalation_reasons;
    if should_stop() {
        return Ok(None);
    }
    let candidates = {
        let _profile = runtime.performance_profile_span("worker.candidate_postprocess");
        let mut seen = HashSet::new();
        let mut candidates = Vec::new();
        for beam in beams {
            if beam.token_ids.is_empty()
                || beam
                    .token_ids
                    .first()
                    .is_some_and(|token_id| runtime.is_terminal(*token_id))
            {
                continue;
            }
            let decoded = beam
                .decoded
                .unwrap_or_else(|| decode_model_tokens(runtime, &beam.token_ids));
            let Some((text, language)) = normalize_model_candidate(
                &decoded,
                &request.language_hint,
                request.context_capsule.max_tokens,
                request_route,
            ) else {
                continue;
            };
            if !seen.insert(text.clone()) {
                continue;
            }
            let rank = candidates.len();
            let probability = f64::from(beam.normalized_score.exp().clamp(0.0, 1.0));
            candidates.push(DecoderRawCandidate {
                candidate_id: format!("{}-{rank}", request_id),
                text,
                confidence: probability,
                model_score: probability,
                gate_score: probability,
                log_score: f64::from(beam.normalized_score),
                language,
            });
            if candidates.len() >= request.max_candidates.min(BEAM_WIDTH) {
                break;
            }
        }
        candidates
    };
    let response = DecoderGenerateResponse {
        protocol_version: PROTOCOL_VERSION,
        engine_epoch: request.engine_epoch,
        workspace_scope: request.workspace_scope.clone(),
        document_version: request.document_version.clone(),
        cursor_pos: request.cursor_pos,
        candidates,
        diagnostics: Some(diagnostics),
    };
    runtime.emit_performance_profile(request_id, &request.language_hint);
    Ok(Some(response))
}

struct PrefillPreparation {
    prefill: DecoderPrefill,
    cache_status: &'static str,
    reused_tokens: usize,
    computed_tokens: usize,
    invalidation_reason: Option<String>,
}

fn prepare_prefill(
    runtime: &DecoderRuntime,
    manifest: &DecoderManifest,
    cache_store: &Arc<Mutex<PrefillCacheStore>>,
    request_id: u64,
    request: &DecoderGenerateRequest,
    tokens: &[usize],
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<PrefillPreparation, String> {
    let Some((identity, document_revision)) = cache_identity(runtime, manifest, request) else {
        let prefill = runtime.prefill(tokens, should_stop)?;
        return Ok(PrefillPreparation {
            prefill,
            cache_status: "miss",
            reused_tokens: 0,
            computed_tokens: tokens.len(),
            invalidation_reason: None,
        });
    };
    let lookup = cache_store
        .lock()
        .map_err(|_| "completion prefill cache lock poisoned".to_string())?
        .lookup(&identity, tokens, document_revision);
    match lookup {
        PrefillCacheLookup::Reusable {
            mut cache,
            logits,
            reused_tokens,
        } => {
            let mut logits = if reused_tokens == tokens.len() && logits.is_empty() {
                runtime.cached_logits(&cache, should_stop)?
            } else {
                logits
            };
            let mut computed_tokens = 0;
            for token_id in tokens.iter().skip(reused_tokens).copied() {
                if should_stop() {
                    return Err("decoder inference cancelled or expired".to_string());
                }
                logits = runtime.advance(&mut cache, token_id, should_stop)?;
                computed_tokens += 1;
            }
            if !should_stop() {
                let _ = cache_store
                    .lock()
                    .map_err(|_| "completion prefill cache lock poisoned".to_string())?
                    .commit(
                        identity,
                        document_revision,
                        request_id,
                        tokens.to_vec(),
                        cache.clone(),
                        logits.clone(),
                    );
            }
            Ok(PrefillPreparation {
                prefill: DecoderPrefill {
                    hidden: runtime.cached_hidden(&cache)?,
                    cache,
                    logits,
                },
                cache_status: "hit",
                reused_tokens,
                computed_tokens,
                invalidation_reason: None,
            })
        }
        PrefillCacheLookup::Miss => {
            let prefill = runtime.prefill(tokens, should_stop)?;
            let _ = cache_store
                .lock()
                .map_err(|_| "completion prefill cache lock poisoned".to_string())?
                .commit(
                    identity,
                    document_revision,
                    request_id,
                    tokens.to_vec(),
                    prefill.cache.clone(),
                    prefill.logits.clone(),
                );
            Ok(PrefillPreparation {
                prefill,
                cache_status: "miss",
                reused_tokens: 0,
                computed_tokens: tokens.len(),
                invalidation_reason: None,
            })
        }
        PrefillCacheLookup::Invalidated { reason } => {
            let prefill = runtime.prefill(tokens, should_stop)?;
            let _ = cache_store
                .lock()
                .map_err(|_| "completion prefill cache lock poisoned".to_string())?
                .commit(
                    identity,
                    document_revision,
                    request_id,
                    tokens.to_vec(),
                    prefill.cache.clone(),
                    prefill.logits.clone(),
                );
            Ok(PrefillPreparation {
                prefill,
                cache_status: "invalidated",
                reused_tokens: 0,
                computed_tokens: tokens.len(),
                invalidation_reason: Some(reason.to_string()),
            })
        }
    }
}

fn cache_identity(
    runtime: &DecoderRuntime,
    manifest: &DecoderManifest,
    request: &DecoderGenerateRequest,
) -> Option<(PrefillCacheIdentity, u64)> {
    let editor_session_id = request.editor_session_id.as_ref()?.clone();
    let document_session_id = request.document_session_id.as_ref()?.clone();
    let document_revision = request.document_revision?;
    Some((
        PrefillCacheIdentity {
            candidate_id: manifest.candidate_id.clone(),
            model_sha256: manifest.assets.model.sha256.clone(),
            tokenizer_sha256: manifest.assets.tokenizer.sha256.clone(),
            context_protocol: format!("{}:{}", manifest.schema, manifest.schema_version),
            route: runtime.route().unwrap_or("free").to_string(),
            language: request.language_hint.clone(),
            workspace_scope: request.workspace_scope.clone(),
            editor_session_id,
            document_session_id,
        },
        document_revision,
    ))
}

fn adaptive_thresholds_for_mode(
    search_mode: SearchMode,
    thresholds: Option<&AdaptiveBeamThresholds>,
) -> Result<(f32, f32), String> {
    let thresholds = thresholds.filter(|value| {
        value.floor.is_finite()
            && value.margin_floor.is_finite()
            && (0.0..=1.0).contains(&value.floor)
            && (0.0..=1.0).contains(&value.margin_floor)
    });
    match (search_mode, thresholds) {
        (_, Some(value)) => Ok((value.floor, value.margin_floor)),
        (SearchMode::Adaptive1To4, None) => {
            Err("adaptive completion requires calibrated manifest thresholds".to_string())
        }
        (_, None) => Ok((0.0, 0.0)),
    }
}

fn parse_search_mode(request: &DecoderGenerateRequest) -> Result<SearchMode, String> {
    match request.search_mode.as_deref() {
        Some("fixed-1") => Ok(SearchMode::Fixed1),
        Some("fixed-4") => Ok(SearchMode::Fixed4),
        Some("adaptive-1-to-4") => Ok(SearchMode::Adaptive1To4),
        Some(value) => Err(format!("unsupported completion search mode: {value}")),
        None => Ok(match request.search_beam_width.unwrap_or(BEAM_WIDTH) {
            1 => SearchMode::Fixed1,
            4 => SearchMode::Fixed4,
            _ => SearchMode::Fixed32,
        }),
    }
}

impl SearchMode {
    fn default_width(self) -> usize {
        match self {
            Self::Fixed1 => 1,
            Self::Fixed4 | Self::Adaptive1To4 => 1,
            Self::Fixed32 => BEAM_WIDTH,
        }
    }

    fn beam_width(self) -> usize {
        match self {
            Self::Fixed1 => 1,
            Self::Fixed4 | Self::Adaptive1To4 => 4,
            Self::Fixed32 => BEAM_WIDTH,
        }
    }
}

fn run_model_search(
    runtime: &DecoderRuntime,
    context_tokens: &[usize],
    language_hint: &str,
    route: Option<&str>,
    prefill: Option<DecoderPrefill>,
    search_mode: SearchMode,
    thresholds: (f32, f32),
    maximum_generated_tokens: usize,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<(Vec<SequenceBeam>, SearchTrace), String> {
    if !runtime.is_block_decoder() {
        if search_mode == SearchMode::Adaptive1To4 {
            return run_adaptive_beam_search(
                runtime,
                context_tokens,
                language_hint,
                route,
                prefill,
                thresholds,
                maximum_generated_tokens,
                should_stop,
            );
        }
        return run_beam_search(
            runtime,
            context_tokens,
            language_hint,
            route,
            prefill,
            search_mode.beam_width(),
            maximum_generated_tokens,
            should_stop,
        )
        .map(|beams| (beams, SearchTrace::fixed(search_mode.beam_width())));
    }
    let prefill =
        prefill.ok_or_else(|| "decoder block search requires a prepared prefill".to_string())?;
    let draft = runtime.draft_block_from_prefill(prefill, BLOCK_GENERATED_TOKENS, should_stop)?;
    if draft.per_position_logits.len() != draft.token_ids.len()
        || draft.conditional_confidence.len() != draft.token_ids.len()
    {
        return Err("decoder block draft result count mismatch".to_string());
    }
    for (position, logits) in draft.per_position_logits.iter().enumerate() {
        let top_tokens = runtime.rank_logits(logits, BEAM_BRANCHING)?;
        let reasons = adaptive_trigger_reasons(&top_tokens, thresholds);
        if !reasons.is_empty() {
            let (beams, mut trace) = run_adaptive_beam_search(
                runtime,
                context_tokens,
                language_hint,
                route,
                Some(draft.prefill),
                thresholds,
                maximum_generated_tokens,
                should_stop,
            )?;
            trace.escalation_step = Some(position);
            trace.escalation_reasons = reasons;
            return Ok((beams, trace));
        }
    }
    let mut token_ids = Vec::with_capacity(draft.token_ids.len());
    let mut log_probability = 0.0_f32;
    let mut decoded = String::new();
    for (token_id, confidence) in draft
        .token_ids
        .into_iter()
        .zip(draft.conditional_confidence)
    {
        if should_stop() {
            return Err("decoder inference cancelled or expired".to_string());
        }
        if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
            return Err("decoder block confidence is invalid".to_string());
        }
        token_ids.push(token_id);
        log_probability += confidence.max(f32::MIN_POSITIVE).ln();
        decoded = decode_model_tokens(runtime, &token_ids);
        if runtime.is_terminal(token_id)
            || sequence_boundary_reached(&decoded, language_hint, route)
        {
            break;
        }
    }
    let normalized_score = length_normalized_score(log_probability, token_ids.len());
    Ok((
        vec![SequenceBeam {
            cache: None,
            logits: Vec::new(),
            token_ids,
            decoded: Some(decoded),
            log_probability,
            normalized_score,
            finished: true,
        }],
        SearchTrace::fixed(search_mode.default_width()),
    ))
}

fn empty_generate_response(
    request: &DecoderGenerateRequest,
    diagnostics: Option<DecoderRuntimeDiagnostics>,
) -> DecoderGenerateResponse {
    DecoderGenerateResponse {
        protocol_version: PROTOCOL_VERSION,
        engine_epoch: request.engine_epoch,
        workspace_scope: request.workspace_scope.clone(),
        document_version: request.document_version.clone(),
        cursor_pos: request.cursor_pos,
        candidates: Vec::new(),
        diagnostics,
    }
}

fn run_beam_search(
    runtime: &DecoderRuntime,
    context_tokens: &[usize],
    language_hint: &str,
    route: Option<&str>,
    prefill: Option<DecoderPrefill>,
    search_beam_width: usize,
    maximum_generated_tokens: usize,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<Vec<SequenceBeam>, String> {
    let prefill = match prefill {
        Some(prefill) => prefill,
        None => {
            let _profile = runtime.performance_profile_span("beam.prefill");
            runtime.prefill(context_tokens, should_stop)?
        }
    };
    let beams = vec![SequenceBeam {
        cache: Some(prefill.cache),
        logits: prefill.logits,
        token_ids: Vec::new(),
        decoded: None,
        log_probability: 0.0,
        normalized_score: 0.0,
        finished: false,
    }];

    run_beam_search_from_beams(
        runtime,
        beams,
        language_hint,
        route,
        search_beam_width,
        0,
        maximum_generated_tokens,
        should_stop,
    )
}

fn run_beam_search_from_beams(
    runtime: &DecoderRuntime,
    mut beams: Vec<SequenceBeam>,
    language_hint: &str,
    route: Option<&str>,
    search_beam_width: usize,
    start_step: usize,
    maximum_generated_tokens: usize,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<Vec<SequenceBeam>, String> {
    let search_beam_width = search_beam_width.clamp(1, BEAM_WIDTH);
    for step in start_step..maximum_generated_tokens {
        if should_stop() {
            return Err("decoder inference cancelled or expired".to_string());
        }
        let mut choices = {
            let _profile =
                runtime.performance_profile_span_owned(format!("beam.step{step}.rank_and_expand"));
            let mut choices = Vec::with_capacity(search_beam_width * BEAM_BRANCHING);
            for (parent_index, beam) in beams.iter().enumerate() {
                if beam.finished {
                    choices.push(BeamChoice {
                        parent_index,
                        token: None,
                        token_ids: beam.token_ids.clone(),
                        decoded: beam.decoded.clone(),
                        log_probability: beam.log_probability,
                        normalized_score: beam.normalized_score,
                        finished: true,
                    });
                    continue;
                }
                for score in runtime.rank_logits(&beam.logits, BEAM_BRANCHING)? {
                    let mut token_ids = beam.token_ids.clone();
                    token_ids.push(score.token_id);
                    let log_probability = beam.log_probability + score.log_probability;
                    let normalized_score =
                        length_normalized_score(log_probability, token_ids.len());
                    let finished = runtime.is_terminal(score.token_id)
                        || token_ids.len() >= maximum_generated_tokens;
                    choices.push(BeamChoice {
                        parent_index,
                        token: Some(score),
                        token_ids,
                        decoded: None,
                        log_probability,
                        normalized_score,
                        finished,
                    });
                }
            }
            choices
        };
        {
            let _profile =
                runtime.performance_profile_span_owned(format!("beam.step{step}.select"));
            select_best_choices(&mut choices, search_beam_width);
        }
        {
            let _profile =
                runtime.performance_profile_span_owned(format!("beam.step{step}.decode_boundary"));
            for choice in &mut choices {
                if choice.finished || choice.token.is_none() {
                    continue;
                }
                let decoded = decode_model_tokens(runtime, &choice.token_ids);
                if sequence_boundary_reached(&decoded, language_hint, route) {
                    choice.finished = true;
                }
                choice.decoded = Some(decoded);
            }
        }

        let (tasks, mut next) = {
            let _profile = runtime
                .performance_profile_span_owned(format!("beam.step{step}.cache_clone_tasks"));
            let mut active_children = vec![0_usize; beams.len()];
            for choice in &choices {
                if choice.token.is_some() && !choice.finished {
                    active_children[choice.parent_index] += 1;
                }
            }
            let mut parent_caches: Vec<_> = beams.into_iter().map(|beam| beam.cache).collect();
            let mut tasks = Vec::with_capacity(choices.len());
            let mut next = Vec::with_capacity(choices.len());
            for choice in choices {
                let token_id = choice.token.map(|score| score.token_id);
                let index = next.len();
                next.push(SequenceBeam {
                    cache: None,
                    logits: Vec::new(),
                    token_ids: choice.token_ids,
                    decoded: choice.decoded,
                    log_probability: choice.log_probability,
                    normalized_score: choice.normalized_score,
                    finished: choice.finished,
                });
                let Some(token_id) = token_id else {
                    continue;
                };
                if choice.finished {
                    continue;
                }
                let remaining = &mut active_children[choice.parent_index];
                let cache = if *remaining == 1 {
                    parent_caches[choice.parent_index]
                        .take()
                        .ok_or_else(|| "decoder beam parent cache is missing".to_string())?
                } else {
                    parent_caches[choice.parent_index]
                        .as_ref()
                        .cloned()
                        .ok_or_else(|| "decoder beam parent cache is missing".to_string())?
                };
                *remaining -= 1;
                tasks.push(AdvanceTask {
                    index,
                    cache,
                    token_id,
                });
            }
            (tasks, next)
        };
        let task_count = tasks.len();
        let results = {
            let _profile = runtime.performance_profile_span_owned(format!(
                "beam.step{step}.advance_batch{task_count}"
            ));
            advance_beams(runtime, tasks, should_stop)?
        };
        {
            let _profile =
                runtime.performance_profile_span_owned(format!("beam.step{step}.install"));
            install_advance_results(&mut next, results)?;
        }
        beams = next;
        if beams.is_empty() || beams.iter().all(|beam| beam.finished) {
            break;
        }
    }
    {
        let _profile = runtime.performance_profile_span("beam.final_sort");
        beams.sort_by(compare_beams);
    }
    Ok(beams)
}

fn run_adaptive_beam_search(
    runtime: &DecoderRuntime,
    context_tokens: &[usize],
    language_hint: &str,
    route: Option<&str>,
    prefill: Option<DecoderPrefill>,
    thresholds: (f32, f32),
    maximum_generated_tokens: usize,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<(Vec<SequenceBeam>, SearchTrace), String> {
    let prefill = match prefill {
        Some(prefill) => prefill,
        None => {
            let _profile = runtime.performance_profile_span("adaptive.prefill");
            runtime.prefill(context_tokens, should_stop)?
        }
    };
    let mut beam = SequenceBeam {
        cache: Some(prefill.cache),
        logits: prefill.logits,
        token_ids: Vec::new(),
        decoded: None,
        log_probability: 0.0,
        normalized_score: 0.0,
        finished: false,
    };
    for step in 0..maximum_generated_tokens {
        if should_stop() {
            return Err("decoder inference cancelled or expired".to_string());
        }
        let top_tokens = runtime.rank_logits(&beam.logits, BEAM_BRANCHING)?;
        let reasons = adaptive_trigger_reasons(&top_tokens, thresholds);
        if !reasons.is_empty() {
            let beams = run_beam_search_from_beams(
                runtime,
                vec![beam],
                language_hint,
                route,
                4,
                step,
                maximum_generated_tokens,
                should_stop,
            )?;
            return Ok((
                beams,
                SearchTrace {
                    final_beam_width: 4,
                    escalation_step: Some(step),
                    escalation_reasons: reasons,
                },
            ));
        }
        let selected = top_tokens
            .first()
            .copied()
            .ok_or_else(|| "decoder logits produced no token".to_string())?;
        beam.token_ids.push(selected.token_id);
        beam.log_probability += selected.log_probability;
        beam.normalized_score = length_normalized_score(beam.log_probability, beam.token_ids.len());
        let decoded = decode_model_tokens(runtime, &beam.token_ids);
        let finished = runtime.is_terminal(selected.token_id)
            || beam.token_ids.len() >= maximum_generated_tokens
            || sequence_boundary_reached(&decoded, language_hint, route);
        beam.decoded = Some(decoded);
        beam.finished = finished;
        if finished {
            break;
        }
        let mut cache = beam
            .cache
            .take()
            .ok_or_else(|| "decoder adaptive beam cache is missing".to_string())?;
        beam.logits = runtime.advance(&mut cache, selected.token_id, should_stop)?;
        beam.cache = Some(cache);
    }
    Ok((vec![beam], SearchTrace::fixed(1)))
}

fn adaptive_trigger_reasons(top_tokens: &[TokenScore], thresholds: (f32, f32)) -> Vec<String> {
    let Some(top1) = top_tokens.first() else {
        return vec!["top1 probability unavailable".to_string()];
    };
    let top1_probability = top1.log_probability.exp();
    let top2_probability = top_tokens
        .get(1)
        .map(|value| value.log_probability.exp())
        .unwrap_or(0.0);
    let mut reasons = Vec::new();
    if !top1_probability.is_finite() || !(0.0..=1.0).contains(&top1_probability) {
        reasons.push("top1 probability invalid".to_string());
    } else if top1_probability < thresholds.0 {
        reasons.push("top1 probability below floor".to_string());
    }
    if top1_probability - top2_probability < thresholds.1 {
        reasons.push("top1-top2 margin below floor".to_string());
    }
    reasons
}

fn install_advance_results(
    beams: &mut [SequenceBeam],
    results: Vec<AdvanceResult>,
) -> Result<(), String> {
    for result in results {
        let beam = beams
            .get_mut(result.index)
            .ok_or_else(|| "decoder beam advance index is invalid".to_string())?;
        beam.cache = Some(result.cache);
        beam.logits = result.logits?;
    }
    Ok(())
}

fn advance_beams(
    runtime: &DecoderRuntime,
    tasks: Vec<AdvanceTask>,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<Vec<AdvanceResult>, String> {
    let mut indices = Vec::with_capacity(tasks.len());
    let mut caches = Vec::with_capacity(tasks.len());
    let mut token_ids = Vec::with_capacity(tasks.len());
    for task in tasks {
        indices.push(task.index);
        caches.push(task.cache);
        token_ids.push(task.token_id);
    }
    let logits = runtime.advance_batch(&mut caches, &token_ids, should_stop)?;
    assemble_batch_advance_results(indices, caches, logits)
}

fn assemble_batch_advance_results(
    indices: Vec<usize>,
    caches: Vec<crate::completion_decoder_runtime::DecoderCache>,
    logits: Vec<Vec<f32>>,
) -> Result<Vec<AdvanceResult>, String> {
    if indices.len() != caches.len() || indices.len() != logits.len() {
        return Err("decoder batch advance result count mismatch".to_string());
    }
    Ok(indices
        .into_iter()
        .zip(caches)
        .zip(logits)
        .map(|((index, cache), logits)| AdvanceResult {
            index,
            cache,
            logits: Ok(logits),
        })
        .collect())
}

pub(super) fn beam_sequences_for_parity(
    runtime: &DecoderRuntime,
    context_tokens: &[usize],
    language_hint: &str,
) -> Result<Vec<BeamParitySequence>, String> {
    run_model_search(
        runtime,
        context_tokens,
        language_hint,
        match runtime.route() {
            Some("joint") if language_hint == "unknown" => Some("code"),
            Some("joint") => Some("writing"),
            route => route,
        },
        None,
        SearchMode::Fixed32,
        (0.3, 0.2),
        MAX_GENERATED_TOKENS,
        &|| false,
    )
    .map(|(beams, _)| {
        beams
            .into_iter()
            .map(|beam| BeamParitySequence {
                token_ids: beam.token_ids,
                normalized_score: beam.normalized_score,
            })
            .collect()
    })
}

fn compare_beams(left: &SequenceBeam, right: &SequenceBeam) -> std::cmp::Ordering {
    right
        .normalized_score
        .total_cmp(&left.normalized_score)
        .then_with(|| right.log_probability.total_cmp(&left.log_probability))
        .then_with(|| left.token_ids.cmp(&right.token_ids))
}

fn compare_choices(left: &BeamChoice, right: &BeamChoice) -> std::cmp::Ordering {
    right
        .normalized_score
        .total_cmp(&left.normalized_score)
        .then_with(|| right.log_probability.total_cmp(&left.log_probability))
        .then_with(|| left.token_ids.cmp(&right.token_ids))
}

fn select_best_choices(choices: &mut Vec<BeamChoice>, beam_width: usize) {
    choices.sort_by(compare_choices);
    choices.truncate(beam_width);
}

fn length_normalized_score(log_probability: f32, length: usize) -> f32 {
    log_probability / (length.max(1) as f32).powf(BEAM_LENGTH_ALPHA)
}

fn sequence_boundary_reached(value: &str, language_hint: &str, route: Option<&str>) -> bool {
    let trimmed = value.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    if route == Some("code") {
        return trimmed.contains(['\r', '\n']) || trimmed.chars().count() >= 32;
    }
    let has_chinese = trimmed.chars().any(is_cjk);
    let has_english = trimmed
        .chars()
        .any(|character| character.is_ascii_alphabetic());
    if route == Some("writing") {
        if trimmed.contains(['\r', '\n']) {
            return true;
        }
        if language_hint == "zh" || (has_chinese && !has_english) {
            return trimmed.chars().count() >= 16;
        }
        return trimmed.chars().count() >= 24
            && trimmed.chars().last().is_some_and(|character| {
                character.is_whitespace() || !character.is_alphanumeric()
            });
    }
    if language_hint == "zh" || (language_hint == "unknown" && has_chinese && !has_english) {
        return trimmed.chars().count() >= 8;
    }
    if language_hint == "en" || (language_hint == "unknown" && has_english && !has_chinese) {
        let mut words = trimmed.split_whitespace();
        let first = words.next().unwrap_or_default();
        return words.next().is_some() || first.chars().count() >= 12;
    }
    trimmed.chars().count() >= 12
}

pub(super) fn request_is_stale(
    request_id: u64,
    request: &DecoderGenerateRequest,
    latest_request: &AtomicU64,
) -> bool {
    latest_request.load(Ordering::Acquire) != request_id || now_unix_ms() > request.deadline_at
}

pub(super) fn normalize_model_candidate(
    value: &str,
    language_hint: &str,
    _maximum_context_tokens: usize,
    route: Option<&str>,
) -> Option<(String, String)> {
    if value
        .chars()
        .any(|character| matches!(character as u32, 0xe100..=0xe124))
    {
        return None;
    }
    if route == Some("code") {
        let value = value.trim_end_matches(|character: char| character.is_whitespace());
        if value.trim().is_empty() || value.contains("```") || value.contains("~~~") {
            return None;
        }
        return Some((value.chars().take(32).collect(), "en".to_string()));
    }
    let value = if route == Some("writing") {
        value.split(['\r', '\n']).next().unwrap_or_default()
    } else {
        value
    };
    let trimmed = value.trim_matches(|character: char| character.is_whitespace());
    if trimmed.is_empty() || trimmed.contains(['\r', '\n']) {
        return None;
    }
    let has_chinese = trimmed.chars().any(is_cjk);
    let has_english = trimmed
        .chars()
        .any(|character| character.is_ascii_alphabetic());
    if has_chinese && has_english {
        return None;
    }
    let (text, language) = if has_chinese {
        if language_hint == "en" {
            return None;
        }
        let maximum = if route == Some("writing") { 16 } else { 8 };
        let text: String = trimmed.chars().take(maximum).collect();
        (text, "zh".to_string())
    } else if has_english {
        if language_hint == "zh" {
            return None;
        }
        if route == Some("writing") {
            let leading_space = value.starts_with(' ');
            let maximum_content = 24_usize.saturating_sub(usize::from(leading_space));
            let text = if trimmed.chars().count() <= maximum_content {
                trimmed.to_string()
            } else {
                let clipped: String = trimmed.chars().take(maximum_content).collect();
                let boundary = clipped
                    .char_indices()
                    .rev()
                    .find(|(_, character)| character.is_whitespace())
                    .map(|(index, _)| index)?;
                clipped[..boundary].trim_end().to_string()
            };
            if text.is_empty() {
                return None;
            }
            (
                if leading_space {
                    format!(" {text}")
                } else {
                    text
                },
                "en".to_string(),
            )
        } else {
            let word = trimmed
                .split_whitespace()
                .next()?
                .trim_matches(|character: char| {
                    !character.is_ascii_alphabetic() && character != '\''
                });
            if word.is_empty() || word.chars().count() > 12 {
                return None;
            }
            (word.to_string(), "en".to_string())
        }
    } else {
        return None;
    };
    Some((text, language))
}

pub(super) fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x2fa1f
    )
}

pub(super) fn validate_generate_request(request: &DecoderGenerateRequest) -> Result<(), String> {
    let session_identity_field_count = usize::from(request.editor_session_id.is_some())
        + usize::from(request.document_session_id.is_some())
        + usize::from(request.document_revision.is_some());
    if session_identity_field_count != 0 && session_identity_field_count != 3 {
        return Err("V2.4 completion request session contract is incomplete".to_string());
    }
    let code_context_conflicts = (!request.context_suffix.is_empty()
        && !request.context_capsule.code_suffix.is_empty()
        && request.context_suffix != request.context_capsule.code_suffix)
        || (!request.code_language.is_empty()
            && !request.context_capsule.code_language.is_empty()
            && request.code_language != request.context_capsule.code_language);
    let code_suffix = request_code_suffix(request);
    let code_language = request_code_language(request);
    if request.context_tail.len() != request.context_tail_utf8_bytes
        || request.context_tail_utf8_bytes > 256
        || request.context_capsule.schema_version != 1
        || request.context_capsule.max_tokens == 0
        || request.context_capsule.max_tokens > 256
        || request.context_capsule.heading_trail.len() > 6
        || serialized_capsule(&request.context_capsule).len() > 16 * 1024
        || request
            .context_capsule
            .current_paragraph
            .len()
            .saturating_add(code_suffix.len())
            > 16 * 1024
        || code_language.len() > 32
        || code_context_conflicts
        || !matches!(request.language_hint.as_str(), "zh" | "en" | "unknown")
        || request.context_capsule.language_hint != request.language_hint
        || !matches!(
            request.block_type.as_str(),
            "paragraph" | "list" | "quote" | "code"
        )
        || request.max_candidates > 32
        || request
            .editor_session_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 128)
        || request
            .document_session_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 128)
        || request
            .search_mode
            .as_deref()
            .is_some_and(|mode| !matches!(mode, "fixed-1" | "fixed-4" | "adaptive-1-to-4"))
        || request
            .search_beam_width
            .is_some_and(|width| width == 0 || width > BEAM_WIDTH)
        || now_unix_ms() > request.deadline_at
    {
        return Err("invalid completion decoder request".to_string());
    }
    Ok(())
}

fn request_code_suffix(request: &DecoderGenerateRequest) -> &str {
    if request.context_suffix.is_empty() {
        &request.context_capsule.code_suffix
    } else {
        &request.context_suffix
    }
}

fn request_code_language(request: &DecoderGenerateRequest) -> &str {
    if request.code_language.is_empty() {
        &request.context_capsule.code_language
    } else {
        &request.code_language
    }
}

fn effective_model_route(
    runtime: &DecoderRuntime,
    request: &DecoderGenerateRequest,
) -> Result<Option<&'static str>, String> {
    match runtime.route() {
        Some("joint") if request.block_type == "code" => Ok(Some("code")),
        Some("joint") if matches!(request.block_type.as_str(), "paragraph" | "list" | "quote") => {
            Ok(Some("writing"))
        }
        Some("joint") => Err("unsupported V2.5 joint decoder route".to_string()),
        Some("code") => Ok(Some("code")),
        Some("writing") => Ok(Some("writing")),
        Some(_) => Err("unsupported routed decoder context".to_string()),
        None => Ok(None),
    }
}

fn serialized_model_context(
    route: Option<&str>,
    request: &DecoderGenerateRequest,
) -> Result<String, String> {
    match route {
        Some("code") => {
            let language = request_code_language(request).trim();
            if language.is_empty()
                || !language.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '+')
                })
                || request.block_type != "code"
            {
                return Err("invalid code-route completion context".to_string());
            }
            Ok(format!(
                "{ROUTE_LANGUAGE}{language}{ROUTE_FIM_PREFIX}{}{ROUTE_FIM_SUFFIX}{}{ROUTE_FIM_MIDDLE}",
                encode_route_text(&request.context_capsule.current_paragraph)?,
                encode_route_text(request_code_suffix(request))?,
            ))
        }
        Some("writing") => {
            if request.block_type == "code"
                || !matches!(request.language_hint.as_str(), "zh" | "en")
            {
                return Err("invalid writing-route completion context".to_string());
            }
            let mut value = format!("{ROUTE_LANGUAGE}{}", request.language_hint);
            for heading in &request.context_capsule.heading_trail {
                value.push(ROUTE_HEADING);
                value.push_str(&encode_route_text(heading)?);
            }
            if !request.context_capsule.previous_paragraph_tail.is_empty() {
                value.push(ROUTE_PREVIOUS);
                value.push_str(&encode_route_text(
                    &request.context_capsule.previous_paragraph_tail,
                )?);
            }
            value.push(ROUTE_CURRENT);
            value.push_str(&encode_route_text(
                &request.context_capsule.current_paragraph,
            )?);
            value.push(ROUTE_CONTINUE);
            Ok(value)
        }
        Some(_) => Err("unsupported routed decoder context".to_string()),
        None => Ok(serialized_capsule(&request.context_capsule)),
    }
}

fn encode_route_text(value: &str) -> Result<String, String> {
    let normalized: String = value
        .nfkc()
        .collect::<String>()
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if normalized
        .chars()
        .any(|character| matches!(character as u32, 0xe100..=0xe124))
    {
        return Err("routed decoder context contains a reserved marker".to_string());
    }
    Ok(normalized
        .chars()
        .map(|character| match character {
            ' ' => ROUTE_SPACE,
            '\t' => ROUTE_TAB,
            '\n' => ROUTE_NEWLINE,
            value => value,
        })
        .collect())
}

fn decode_model_tokens(runtime: &DecoderRuntime, token_ids: &[usize]) -> String {
    let decoded = runtime.decode_tokens(token_ids);
    if runtime.route().is_none() {
        return decoded;
    }
    decoded
        .chars()
        .map(|character| match character {
            ROUTE_SPACE => ' ',
            ROUTE_TAB => '\t',
            ROUTE_NEWLINE => '\n',
            value => value,
        })
        .collect()
}

pub(super) fn serialized_capsule(capsule: &DecoderContextCapsule) -> String {
    let mut sections = Vec::new();
    for heading in &capsule.heading_trail {
        sections.push(format!("<heading>{heading}</heading>"));
    }
    if !capsule.previous_paragraph_tail.is_empty() {
        sections.push(format!(
            "<previous>{}</previous>",
            capsule.previous_paragraph_tail
        ));
    }
    if !capsule.retrieval_snippet.is_empty() {
        sections.push(format!(
            "<retrieval>{}</retrieval>",
            capsule.retrieval_snippet
        ));
    }
    sections.push(format!("<current>{}</current>", capsule.current_paragraph));
    sections.join("\n")
}

#[cfg(test)]
mod beam_tests {
    use super::*;

    fn beam(tokens: &[usize], log_probability: f32) -> SequenceBeam {
        SequenceBeam {
            cache: Some(Default::default()),
            logits: Vec::new(),
            token_ids: tokens.to_vec(),
            decoded: None,
            log_probability,
            normalized_score: length_normalized_score(log_probability, tokens.len()),
            finished: false,
        }
    }

    #[test]
    fn fixed_beam_ranking_uses_alpha_and_stable_token_ties() {
        let mut beams = [beam(&[2, 4], -1.0), beam(&[2], -0.8), beam(&[1], -0.8)];
        beams.sort_by(compare_beams);
        assert_eq!(beams[0].token_ids, vec![2, 4]);
        assert_eq!(beams[1].token_ids, vec![1]);
        assert_eq!(beams[2].token_ids, vec![2]);
        assert!(length_normalized_score(-1.0, 2) > -1.0);
    }

    #[test]
    fn adaptive_search_triggers_only_on_probability_or_margin_floor() {
        let confident = vec![
            TokenScore {
                token_id: 1,
                logit: 0.0,
                log_probability: 0.0,
            },
            TokenScore {
                token_id: 2,
                logit: 0.0,
                log_probability: 0.1_f32.ln(),
            },
        ];
        assert!(adaptive_trigger_reasons(&confident, (0.3, 0.2)).is_empty());
        let low_margin = vec![
            TokenScore {
                token_id: 1,
                logit: 0.0,
                log_probability: 0.55_f32.ln(),
            },
            TokenScore {
                token_id: 2,
                logit: 0.0,
                log_probability: 0.5_f32.ln(),
            },
        ];
        assert_eq!(
            adaptive_trigger_reasons(&low_margin, (0.3, 0.2)),
            vec!["top1-top2 margin below floor"]
        );
        assert!(!adaptive_trigger_reasons(&[], (0.3, 0.2)).is_empty());
    }

    #[test]
    fn adaptive_mode_rejects_missing_or_uncalibrated_manifest_thresholds() {
        assert!(adaptive_thresholds_for_mode(SearchMode::Adaptive1To4, None).is_err());
        let measured = AdaptiveBeamThresholds {
            floor: 0.31,
            margin_floor: 0.2,
        };
        assert_eq!(
            adaptive_thresholds_for_mode(SearchMode::Adaptive1To4, Some(&measured)).unwrap(),
            (0.31, 0.2)
        );
        let invalid = AdaptiveBeamThresholds {
            floor: 1.01,
            margin_floor: 0.2,
        };
        assert!(adaptive_thresholds_for_mode(SearchMode::Adaptive1To4, Some(&invalid)).is_err());
        assert_eq!(
            adaptive_thresholds_for_mode(SearchMode::Fixed4, None).unwrap(),
            (0.0, 0.0)
        );
    }

    #[test]
    fn language_boundaries_are_bounded_and_complete() {
        assert!(sequence_boundary_reached(
            "中文补全结果已经足够",
            "zh",
            None
        ));
        assert!(!sequence_boundary_reached("short", "en", None));
        assert!(sequence_boundary_reached("complete next", "en", None));
        assert!(sequence_boundary_reached("abcdefghijkl", "en", None));
        assert!(sequence_boundary_reached(
            "const value = compute();\n",
            "unknown",
            Some("code")
        ));
    }

    #[test]
    fn routed_whitespace_round_trips_and_preserves_code_indentation() {
        let encoded = encode_route_text("  value\t= ready\r\nnext").unwrap();
        let decoded: String = encoded
            .chars()
            .map(|character| match character {
                ROUTE_SPACE => ' ',
                ROUTE_TAB => '\t',
                ROUTE_NEWLINE => '\n',
                value => value,
            })
            .collect();
        assert_eq!(decoded, "  value\t= ready\nnext");
        assert_eq!(
            normalize_model_candidate("    return value", "unknown", 256, Some("code")),
            Some(("    return value".to_string(), "en".to_string()))
        );
    }

    #[test]
    fn v25_joint_prompt_serialization_matches_training_writing_and_fim_shapes() {
        let mut request = DecoderGenerateRequest {
            engine_epoch: 1,
            workspace_scope: "workspace".to_string(),
            document_version: "revision".to_string(),
            cursor_pos: 7,
            context_tail: "prefix ".to_string(),
            context_tail_utf8_bytes: 7,
            context_suffix: String::new(),
            code_language: String::new(),
            context_capsule: DecoderContextCapsule {
                schema_version: 1,
                max_tokens: 256,
                language_hint: "en".to_string(),
                heading_trail: vec!["Plan".to_string()],
                current_paragraph: "prefix ".to_string(),
                previous_paragraph_tail: "Before".to_string(),
                retrieval_snippet: String::new(),
                code_suffix: String::new(),
                code_language: String::new(),
            },
            language_hint: "en".to_string(),
            block_type: "paragraph".to_string(),
            cursor_boundary: "other".to_string(),
            max_candidates: 4,
            search_beam_width: Some(4),
            editor_session_id: None,
            document_session_id: None,
            document_revision: None,
            search_mode: None,
            deadline_at: now_unix_ms() + 1_000,
        };
        assert_eq!(
            serialized_model_context(Some("writing"), &request).unwrap(),
            format!(
                "{ROUTE_LANGUAGE}en{ROUTE_HEADING}Plan{ROUTE_PREVIOUS}Before{ROUTE_CURRENT}prefix{ROUTE_SPACE}{ROUTE_CONTINUE}"
            )
        );

        request.block_type = "code".to_string();
        request.language_hint = "unknown".to_string();
        request.context_capsule.language_hint = "unknown".to_string();
        request.context_capsule.current_paragraph = "parser.".to_string();
        request.context_suffix = "(value)".to_string();
        request.code_language = "rust".to_string();
        assert_eq!(
            serialized_model_context(Some("code"), &request).unwrap(),
            format!(
                "{ROUTE_LANGUAGE}rust{ROUTE_FIM_PREFIX}parser.{ROUTE_FIM_SUFFIX}(value){ROUTE_FIM_MIDDLE}"
            )
        );
    }

    #[test]
    fn one_pass_choice_selection_matches_incremental_reference() {
        let candidates = (0..96)
            .map(|index| BeamChoice {
                parent_index: index / BEAM_BRANCHING,
                token: Some(crate::completion_decoder_runtime::TokenScore {
                    token_id: 200 - index,
                    logit: 0.0,
                    log_probability: -(index as f32) / 10.0,
                }),
                token_ids: vec![index / 7, 200 - index],
                decoded: None,
                log_probability: -(index as f32) / 10.0,
                normalized_score: -((index % 17) as f32) / 10.0,
                finished: index % 11 == 0,
            })
            .collect::<Vec<_>>();
        let mut reference = Vec::new();
        for candidate in candidates.clone() {
            reference.push(candidate);
            reference.sort_by(compare_choices);
            reference.truncate(BEAM_WIDTH);
        }
        let mut selected = candidates;
        select_best_choices(&mut selected, BEAM_WIDTH);
        assert_eq!(selected.len(), BEAM_WIDTH);
        assert!(selected.iter().zip(reference).all(|(left, right)| {
            left.parent_index == right.parent_index
                && left.token_ids == right.token_ids
                && left.log_probability.to_bits() == right.log_probability.to_bits()
                && left.normalized_score.to_bits() == right.normalized_score.to_bits()
                && left.finished == right.finished
        }));
    }

    #[test]
    fn choice_selection_honors_a_narrow_request_width() {
        let mut selected = (0..16)
            .map(|index| BeamChoice {
                parent_index: index / BEAM_BRANCHING,
                token: None,
                token_ids: vec![index],
                decoded: None,
                log_probability: -(index as f32),
                normalized_score: -(index as f32),
                finished: true,
            })
            .collect::<Vec<_>>();

        select_best_choices(&mut selected, 4);

        assert_eq!(selected.len(), 4);
        assert_eq!(selected[0].token_ids, vec![0]);
        assert_eq!(selected[3].token_ids, vec![3]);
    }

    #[test]
    fn writing_candidate_preserves_one_english_boundary_space() {
        assert_eq!(
            normalize_model_candidate(" for a later chapter.", "en", 256, Some("writing")),
            Some((" for a later chapter.".to_string(), "en".to_string()))
        );
        assert_eq!(
            normalize_model_candidate("\nnext item", "en", 256, Some("writing")),
            None
        );
        assert_eq!(
            normalize_model_candidate(" useful sentence.\nnext item", "en", 256, Some("writing")),
            Some((" useful sentence.".to_string(), "en".to_string()))
        );
        assert_eq!(
            normalize_model_candidate("当前判断不依赖外部资料。", "zh", 256, Some("writing")),
            Some(("当前判断不依赖外部资料。".to_string(), "zh".to_string()))
        );
    }

    #[test]
    fn advance_results_install_by_beam_index_not_completion_order() {
        let mut beams = vec![beam(&[1], -0.1), beam(&[2], -0.2)];
        install_advance_results(
            &mut beams,
            vec![
                AdvanceResult {
                    index: 1,
                    cache: Default::default(),
                    logits: Ok(vec![2.0]),
                },
                AdvanceResult {
                    index: 0,
                    cache: Default::default(),
                    logits: Ok(vec![1.0]),
                },
            ],
        )
        .unwrap();
        assert_eq!(beams[0].logits, vec![1.0]);
        assert_eq!(beams[1].logits, vec![2.0]);
    }

    #[test]
    fn batch_results_keep_task_indices_and_runtime_order() {
        let results = assemble_batch_advance_results(
            vec![7, 2, 11],
            vec![Default::default(), Default::default(), Default::default()],
            vec![vec![7.0], vec![2.0], vec![11.0]],
        )
        .unwrap();
        assert_eq!(
            results
                .iter()
                .map(|result| (result.index, result.logits.as_ref().unwrap()[0]))
                .collect::<Vec<_>>(),
            vec![(7, 7.0), (2, 2.0), (11, 11.0)]
        );
    }
}
