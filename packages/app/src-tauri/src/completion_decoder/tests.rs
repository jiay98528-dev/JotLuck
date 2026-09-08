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
        code_suffix: String::new(),
        code_language: String::new(),
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
        context_suffix: String::new(),
        code_language: String::new(),
        context_capsule: capsule(),
        language_hint: "zh".to_string(),
        block_type: "paragraph".to_string(),
        cursor_boundary: "other".to_string(),
        max_candidates: 8,
        search_beam_width: None,
        editor_session_id: None,
        document_session_id: None,
        document_revision: None,
        search_mode: None,
        personal_prior: None,
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
        distribution_policy: None,
        route: None,
        matrix_id: None,
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
            dataset_recipe: None,
            dataset_manifest_sha256: None,
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
        adaptive_thresholds: None,
        release_evidence: None,
    }
}

fn block_manifest() -> DecoderManifest {
    let mut value = manifest();
    value.schema = BLOCK_MANIFEST_SCHEMA.to_string();
    value.engine = BLOCK_ENGINE_ID.to_string();
    let canonical = format!(
        "{{\"candidateId\":\"{}\",\"engine\":\"{}\",\"model\":{{\"bytes\":{},\"sha256\":\"{}\"}},\"parameterCount\":{},\"quantization\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"sha256\":\"{}\"}}}}",
        value.candidate_id,
        value.engine,
        value.assets.model.bytes,
        value.assets.model.sha256,
        value.parameter_count,
        value.quantization,
        value.assets.tokenizer.bytes,
        value.assets.tokenizer.sha256,
    );
    value.candidate_artifact_sha256 = sha256_bytes(canonical.as_bytes());
    value
}

fn routed_manifest(route: &str) -> DecoderManifest {
    let mut value = manifest();
    value.schema = ROUTED_MANIFEST_SCHEMA.to_string();
    value.engine = match route {
        "code" => ROUTED_CODE_ENGINE_ID,
        "writing" => ROUTED_WRITING_ENGINE_ID,
        "joint" => ROUTED_JOINT_ENGINE_ID,
        _ => panic!("unsupported routed manifest fixture"),
    }
    .to_string();
    value.route = Some(route.to_string());
    value.matrix_id = Some(if route == "code" { "24m-q4" } else { "32m-q4" }.to_string());
    value.parameter_count = if route == "code" {
        24_000_000
    } else {
        32_000_000
    };
    value.lifecycle = "trained".to_string();
    value.oracle_precheck = OraclePrecheck {
        checkpoints: 0,
        oracle_at8: 0.0,
        oracle_at32: 0.0,
        chinese_oracle_at8: 0.0,
        english_oracle_at8: 0.0,
        passed: false,
    };
    value.output = if matches!(route, "code" | "joint") {
        OutputContract {
            chinese_maximum_code_points: 32,
            english_maximum_code_points: 32,
            preserve_complete_english_word: false,
        }
    } else {
        OutputContract {
            chinese_maximum_code_points: 16,
            english_maximum_code_points: 24,
            preserve_complete_english_word: true,
        }
    };
    value.assets.model.file = format!("{route}.q4.routed.decoder.bin");
    value.assets.tokenizer.file = "tokenizer.runtime.json".to_string();
    let canonical = format!(
        "{{\"candidateId\":\"{}\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
        value.candidate_id,
        value.engine,
        value.matrix_id.as_deref().unwrap(),
        value.assets.model.bytes,
        value.assets.model.file,
        value.assets.model.sha256,
        route,
        value.assets.tokenizer.bytes,
        value.assets.tokenizer.file,
        value.assets.tokenizer.sha256,
    );
    value.candidate_artifact_sha256 = sha256_bytes(canonical.as_bytes());
    value
}

