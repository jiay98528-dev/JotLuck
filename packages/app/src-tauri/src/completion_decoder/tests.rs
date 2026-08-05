use super::*;

fn capsule() -> DecoderContextCapsule {
    DecoderContextCapsule {
        schema_version: 1,
        max_tokens: 256,
        language_hint: "zh".to_string(),
        heading_trail: vec!["计划".to_string(), "执行".to_string()],
        current_paragraph: "今天先完成运行时".to_string(),
        previous_paragraph_tail: "上一段".to_string(),
        retrieval_snippet: "检索内容".to_string(),
    }
}

fn request() -> DecoderGenerateRequest {
    DecoderGenerateRequest {
        engine_epoch: 1,
        workspace_scope: "workspace-a".to_string(),
        document_version: "revision:3".to_string(),
        cursor_pos: 12,
        context_tail: "今天先完成".to_string(),
        context_tail_utf8_bytes: "今天先完成".len(),
        context_capsule: capsule(),
        language_hint: "zh".to_string(),
        block_type: "paragraph".to_string(),
        cursor_boundary: "other".to_string(),
        max_candidates: 8,
        deadline_at: now_unix_ms() + 1_000,
    }
}

fn manifest() -> DecoderManifest {
    DecoderManifest {
        schema: MANIFEST_SCHEMA.to_string(),
        schema_version: 1,
        engine: ENGINE_ID.to_string(),
        candidate_id: "16m-q4-seed-1".to_string(),
        candidate_artifact_sha256:
            "c495b32518427754777a37246bd28c3445a0c6ec7cad977fa995a226fd216f42".to_string(),
        lifecycle: "oraclePassed".to_string(),
        evaluation_only: true,
        runtime_eligible: true,
        release_eligible: false,
        parameter_count: 16_000_000,
        quantization: "q4".to_string(),
        tokenizer: TokenizerContract {
            kind: "unigram".to_string(),
            vocabulary_size: 8_000,
            byte_fallback: true,
            bilingual: true,
        },
        context: ContextContract {
            maximum_tokens: 256,
        },
        output: OutputContract {
            chinese_maximum_code_points: 8,
            english_maximum_code_points: 12,
            preserve_complete_english_word: true,
        },
        training: TrainingContract {
            cleaned_pool_bytes: 128 * 1024 * 1024,
            license_audit_passed: true,
        },
        oracle_precheck: OraclePrecheck {
            checkpoints: 200,
            oracle_at8: 0.45,
            oracle_at32: 0.55,
            chinese_oracle_at8: 0.4,
            english_oracle_at8: 0.4,
            passed: true,
        },
        assets: DecoderAssets {
            model: DecoderAsset {
                file: "model.q4.bin".to_string(),
                sha256: "a".repeat(64),
                bytes: 8 * 1024 * 1024,
            },
            tokenizer: DecoderAsset {
                file: "tokenizer.unigram.bin".to_string(),
                sha256: "b".repeat(64),
                bytes: 512 * 1024,
            },
        },
        runtime_static_delta_bytes: 2 * 1024 * 1024,
        measured_peak_memory_bytes: 128 * 1024 * 1024,
        release_evidence: None,
    }
}

fn model_envelope(payload: &[u8]) -> Vec<u8> {
    let header = serde_json::json!({
        "schema": QUANTIZED_MODEL_SCHEMA,
        "engine": ENGINE_ID,
        "candidateId": "16m-q4-seed-1",
        "nominalParameterCount": 16_000_000,
        "actualParameterCount": 0,
        "quantization": "q4",
        "vocabularySize": 8_000,
        "maximumContextTokens": 256,
        "architecture": {
            "width": 384,
            "layers": 8,
            "heads": 4,
            "feedForward": 1_024,
            "activation": "gelu",
            "tiedEmbedding": true,
            "layerNormEpsilon": 1e-5,
        },
        "payloadSha256": sha256_bytes(payload),
        "tensors": [],
    });
    let header = serde_json::to_vec(&header).unwrap();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(MODEL_MAGIC);
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(payload);
    bytes
}

fn generated_envelope(request_id: u64) -> CompletionDecoderGenerateEnvelope {
    CompletionDecoderGenerateEnvelope {
        request_id,
        response: DecoderGenerateResponse {
            protocol_version: PROTOCOL_VERSION,
            engine_epoch: 1,
            workspace_scope: "workspace-a".to_string(),
            document_version: "revision:3".to_string(),
            cursor_pos: 12,
            candidates: Vec::new(),
        },
    }
}

