use super::*;

pub(super) fn load_candidate(manifest_path: &Path) -> Result<LoadedCandidate, String> {
    let manifest_path = manifest_path
        .canonicalize()
        .map_err(|error| format!("unable to resolve decoder manifest: {error}"))?;
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("unable to read decoder manifest: {error}"))?;
    if manifest_bytes.is_empty() || manifest_bytes.len() > 256 * 1024 {
        return Err("decoder manifest byte length is invalid".to_string());
    }
    let parent = manifest_path
        .parent()
        .ok_or_else(|| "decoder manifest has no parent directory".to_string())?;
    let schema = serde_json::from_slice::<serde_json::Value>(&manifest_bytes)
        .ok()
        .and_then(|value| value.get("schema")?.as_str().map(str::to_string));
    let manifest = if schema.as_deref() == Some(WRITING_MTP_MANIFEST_SCHEMA) {
        let writing: WritingMtpManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("invalid Writing MTP manifest JSON: {error}"))?;
        validate_writing_mtp_manifest(&writing)?;
        validate_asset(parent, &writing.assets.model, true)?;
        validate_asset(parent, &writing.assets.tokenizer, true)?;
        let model_bytes = fs::read(parent.join(&writing.assets.model.file))
            .map_err(|error| format!("unable to read Writing MTP model: {error}"))?;
        validate_writing_mtp_model_bytes(&model_bytes, &writing)?;
        normalize_writing_mtp_manifest(&writing)
    } else {
        let manifest: DecoderManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("invalid decoder manifest JSON: {error}"))?;
        validate_manifest(&manifest, manifest_bytes.len() as u64)?;
        let require_digest = !is_v25_joint_runtime(&manifest);
        validate_asset(parent, &manifest.assets.model, require_digest)?;
        validate_asset(parent, &manifest.assets.tokenizer, require_digest)?;
        validate_candidate_artifact_identity(&manifest)?;
        validate_quantized_decoder_asset(parent, &manifest.assets.model, &manifest)?;
        manifest
    };
    let runtime = Arc::new(DecoderRuntime::load(
        &parent.join(&manifest.assets.model.file),
        &parent.join(&manifest.assets.tokenizer.file),
    )?);
    Ok(LoadedCandidate {
        manifest,
        manifest_path,
        manifest_bytes: manifest_bytes.len() as u64,
        runtime,
    })
}