fn one_unit_writing_manifest() -> DecoderManifest {
    let mut value = routed_manifest("writing");
    value.engine = V25_ONE_UNIT_WRITING_ENGINE_ID.to_string();
    value.candidate_id = "v25-one-unit-writing-q4-test".to_string();
    value.tokenizer.vocabulary_size = 12_000;
    value.output = OutputContract {
        chinese_maximum_code_points: 4,
        english_maximum_code_points: 24,
        preserve_complete_english_word: true,
    };
    value.training.license_audit_passed = false;
    value.training.dataset_recipe = Some("v25-one-unit-writing-eos-v2".to_string());
    value.distribution_policy = Some("local-research-only".to_string());
    value.runtime_static_delta_bytes = 0;
    value.measured_peak_memory_bytes = 0;
    value.adaptive_thresholds = Some(AdaptiveBeamThresholds {
        floor: 0.01,
        margin_floor: 0.001,
    });
    let canonical = format!(
        "{{\"adaptiveThresholds\":{{\"floor\":0.01,\"marginFloor\":0.001}},\"candidateId\":\"{}\",\"datasetManifestSha256\":\"\",\"datasetRecipe\":\"v25-one-unit-writing-eos-v2\",\"distributionPolicy\":\"local-research-only\",\"engine\":\"{}\",\"matrixId\":\"32m-q4\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"writing\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
        value.candidate_id,
        value.engine,
        value.assets.model.bytes,
        value.assets.model.file,
        value.assets.model.sha256,
        value.assets.tokenizer.bytes,
        value.assets.tokenizer.file,
        value.assets.tokenizer.sha256,
    );
    value.candidate_artifact_sha256 = sha256_bytes(canonical.as_bytes());
    value
}

fn routed_model_envelope(payload: &[u8], manifest: &DecoderManifest) -> Vec<u8> {
    let (width, layers, heads, feed_forward) = matrix_architecture(manifest).unwrap();
    let header = serde_json::json!({
        "schema": QUANTIZED_ROUTED_MODEL_SCHEMA,
        "engine": manifest.engine,
        "route": manifest.route,
        "candidateId": manifest.candidate_id,
        "nominalParameterCount": manifest.parameter_count,
        "actualParameterCount": manifest.parameter_count,
        "quantization": manifest.quantization,
        "vocabularySize": manifest.tokenizer.vocabulary_size,
        "maximumContextTokens": 256,
        "architecture": {
            "width": width,
            "layers": layers,
            "heads": heads,
            "feedForward": feed_forward,
            "activation": "gelu",
            "tiedEmbedding": true,
            "layerNormEpsilon": 1e-5,
        },
        "payloadSha256": sha256_bytes(payload),
        "tensors": [],
    });
    let header = serde_json::to_vec(&header).unwrap();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(ROUTED_MODEL_MAGIC);
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(payload);
    bytes
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
            diagnostics: None,
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
    let mut invalid_tokens = request();
    invalid_tokens.context_capsule.max_tokens = 0;
    assert!(validate_generate_request(&invalid_tokens).is_err());
    invalid_tokens.context_capsule.max_tokens = 257;
    assert!(validate_generate_request(&invalid_tokens).is_err());
}