#[test]
fn length_prefixed_protocol_round_trips() {
    let frame = HostFrame {
        protocol_version: PROTOCOL_VERSION,
        request_id: 9,
        command: HostCommand::Generate {
            request: Box::new(request()),
        },
    };
    let mut bytes = Vec::new();
    write_frame(&mut bytes, &frame).unwrap();
    let decoded: HostFrame = read_frame(&mut bytes.as_slice()).unwrap();
    assert_eq!(decoded.protocol_version, PROTOCOL_VERSION);
    assert_eq!(decoded.request_id, 9);
}

#[test]
fn rejects_oversized_or_mixed_context() {
    let mut invalid = request();
    invalid.language_hint = "mixed".to_string();
    assert!(validate_generate_request(&invalid).is_err());
    let mut oversized = request();
    oversized.context_capsule.current_paragraph = "x".repeat(17 * 1024);
    assert!(validate_generate_request(&oversized).is_err());
}

#[test]
fn capsule_serialization_matches_typescript_golden() {
    assert_eq!(
            serialized_capsule(&capsule()),
            "<heading>计划</heading>\n<heading>执行</heading>\n<previous>上一段</previous>\n<retrieval>检索内容</retrieval>\n<current>今天先完成运行时</current>"
        );
}

#[test]
fn latest_only_cancellation_abstains() {
    let latest = AtomicU64::new(2);
    assert!(request_is_stale(1, &request(), &latest));
}

#[test]
fn deadline_is_enforced_before_inference() {
    let mut expired = request();
    expired.deadline_at = now_unix_ms().saturating_sub(1);
    let latest = AtomicU64::new(1);
    assert!(validate_generate_request(&expired).is_err());
    assert!(request_is_stale(1, &expired, &latest));
}

#[test]
fn frame_rejects_invalid_lengths() {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&((MAX_FRAME_BYTES as u32) + 1).to_le_bytes());
    assert!(read_frame::<HostFrame>(&mut bytes.as_slice()).is_err());
}

#[test]
fn memory_limit_is_exact_contract_value() {
    assert_eq!(PEAK_MEMORY_LIMIT_BYTES, 192 * 1024 * 1024);
}

#[test]
fn candidate_artifact_hash_matches_the_typescript_contract() {
    assert!(validate_candidate_artifact_identity(&manifest()).is_ok());
    let mut changed = manifest();
    changed.assets.model.bytes += 1;
    assert!(validate_candidate_artifact_identity(&changed).is_err());
}

#[test]
fn corrupted_or_incomplete_quantized_models_fail_closed() {
    let payload = b"bound payload";
    let incomplete = model_envelope(payload);
    assert!(validate_quantized_decoder_bytes(&incomplete, &manifest())
        .unwrap_err()
        .contains("payload coverage"));

    let mut corrupted = model_envelope(payload);
    *corrupted.last_mut().unwrap() ^= 0x01;
    assert!(validate_quantized_decoder_bytes(&corrupted, &manifest())
        .unwrap_err()
        .contains("payload SHA-256"));

    let mut bad_magic = model_envelope(payload);
    bad_magic[0] ^= 0x01;
    assert!(validate_quantized_decoder_bytes(&bad_magic, &manifest())
        .unwrap_err()
        .contains("magic"));
}

#[test]
fn late_worker_responses_never_settle_the_latest_request() {
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    let mut active = Some((2, now_unix_ms() + 1_000, response_tx));
    settle_worker_frame(
        WorkerFrame {
            protocol_version: PROTOCOL_VERSION,
            request_id: 1,
            event: WorkerEvent::Generated(generated_envelope(1)),
        },
        &mut active,
    );
    assert!(active.is_some());
    assert!(response_rx.try_recv().is_err());

    settle_worker_frame(
        WorkerFrame {
            protocol_version: PROTOCOL_VERSION,
            request_id: 2,
            event: WorkerEvent::Generated(generated_envelope(2)),
        },
        &mut active,
    );
    assert!(active.is_none());
    assert_eq!(response_rx.recv().unwrap().unwrap().request_id, 2);
}

#[test]
fn worker_crash_fails_the_active_request() {
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    let mut active = Some((7, now_unix_ms() + 1_000, response_tx));
    settle_worker_failure("pipe closed", &mut active);
    assert!(active.is_none());
    assert!(response_rx
        .recv()
        .unwrap()
        .unwrap_err()
        .contains("completion worker crashed: pipe closed"));
}