pub(super) fn validate_manifest(
    manifest: &DecoderManifest,
    manifest_bytes: u64,
) -> Result<(), String> {
    let matrix_valid = matches!(
        (manifest.parameter_count, manifest.quantization.as_str()),
        (16_000_000, "q4") | (24_000_000, "q4") | (32_000_000, "q4") | (16_000_000, "q8")
    );
    let base_contract = manifest.schema == MANIFEST_SCHEMA && manifest.engine == ENGINE_ID;
    let block_contract =
        manifest.schema == BLOCK_MANIFEST_SCHEMA && manifest.engine == BLOCK_ENGINE_ID;
    let v25_joint_runtime = is_v25_joint_runtime(manifest);
    let v25_one_unit_runtime = is_v25_one_unit_runtime(manifest);
    let routed_contract = is_routed_manifest(manifest) || v25_joint_runtime;
    let output_valid = if v25_one_unit_runtime {
        manifest.output.chinese_maximum_code_points == 4
            && manifest.output.english_maximum_code_points == 24
            && manifest.output.preserve_complete_english_word
    } else if routed_contract {
        matches!(
            (
                manifest.route.as_deref(),
                manifest.output.chinese_maximum_code_points,
                manifest.output.english_maximum_code_points,
                manifest.output.preserve_complete_english_word,
            ),
            (Some("code"), 32, 32, false)
                | (Some("writing"), 16, 24, true)
                | (Some("joint"), 32, 32, false)
        )
    } else {
        manifest.output.chinese_maximum_code_points == 8
            && manifest.output.english_maximum_code_points == 12
            && manifest.output.preserve_complete_english_word
    };
    if (!base_contract && !block_contract && !routed_contract)
        || (!v25_joint_runtime && manifest.schema_version != 1)
        || (!v25_joint_runtime
            && (!valid_identifier(&manifest.candidate_id)
                || !valid_sha256(&manifest.candidate_artifact_sha256)))
        || (!v25_joint_runtime && !manifest.runtime_eligible)
        || (!v25_joint_runtime && !valid_manifest_lifecycle(manifest))
        || !matrix_valid
        || manifest.tokenizer.kind != "unigram"
        || manifest.tokenizer.vocabulary_size != if v25_one_unit_runtime { 12_000 } else { 8_000 }
        || !manifest.tokenizer.byte_fallback
        || !manifest.tokenizer.bilingual
        || manifest.context.maximum_tokens != 256
        || !output_valid
        || (!v25_joint_runtime && manifest.training.cleaned_pool_bytes > TRAINING_POOL_LIMIT_BYTES)
        || (!v25_joint_runtime && !valid_training_data_policy(manifest))
        || (!v25_joint_runtime
            && manifest.measured_peak_memory_bytes > PEAK_MEMORY_LIMIT_BYTES as u64)
        || (routed_contract
            && !v25_joint_runtime
            && !is_v25_one_unit_runtime(manifest)
            && manifest.release_eligible)
    {
        return Err("decoder manifest contract is invalid".to_string());
    }
    let static_bytes = manifest_bytes
        .saturating_add(manifest.assets.model.bytes)
        .saturating_add(manifest.assets.tokenizer.bytes)
        .saturating_add(manifest.runtime_static_delta_bytes);
    if !v25_joint_runtime && static_bytes > STATIC_LIMIT_BYTES {
        return Err("decoder candidate exceeds the 24 MiB static budget".to_string());
    }
    Ok(())
}

fn valid_training_data_policy(manifest: &DecoderManifest) -> bool {
    if manifest.training.license_audit_passed {
        return manifest.distribution_policy.is_none()
            && manifest.training.dataset_recipe.is_none()
            && manifest.training.dataset_manifest_sha256.is_none();
    }

    let v25_joint_evaluation = is_routed_manifest(manifest)
        && manifest.route.as_deref() == Some("joint")
        && manifest.engine == ROUTED_JOINT_ENGINE_ID
        && manifest.matrix_id.as_deref() == Some("32m-q4")
        && manifest.training.dataset_recipe.as_deref() == Some("v25-contract-first-short-ghost-v1");
    let v25_one_unit_evaluation = is_v25_one_unit_runtime(manifest)
        && manifest.training.dataset_recipe.as_deref() == Some("v25-one-unit-writing-eos-v2");
    let v241_writing_evaluation = is_routed_manifest(manifest)
        && manifest.route.as_deref() == Some("writing")
        && manifest.matrix_id.as_deref() == Some("32m-q4")
        && manifest.training.dataset_recipe.as_deref() == Some("v241-natural-short-ghost-v1");

    if v25_joint_evaluation {
        return manifest.distribution_policy.as_deref() == Some("local-research-only");
    }
    if v25_one_unit_evaluation {
        let evaluation_release = manifest.lifecycle == "trained"
            && manifest.evaluation_only
            && manifest.runtime_eligible
            && !manifest.release_eligible
            && manifest.release_evidence.is_none();
        // Integration release: shipped by an explicit integration decision
        // instead of the publisher pipeline; no release evidence exists and
        // none may be fabricated.
        let integration_release = manifest.lifecycle == "integrationRelease"
            && !manifest.evaluation_only
            && manifest.runtime_eligible
            && manifest.release_eligible
            && manifest.release_evidence.is_none();
        return manifest.distribution_policy.as_deref() == Some("local-research-only")
            && (evaluation_release || integration_release);
    }
    manifest.distribution_policy.as_deref() == Some("local-research-only")
        && manifest.lifecycle == "trained"
        && manifest.evaluation_only
        && manifest.runtime_eligible
        && !manifest.release_eligible
        && manifest.release_evidence.is_none()
        && v241_writing_evaluation
}

