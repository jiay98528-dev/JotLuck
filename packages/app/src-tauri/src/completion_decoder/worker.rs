use super::*;

const BEAM_WIDTH: usize = 32;
const BEAM_BRANCHING: usize = 4;
const BEAM_LENGTH_ALPHA: f32 = 0.6;
const MAX_GENERATED_TOKENS: usize = 24;

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
                thread::spawn(move || {
                    let event = match run_decoder_inference(
                        &runtime,
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
    request_id: u64,
    request: &DecoderGenerateRequest,
    latest_request: &AtomicU64,
) -> Result<Option<DecoderGenerateResponse>, String> {
    validate_generate_request(request)?;
    if request_is_stale(request_id, request, latest_request) {
        return Ok(None);
    }
    runtime.begin_performance_profile();
    let should_stop = || request_is_stale(request_id, request, latest_request);
    let capsule = {
        let _profile = runtime.performance_profile_span("worker.capsule");
        serialized_capsule(&request.context_capsule)
    };
    let tokens = {
        let _profile = runtime.performance_profile_span("worker.tokenize");
        runtime.encode_generation_context(&capsule, MAX_GENERATED_TOKENS)
    };
    if tokens.is_empty() {
        return Err("decoder tokenizer returned an empty context".to_string());
    }
    if request.max_candidates == 0 {
        return Ok(Some(empty_generate_response(request)));
    }
    let beams = {
        let _profile = runtime.performance_profile_span("worker.beam_total");
        match run_beam_search(runtime, &tokens, &request.language_hint, &should_stop) {
            Ok(beams) => beams,
            Err(_) if should_stop() => return Ok(None),
            Err(error) => return Err(error),
        }
    };
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
                .unwrap_or_else(|| runtime.decode_tokens(&beam.token_ids));
            let Some((text, language)) = normalize_model_candidate(
                &decoded,
                &request.language_hint,
                request.context_capsule.max_tokens,
            ) else {
                continue;
            };
            if !seen.insert(text.clone()) {
                continue;
            }
            let rank = candidates.len();
            candidates.push(DecoderRawCandidate {
                candidate_id: format!("{}-{rank}", request_id),
                text,
                confidence: f64::from(beam.normalized_score.exp().clamp(0.0, 1.0)),
                model_score: f64::from(beam.normalized_score),
                gate_score: f64::from(beam.normalized_score.exp().clamp(0.0, 1.0)),
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
    };
    runtime.emit_performance_profile(request_id, &request.language_hint);
    Ok(Some(response))
}

fn empty_generate_response(request: &DecoderGenerateRequest) -> DecoderGenerateResponse {
    DecoderGenerateResponse {
        protocol_version: PROTOCOL_VERSION,
        engine_epoch: request.engine_epoch,
        workspace_scope: request.workspace_scope.clone(),
        document_version: request.document_version.clone(),
        cursor_pos: request.cursor_pos,
        candidates: Vec::new(),
    }
}

fn run_beam_search(
    runtime: &DecoderRuntime,
    context_tokens: &[usize],
    language_hint: &str,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<Vec<SequenceBeam>, String> {
    let prefill = {
        let _profile = runtime.performance_profile_span("beam.prefill");
        runtime.prefill(context_tokens, should_stop)?
    };
    let mut beams = vec![SequenceBeam {
        cache: Some(prefill.cache),
        logits: prefill.logits,
        token_ids: Vec::new(),
        decoded: None,
        log_probability: 0.0,
        normalized_score: 0.0,
        finished: false,
    }];

    for step in 0..MAX_GENERATED_TOKENS {
        if should_stop() {
            return Err("decoder inference cancelled or expired".to_string());
        }
        let mut choices = {
            let _profile =
                runtime.performance_profile_span_owned(format!("beam.step{step}.rank_and_expand"));
            let mut choices = Vec::with_capacity(BEAM_WIDTH * BEAM_BRANCHING);
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
                        || token_ids.len() >= MAX_GENERATED_TOKENS;
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
            select_best_choices(&mut choices);
        }
        {
            let _profile =
                runtime.performance_profile_span_owned(format!("beam.step{step}.decode_boundary"));
            for choice in &mut choices {
                if choice.finished || choice.token.is_none() {
                    continue;
                }
                let decoded = runtime.decode_tokens(&choice.token_ids);
                if sequence_boundary_reached(&decoded, language_hint) {
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
    run_beam_search(runtime, context_tokens, language_hint, &|| false).map(|beams| {
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

fn select_best_choices(choices: &mut Vec<BeamChoice>) {
    choices.sort_by(compare_choices);
    choices.truncate(BEAM_WIDTH);
}

fn length_normalized_score(log_probability: f32, length: usize) -> f32 {
    log_probability / (length.max(1) as f32).powf(BEAM_LENGTH_ALPHA)
}

fn sequence_boundary_reached(value: &str, language_hint: &str) -> bool {
    let trimmed = value.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    let has_chinese = trimmed.chars().any(is_cjk);
    let has_english = trimmed
        .chars()
        .any(|character| character.is_ascii_alphabetic());
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
) -> Option<(String, String)> {
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
        let text: String = trimmed.chars().take(8).collect();
        (text, "zh".to_string())
    } else if has_english {
        if language_hint == "zh" {
            return None;
        }
        let word = trimmed
            .split_whitespace()
            .next()?
            .trim_matches(|character: char| !character.is_ascii_alphabetic() && character != '\'');
        if word.is_empty() || word.chars().count() > 12 {
            return None;
        }
        (word.to_string(), "en".to_string())
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
    if request.context_tail.len() != request.context_tail_utf8_bytes
        || request.context_tail_utf8_bytes > 256
        || request.context_capsule.schema_version != 1
        || request.context_capsule.max_tokens != 256
        || request.context_capsule.heading_trail.len() > 6
        || serialized_capsule(&request.context_capsule).len() > 16 * 1024
        || !matches!(request.language_hint.as_str(), "zh" | "en" | "unknown")
        || request.context_capsule.language_hint != request.language_hint
        || !matches!(request.block_type.as_str(), "paragraph" | "list" | "quote")
        || request.max_candidates > 32
        || now_unix_ms() > request.deadline_at
    {
        return Err("invalid completion decoder request".to_string());
    }
    Ok(())
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
    fn language_boundaries_are_bounded_and_complete() {
        assert!(sequence_boundary_reached("中文补全结果已经足够", "zh"));
        assert!(!sequence_boundary_reached("short", "en"));
        assert!(sequence_boundary_reached("complete next", "en"));
        assert!(sequence_boundary_reached("abcdefghijkl", "en"));
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
        select_best_choices(&mut selected);
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
