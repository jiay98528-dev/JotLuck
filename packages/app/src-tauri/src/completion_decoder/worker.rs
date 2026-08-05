use super::*;

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
    let should_stop = || request_is_stale(request_id, request, latest_request);
    let capsule = serialized_capsule(&request.context_capsule);
    let tokens = runtime.encode_context(&capsule);
    if tokens.is_empty() {
        return Err("decoder tokenizer returned an empty context".to_string());
    }
    let scores = match runtime.top_tokens(&tokens, request.max_candidates.min(32), &should_stop) {
        Ok(scores) => scores,
        Err(_) if should_stop() => return Ok(None),
        Err(error) => return Err(error),
    };
    if should_stop() {
        return Ok(None);
    }
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for (rank, score) in scores.into_iter().enumerate() {
        if runtime.is_terminal(score.token_id) {
            continue;
        }
        let decoded = runtime.decode_tokens(&[score.token_id]);
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
        candidates.push(DecoderRawCandidate {
            candidate_id: format!("{}-{rank}", request_id),
            text,
            confidence: f64::from(score.probability.clamp(0.0, 1.0)),
            model_score: f64::from(score.log_probability),
            gate_score: f64::from(score.probability.clamp(0.0, 1.0)),
            language,
        });
    }
    Ok(Some(DecoderGenerateResponse {
        protocol_version: PROTOCOL_VERSION,
        engine_epoch: request.engine_epoch,
        workspace_scope: request.workspace_scope.clone(),
        document_version: request.document_version.clone(),
        cursor_pos: request.cursor_pos,
        candidates,
    }))
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