fn is_routed_manifest(manifest: &DecoderManifest) -> bool {
    let route_engine_valid = matches!(
        (manifest.route.as_deref(), manifest.engine.as_str()),
        (Some("code"), ROUTED_CODE_ENGINE_ID)
            | (Some("writing"), ROUTED_WRITING_ENGINE_ID)
            | (Some("writing"), V25_ONE_UNIT_WRITING_ENGINE_ID)
            | (Some("joint"), ROUTED_JOINT_ENGINE_ID)
    );
    let matrix_valid = matches!(
        (
            manifest.matrix_id.as_deref(),
            manifest.parameter_count,
            manifest.quantization.as_str(),
        ),
        (Some("16m-q4"), 16_000_000, "q4")
            | (Some("24m-q4"), 24_000_000, "q4")
            | (Some("32m-q4"), 32_000_000, "q4")
    );
    manifest.schema == ROUTED_MANIFEST_SCHEMA
        && route_engine_valid
        && matrix_valid
        && valid_adaptive_thresholds(manifest.adaptive_thresholds.as_ref())
}

pub(super) fn is_v25_joint_runtime(manifest: &DecoderManifest) -> bool {
    manifest.route.as_deref() == Some("joint")
        && manifest.engine == ROUTED_JOINT_ENGINE_ID
        && manifest.matrix_id.as_deref() == Some("32m-q4")
        && manifest.parameter_count == 32_000_000
        && manifest.quantization == "q4"
        && valid_adaptive_thresholds(manifest.adaptive_thresholds.as_ref())
}

pub(super) fn is_v25_one_unit_runtime(manifest: &DecoderManifest) -> bool {
    manifest.route.as_deref() == Some("writing")
        && manifest.engine == V25_ONE_UNIT_WRITING_ENGINE_ID
        && manifest.matrix_id.as_deref() == Some("32m-q4")
        && manifest.parameter_count == 32_000_000
        && manifest.quantization == "q4"
        && valid_adaptive_thresholds(manifest.adaptive_thresholds.as_ref())
}

fn valid_adaptive_thresholds(value: Option<&AdaptiveBeamThresholds>) -> bool {
    value.is_none_or(|thresholds| {
        thresholds.floor.is_finite()
            && (0.0..=1.0).contains(&thresholds.floor)
            && thresholds.margin_floor.is_finite()
            && (0.0..=1.0).contains(&thresholds.margin_floor)
    })
}

pub(super) fn valid_manifest_lifecycle(manifest: &DecoderManifest) -> bool {
    match manifest.lifecycle.as_str() {
        "trained" => {
            manifest.evaluation_only
                && manifest.runtime_eligible
                && !manifest.release_eligible
                && manifest.release_evidence.is_none()
                && oracle_unclaimed(&manifest.oracle_precheck)
        }
        "oraclePassed" => {
            manifest.evaluation_only
                && manifest.runtime_eligible
                && !manifest.release_eligible
                && manifest.release_evidence.is_none()
                && oracle_passed(&manifest.oracle_precheck)
        }
        "releaseEligible" => {
            !manifest.evaluation_only
                && manifest.runtime_eligible
                && manifest.release_eligible
                && oracle_passed(&manifest.oracle_precheck)
                && manifest.release_evidence.as_ref().is_some_and(|evidence| {
                    evidence.schema == "jotluck.autocomplete.public-free-decoder-release.v1"
                        && valid_sha256(&evidence.cold_final_sha256)
                        && valid_sha256(&evidence.workspace_final_sha256)
                        && valid_sha256(&evidence.windows_gui_evidence_sha256)
                        && valid_sha256(&evidence.baseline_sha256)
                })
        }
        "integrationRelease" => {
            !manifest.evaluation_only
                && manifest.runtime_eligible
                && manifest.release_eligible
                && manifest.release_evidence.is_none()
        }
        _ => false,
    }
}