#[test]
fn code_request_uses_the_public_engine_top_level_fim_fields() {
    let mut code = request();
    code.block_type = "code".to_string();
    code.language_hint = "unknown".to_string();
    code.context_capsule.language_hint = "unknown".to_string();
    code.context_suffix = "(value)".to_string();
    code.code_language = "rust".to_string();
    assert!(validate_generate_request(&code).is_ok());

    code.context_capsule.code_suffix = "different".to_string();
    assert!(validate_generate_request(&code).is_err());
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
fn search_mode_is_independent_from_optional_session_identity() {
    let mut value = request();
    value.search_mode = Some("fixed-1".to_string());
    assert!(validate_generate_request(&value).is_ok());

    value.editor_session_id = Some("editor-a".to_string());
    assert!(validate_generate_request(&value).is_err());
    value.document_session_id = Some("document-a".to_string());
    value.document_revision = Some(1);
    assert!(validate_generate_request(&value).is_ok());
}

#[test]
fn candidate_artifact_hash_matches_the_typescript_contract() {
    assert!(validate_candidate_artifact_identity(&manifest()).is_ok());
    let mut changed = manifest();
    changed.assets.model.bytes += 1;
    assert!(validate_candidate_artifact_identity(&changed).is_err());
}

#[test]
fn block_candidate_contract_uses_its_own_engine_identity() {
    let candidate = block_manifest();
    assert!(validate_manifest(&candidate, 1_024).is_ok());
    assert!(validate_candidate_artifact_identity(&candidate).is_ok());
}

#[test]
fn routed_candidate_contract_binds_route_matrix_and_magic() {
    for route in ["code", "writing"] {
        let candidate = routed_manifest(route);
        assert!(validate_manifest(&candidate, 1_024).is_ok());
        assert!(validate_candidate_artifact_identity(&candidate).is_ok());
        let bytes = routed_model_envelope(b"routed payload", &candidate);
        let (header, payload) = parse_quantized_decoder_envelope(&bytes).unwrap();
        assert_eq!(header.schema, QUANTIZED_ROUTED_MODEL_SCHEMA);
        assert_eq!(payload, b"routed payload");
    }
}

#[test]
fn v25_one_unit_writing_contract_accepts_12k_without_claiming_code() {
    let candidate = one_unit_writing_manifest();
    assert!(validate_manifest(&candidate, 1_024).is_ok());
    assert!(validate_candidate_artifact_identity(&candidate).is_ok());
    assert!(is_v25_one_unit_runtime(&candidate));

    let bytes = routed_model_envelope(b"one-unit payload", &candidate);
    let (header, payload) = parse_quantized_decoder_envelope(&bytes).unwrap();
    assert_eq!(header.engine, V25_ONE_UNIT_WRITING_ENGINE_ID);
    assert_eq!(header.route.as_deref(), Some("writing"));
    assert_eq!(header.vocabulary_size, 12_000);
    assert_eq!(payload, b"one-unit payload");
}

#[test]
fn v241_local_research_writing_candidate_is_evaluation_only() {
    let mut candidate = routed_manifest("writing");
    candidate.candidate_id = "public-v2.4.1-writing-corpus-probe-32m-q4-12a1f4a254b3".to_string();
    candidate.training.license_audit_passed = false;
    candidate.training.dataset_recipe = Some("v241-natural-short-ghost-v1".to_string());
    candidate.training.dataset_manifest_sha256 =
        Some("9b9789d918942a8f6b57cec5761008abc3071dee82f3d9900f98231e7350e710".to_string());
    candidate.distribution_policy = Some("local-research-only".to_string());
    let canonical = format!(
        "{{\"candidateId\":\"{}\",\"datasetManifestSha256\":\"{}\",\"datasetRecipe\":\"v241-natural-short-ghost-v1\",\"distributionPolicy\":\"local-research-only\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"writing\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
        candidate.candidate_id,
        candidate
            .training
            .dataset_manifest_sha256
            .as_deref()
            .unwrap(),
        candidate.engine,
        candidate.matrix_id.as_deref().unwrap(),
        candidate.assets.model.bytes,
        candidate.assets.model.file,
        candidate.assets.model.sha256,
        candidate.assets.tokenizer.bytes,
        candidate.assets.tokenizer.file,
        candidate.assets.tokenizer.sha256,
    );
    candidate.candidate_artifact_sha256 = sha256_bytes(canonical.as_bytes());
    assert!(validate_manifest(&candidate, 1_024).is_ok());
    assert!(validate_candidate_artifact_identity(&candidate).is_ok());

    candidate.training.dataset_manifest_sha256 = Some("f".repeat(64));
    assert!(validate_candidate_artifact_identity(&candidate).is_err());
    candidate.training.dataset_manifest_sha256 =
        Some("9b9789d918942a8f6b57cec5761008abc3071dee82f3d9900f98231e7350e710".to_string());

    candidate.release_eligible = true;
    assert!(validate_manifest(&candidate, 1_024).is_err());
}

#[test]
fn v25_joint_dense_candidate_is_local_evaluation_only() {
    let mut candidate = routed_manifest("joint");
    candidate.candidate_id = "v25-dense-local-evaluation".to_string();
    candidate.lifecycle = "trained".to_string();
    candidate.parameter_count = 32_000_000;
    candidate.matrix_id = Some("32m-q4".to_string());
    candidate.training.license_audit_passed = false;
    candidate.training.dataset_recipe = Some("v25-contract-first-short-ghost-v1".to_string());
    candidate.distribution_policy = Some("local-research-only".to_string());
    candidate.adaptive_thresholds = Some(AdaptiveBeamThresholds {
        floor: 0.287,
        margin_floor: 0.173,
    });
    candidate.oracle_precheck = OraclePrecheck {
        checkpoints: 0,
        oracle_at8: 0.0,
        oracle_at32: 0.0,
        chinese_oracle_at8: 0.0,
        english_oracle_at8: 0.0,
        passed: false,
    };
    let canonical = format!(
        "{{\"adaptiveThresholds\":{{\"floor\":0.3,\"marginFloor\":0.2}},\"candidateId\":\"{}\",\"datasetManifestSha256\":\"\",\"datasetRecipe\":\"v25-contract-first-short-ghost-v1\",\"distributionPolicy\":\"local-research-only\",\"engine\":\"{}\",\"matrixId\":\"32m-q4\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"joint\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
        candidate.candidate_id,
        candidate.engine,
        candidate.assets.model.bytes,
        candidate.assets.model.file,
        candidate.assets.model.sha256,
        candidate.assets.tokenizer.bytes,
        candidate.assets.tokenizer.file,
        candidate.assets.tokenizer.sha256,
    );
    candidate.candidate_artifact_sha256 = sha256_bytes(canonical.as_bytes());

    assert!(validate_manifest(&candidate, 1_024).is_ok());
    assert!(validate_candidate_artifact_identity(&candidate).is_ok());

    candidate.candidate_id.clear();
    candidate.candidate_artifact_sha256 = "advisory-only".to_string();
    candidate.assets.model.sha256.clear();
    candidate.assets.tokenizer.sha256 = "not-a-digest".to_string();
    assert!(validate_manifest(&candidate, 1_024).is_ok());
    assert!(validate_candidate_artifact_identity(&candidate).is_ok());

    candidate.release_eligible = true;
    candidate.runtime_eligible = false;
    candidate.evaluation_only = false;
    candidate.lifecycle = "diagnostic-label-only".to_string();
    candidate.schema = "renamed-diagnostic-schema".to_string();
    candidate.schema_version = 999;
    candidate.training.dataset_recipe = Some("renamed-recipe".to_string());
    candidate.training.cleaned_pool_bytes = u64::MAX;
    candidate.measured_peak_memory_bytes = u64::MAX;
    candidate.runtime_static_delta_bytes = u64::MAX;
    assert!(validate_manifest(&candidate, 1_024).is_ok());
}

#[test]
fn v25_joint_payload_digest_is_advisory_but_structure_remains_parseable() {
    let candidate = {
        let mut value = routed_manifest("joint");
        value.parameter_count = 32_000_000;
        value.matrix_id = Some("32m-q4".to_string());
        value
    };
    let mut bytes = routed_model_envelope(b"joint payload", &candidate);
    *bytes.last_mut().unwrap() ^= 0x01;
    let (header, payload) = parse_quantized_decoder_envelope(&bytes).unwrap();
    assert_eq!(header.route.as_deref(), Some("joint"));
    assert_eq!(payload.len(), b"joint payload".len());
}

#[test]
fn unlicensed_candidates_without_the_exact_v241_research_contract_are_rejected() {
    let mut candidate = routed_manifest("writing");
    candidate.training.license_audit_passed = false;
    assert!(validate_manifest(&candidate, 1_024).is_err());

    candidate.distribution_policy = Some("local-research-only".to_string());
    assert!(validate_manifest(&candidate, 1_024).is_err());

    candidate.candidate_id = "public-v2.4.1-writing-corpus-probe-32m-q4-12a1f4a254b3".to_string();
    candidate.training.dataset_recipe = Some("v241-natural-short-ghost-v1".to_string());
    candidate.training.dataset_manifest_sha256 = Some("f".repeat(64));
    candidate.distribution_policy = Some("publishable".to_string());
    assert!(validate_manifest(&candidate, 1_024).is_err());
}

#[test]
fn routed_candidate_adaptive_thresholds_are_canonical_and_identity_bound() {
    let mut candidate = routed_manifest("writing");
    candidate.adaptive_thresholds = Some(AdaptiveBeamThresholds {
        floor: 0.3,
        margin_floor: 0.2,
    });
    let canonical = format!(
        "{{\"adaptiveThresholds\":{{\"floor\":0.3,\"marginFloor\":0.2}},\"candidateId\":\"{}\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"writing\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
        candidate.candidate_id,
        candidate.engine,
        candidate.matrix_id.as_deref().unwrap(),
        candidate.assets.model.bytes,
        candidate.assets.model.file,
        candidate.assets.model.sha256,
        candidate.assets.tokenizer.bytes,
        candidate.assets.tokenizer.file,
        candidate.assets.tokenizer.sha256,
    );
    candidate.candidate_artifact_sha256 = sha256_bytes(canonical.as_bytes());
    assert!(validate_manifest(&candidate, 1_024).is_ok());
    assert!(validate_candidate_artifact_identity(&candidate).is_ok());
    candidate.adaptive_thresholds.as_mut().unwrap().floor = 0.4;
    assert!(validate_candidate_artifact_identity(&candidate).is_err());
}

fn writing_mtp_manifest() -> WritingMtpManifest {
    let mut value = serde_json::json!({
        "schema": WRITING_MTP_MANIFEST_SCHEMA,
        "format": WRITING_MTP_FORMAT,
        "engine": WRITING_MTP_ENGINE_ID,
        "candidateId": "writing-mtp-wm4-20260812",
        "candidateArtifactSha256": "0".repeat(64),
        "route": "writing",
        "blockSize": 4,
        "modelSha256": "a".repeat(64),
        "tokenizerSha256": "b".repeat(64),
        "parameterCount": 33_575_936_u64,
        "additionalParameterCount": 1_575_936_u64,
        "staticAssetBytes": 12 * 1024 * 1024_u64,
        "assets": {
            "model": {"file": "model.bin", "sha256": "a".repeat(64), "bytes": 10},
            "tokenizer": {"file": "tokenizer.runtime.json", "sha256": "b".repeat(64), "bytes": 10}
        },
        "adaptiveThresholds": {"floor": 0.3, "marginFloor": 0.2},
        "evaluationOnly": true,
    });
    let canonical = "{\"adaptiveThresholds\":{\"floor\":0.3,\"marginFloor\":0.2},\"blockSize\":4,\"candidateId\":\"writing-mtp-wm4-20260812\",\"engine\":\"public-v2.4-writing-mtp-v1\",\"format\":\"JLFDQ05\",\"modelSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"route\":\"writing\",\"tokenizerSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}";
    value["candidateArtifactSha256"] = serde_json::json!(sha256_bytes(canonical.as_bytes()));
    serde_json::from_value(value).unwrap()
}

#[test]
fn writing_mtp_manifest_is_evaluation_only_and_threshold_bound() {
    let manifest = writing_mtp_manifest();
    assert!(validate_writing_mtp_manifest(&manifest).is_ok());
    let mut changed = serde_json::to_value(manifest).unwrap();
    changed["adaptiveThresholds"]["floor"] = serde_json::json!(0.4);
    let changed: WritingMtpManifest = serde_json::from_value(changed).unwrap();
    assert!(validate_writing_mtp_manifest(&changed).is_err());
}

#[test]
fn writing_mtp_model_validation_rejects_non_jlfdq05_bytes() {
    assert!(
        validate_writing_mtp_model_bytes(b"not-a-jlfdq05-model", &writing_mtp_manifest())
            .unwrap_err()
            .contains("magic")
    );
}

#[test]
fn evaluation_manifest_path_accepts_any_explicit_absolute_location() {
    assert!(validate_evaluation_manifest_path(Path::new(
        "C:/sandbox/autocomplete-v2.5/output/candidate.manifest.json"
    ))
    .is_ok());
    assert!(validate_evaluation_manifest_path(Path::new(
        "relative/output/candidate.manifest.json"
    ))
    .is_err());
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