pub(super) fn oracle_unclaimed(oracle: &OraclePrecheck) -> bool {
    oracle.checkpoints == 0
        && oracle.oracle_at8 == 0.0
        && oracle.oracle_at32 == 0.0
        && oracle.chinese_oracle_at8 == 0.0
        && oracle.english_oracle_at8 == 0.0
        && !oracle.passed
}

pub(super) fn oracle_passed(oracle: &OraclePrecheck) -> bool {
    oracle.checkpoints > 0
        && oracle.oracle_at8 >= 0.45
        && oracle.oracle_at32 >= 0.55
        && oracle.chinese_oracle_at8 >= 0.40
        && oracle.english_oracle_at8 >= 0.40
        && oracle.passed
        && [
            oracle.oracle_at8,
            oracle.oracle_at32,
            oracle.chinese_oracle_at8,
            oracle.english_oracle_at8,
        ]
        .iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
}

pub(super) fn validate_asset(
    parent: &Path,
    asset: &DecoderAsset,
    require_digest: bool,
) -> Result<(), String> {
    if !valid_asset_name(&asset.file)
        || (require_digest && (!valid_sha256(&asset.sha256) || asset.bytes == 0))
    {
        return Err("decoder asset descriptor is invalid".to_string());
    }
    let path = parent.join(&asset.file);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("decoder asset is unavailable: {error}"))?;
    if canonical.parent() != Some(parent) {
        return Err("decoder asset escapes its candidate directory".to_string());
    }
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("unable to inspect decoder asset: {error}"))?;
    if !metadata.is_file()
        || metadata.len() == 0
        || (require_digest && metadata.len() != asset.bytes)
    {
        return Err("decoder asset byte length mismatch".to_string());
    }
    if require_digest && sha256_file(&canonical)? != asset.sha256 {
        return Err("decoder asset SHA-256 mismatch".to_string());
    }
    Ok(())
}

pub(super) fn validate_candidate_artifact_identity(
    manifest: &DecoderManifest,
) -> Result<(), String> {
    if is_v25_joint_runtime(manifest) {
        return Ok(());
    }
    let canonical = if is_routed_manifest(manifest)
        && manifest.distribution_policy.as_deref() == Some("local-research-only")
    {
        if let Some(value) = manifest.adaptive_thresholds.as_ref() {
            format!(
                "{{\"adaptiveThresholds\":{{\"floor\":{},\"marginFloor\":{}}},\"candidateId\":\"{}\",\"datasetManifestSha256\":\"{}\",\"datasetRecipe\":\"{}\",\"distributionPolicy\":\"local-research-only\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
                value.floor,
                value.margin_floor,
                manifest.candidate_id,
                manifest
                    .training
                    .dataset_manifest_sha256
                    .as_deref()
                    .unwrap_or_default(),
                manifest
                    .training
                    .dataset_recipe
                    .as_deref()
                    .unwrap_or_default(),
                manifest.engine,
                manifest.matrix_id.as_deref().unwrap_or_default(),
                manifest.assets.model.bytes,
                manifest.assets.model.file,
                manifest.assets.model.sha256,
                manifest.route.as_deref().unwrap_or_default(),
                manifest.assets.tokenizer.bytes,
                manifest.assets.tokenizer.file,
                manifest.assets.tokenizer.sha256,
            )
        } else {
            format!(
                "{{\"candidateId\":\"{}\",\"datasetManifestSha256\":\"{}\",\"datasetRecipe\":\"{}\",\"distributionPolicy\":\"local-research-only\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
                manifest.candidate_id,
                manifest
                    .training
                    .dataset_manifest_sha256
                    .as_deref()
                    .unwrap_or_default(),
                manifest
                    .training
                    .dataset_recipe
                    .as_deref()
                    .unwrap_or_default(),
                manifest.engine,
                manifest.matrix_id.as_deref().unwrap_or_default(),
                manifest.assets.model.bytes,
                manifest.assets.model.file,
                manifest.assets.model.sha256,
                manifest.route.as_deref().unwrap_or_default(),
                manifest.assets.tokenizer.bytes,
                manifest.assets.tokenizer.file,
                manifest.assets.tokenizer.sha256,
            )
        }
    } else if is_routed_manifest(manifest) {
        if let Some(value) = manifest.adaptive_thresholds.as_ref() {
            format!(
                "{{\"adaptiveThresholds\":{{\"floor\":{},\"marginFloor\":{}}},\"candidateId\":\"{}\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
                value.floor,
                value.margin_floor,
                manifest.candidate_id,
                manifest.engine,
                manifest.matrix_id.as_deref().unwrap_or_default(),
                manifest.assets.model.bytes,
                manifest.assets.model.file,
                manifest.assets.model.sha256,
                manifest.route.as_deref().unwrap_or_default(),
                manifest.assets.tokenizer.bytes,
                manifest.assets.tokenizer.file,
                manifest.assets.tokenizer.sha256,
            )
        } else {
            format!(
                "{{\"candidateId\":\"{}\",\"engine\":\"{}\",\"matrixId\":\"{}\",\"model\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}},\"route\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"file\":\"{}\",\"sha256\":\"{}\"}}}}",
                manifest.candidate_id,
                manifest.engine,
                manifest.matrix_id.as_deref().unwrap_or_default(),
                manifest.assets.model.bytes,
                manifest.assets.model.file,
                manifest.assets.model.sha256,
                manifest.route.as_deref().unwrap_or_default(),
                manifest.assets.tokenizer.bytes,
                manifest.assets.tokenizer.file,
                manifest.assets.tokenizer.sha256,
            )
        }
    } else {
        format!(
            "{{\"candidateId\":\"{}\",\"engine\":\"{}\",\"model\":{{\"bytes\":{},\"sha256\":\"{}\"}},\"parameterCount\":{},\"quantization\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"sha256\":\"{}\"}}}}",
            manifest.candidate_id,
            manifest.engine,
            manifest.assets.model.bytes,
            manifest.assets.model.sha256,
            manifest.parameter_count,
            manifest.quantization,
            manifest.assets.tokenizer.bytes,
            manifest.assets.tokenizer.sha256,
        )
    };
    if sha256_bytes(canonical.as_bytes()) != manifest.candidate_artifact_sha256 {
        return Err("decoder candidate artifact identity mismatch".to_string());
    }
    Ok(())
}

pub(super) fn validate_quantized_decoder_asset(
    parent: &Path,
    asset: &DecoderAsset,
    manifest: &DecoderManifest,
) -> Result<(), String> {
    let bytes = fs::read(parent.join(&asset.file))
        .map_err(|error| format!("unable to read quantized decoder model: {error}"))?;
    validate_quantized_decoder_bytes(&bytes, manifest)
}

pub(super) fn validate_quantized_decoder_bytes(
    bytes: &[u8],
    manifest: &DecoderManifest,
) -> Result<(), String> {
    let (header, payload) = parse_quantized_decoder_envelope(bytes)?;
    let (width, layers, heads, feed_forward) = matrix_architecture(manifest)
        .ok_or_else(|| "decoder model matrix is unsupported".to_string())?;
    let block_model = manifest.engine == BLOCK_ENGINE_ID;
    let routed_model = is_routed_manifest(manifest);
    let expected_schema = if block_model {
        QUANTIZED_BLOCK_MODEL_SCHEMA
    } else if routed_model {
        QUANTIZED_ROUTED_MODEL_SCHEMA
    } else {
        QUANTIZED_MODEL_SCHEMA
    };
    let expected_block_size = if block_model { 5 } else { 1 };
    if header.schema != expected_schema
        || header.engine != manifest.engine
        || (routed_model && header.route != manifest.route)
        || (!routed_model && header.route.is_some())
        || (!is_v25_joint_runtime(manifest) && header.candidate_id != manifest.candidate_id)
        || header.nominal_parameter_count != manifest.parameter_count
        || header.quantization != manifest.quantization
        || header.vocabulary_size != manifest.tokenizer.vocabulary_size
        || header.maximum_context_tokens != 256
        || header.architecture.width != width
        || header.architecture.layers != layers
        || header.architecture.heads != heads
        || header.architecture.feed_forward != feed_forward
        || header.architecture.activation != "gelu"
        || !header.architecture.tied_embedding
        || !header.architecture.layer_norm_epsilon.is_finite()
        || (header.architecture.layer_norm_epsilon - 1e-5).abs() > f64::EPSILON
        || header.architecture.block_size != expected_block_size
        || header.architecture.confidence_head != "none"
        || (block_model
            && (header.architecture.future_projection_count != 4
                || !matches!(
                    header.architecture.sequential_head.as_str(),
                    "none" | "markov"
                )
                || !matches!(header.architecture.markov_rank, 0 | 32 | 64)
                || header.architecture.training_objective.is_empty()
                || header.architecture.position_loss_weights.len() != 5))
        || (!block_model
            && (header.architecture.future_projection_count != 0
                || header.architecture.sequential_head != "none"
                || header.architecture.markov_rank != 0))
    {
        return Err("decoder model header does not match its manifest".to_string());
    }
    validate_quantized_tensor_layout(&header, payload.len(), width, layers, feed_forward)
}

pub(super) fn parse_quantized_decoder_envelope(
    bytes: &[u8],
) -> Result<(QuantizedDecoderHeader, &[u8]), String> {
    if bytes.len() < MODEL_MAGIC.len() + 4
        || (&bytes[..MODEL_MAGIC.len()] != MODEL_MAGIC
            && &bytes[..BLOCK_MODEL_MAGIC.len()] != BLOCK_MODEL_MAGIC
            && &bytes[..ROUTED_MODEL_MAGIC.len()] != ROUTED_MODEL_MAGIC)
    {
        return Err("decoder model magic is invalid".to_string());
    }
    let header_length = u32::from_le_bytes(
        bytes[MODEL_MAGIC.len()..MODEL_MAGIC.len() + 4]
            .try_into()
            .map_err(|_| "decoder model header length is invalid".to_string())?,
    ) as usize;
    if header_length == 0 || header_length > MAX_MODEL_HEADER_BYTES {
        return Err("decoder model header length is invalid".to_string());
    }
    let header_start = MODEL_MAGIC.len() + 4;
    let payload_start = header_start
        .checked_add(header_length)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| "decoder model header exceeds the asset".to_string())?;
    let header: QuantizedDecoderHeader =
        serde_json::from_slice(&bytes[header_start..payload_start])
            .map_err(|error| format!("invalid decoder model header: {error}"))?;
    let payload = &bytes[payload_start..];
    let expected_magic = if header.schema == QUANTIZED_BLOCK_MODEL_SCHEMA {
        BLOCK_MODEL_MAGIC
    } else if header.schema == QUANTIZED_ROUTED_MODEL_SCHEMA {
        ROUTED_MODEL_MAGIC
    } else if header.schema == QUANTIZED_MODEL_SCHEMA {
        MODEL_MAGIC
    } else {
        return Err("decoder model schema is invalid".to_string());
    };
    if &bytes[..expected_magic.len()] != expected_magic {
        return Err("decoder model magic/schema mismatch".to_string());
    }
    let v25_joint_payload =
        header.schema == QUANTIZED_ROUTED_MODEL_SCHEMA && header.route.as_deref() == Some("joint");
    if !v25_joint_payload
        && (!valid_sha256(&header.payload_sha256) || sha256_bytes(payload) != header.payload_sha256)
    {
        return Err("decoder model payload SHA-256 mismatch".to_string());
    }
    Ok((header, payload))
}

pub(super) fn matrix_architecture(
    manifest: &DecoderManifest,
) -> Option<(usize, usize, usize, usize)> {
    match (manifest.parameter_count, manifest.quantization.as_str()) {
        (16_000_000, "q4" | "q8") => Some((384, 8, 4, 1_024)),
        (24_000_000, "q4") => Some((448, 9, 7, 1_280)),
        (32_000_000, "q4") => Some((512, 10, 8, 1_536)),
        _ => None,
    }
}
