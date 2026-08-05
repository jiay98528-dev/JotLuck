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
    let manifest: DecoderManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("invalid decoder manifest JSON: {error}"))?;
    validate_manifest(&manifest, manifest_bytes.len() as u64)?;
    let parent = manifest_path
        .parent()
        .ok_or_else(|| "decoder manifest has no parent directory".to_string())?;
    validate_asset(parent, &manifest.assets.model)?;
    validate_asset(parent, &manifest.assets.tokenizer)?;
    validate_candidate_artifact_identity(&manifest)?;
    validate_quantized_decoder_asset(parent, &manifest.assets.model, &manifest)?;
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
    if manifest.schema != MANIFEST_SCHEMA
        || manifest.schema_version != 1
        || manifest.engine != ENGINE_ID
        || !valid_identifier(&manifest.candidate_id)
        || !valid_sha256(&manifest.candidate_artifact_sha256)
        || !manifest.runtime_eligible
        || !valid_manifest_lifecycle(manifest)
        || !matrix_valid
        || manifest.tokenizer.kind != "unigram"
        || manifest.tokenizer.vocabulary_size != 8_000
        || !manifest.tokenizer.byte_fallback
        || !manifest.tokenizer.bilingual
        || manifest.context.maximum_tokens != 256
        || manifest.output.chinese_maximum_code_points != 8
        || manifest.output.english_maximum_code_points != 12
        || !manifest.output.preserve_complete_english_word
        || manifest.training.cleaned_pool_bytes > TRAINING_POOL_LIMIT_BYTES
        || !manifest.training.license_audit_passed
        || manifest.measured_peak_memory_bytes > PEAK_MEMORY_LIMIT_BYTES as u64
    {
        return Err("decoder manifest contract is invalid".to_string());
    }
    let static_bytes = manifest_bytes
        .saturating_add(manifest.assets.model.bytes)
        .saturating_add(manifest.assets.tokenizer.bytes)
        .saturating_add(manifest.runtime_static_delta_bytes);
    if static_bytes > STATIC_LIMIT_BYTES {
        return Err("decoder candidate exceeds the 24 MiB static budget".to_string());
    }
    Ok(())
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

pub(super) fn validate_asset(parent: &Path, asset: &DecoderAsset) -> Result<(), String> {
    if !valid_asset_name(&asset.file) || !valid_sha256(&asset.sha256) || asset.bytes == 0 {
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
    if !metadata.is_file() || metadata.len() != asset.bytes {
        return Err("decoder asset byte length mismatch".to_string());
    }
    if sha256_file(&canonical)? != asset.sha256 {
        return Err("decoder asset SHA-256 mismatch".to_string());
    }
    Ok(())
}

pub(super) fn validate_candidate_artifact_identity(
    manifest: &DecoderManifest,
) -> Result<(), String> {
    let canonical = format!(
        "{{\"candidateId\":\"{}\",\"engine\":\"{}\",\"model\":{{\"bytes\":{},\"sha256\":\"{}\"}},\"parameterCount\":{},\"quantization\":\"{}\",\"tokenizer\":{{\"bytes\":{},\"sha256\":\"{}\"}}}}",
        manifest.candidate_id,
        ENGINE_ID,
        manifest.assets.model.bytes,
        manifest.assets.model.sha256,
        manifest.parameter_count,
        manifest.quantization,
        manifest.assets.tokenizer.bytes,
        manifest.assets.tokenizer.sha256,
    );
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
    if header.schema != QUANTIZED_MODEL_SCHEMA
        || header.engine != ENGINE_ID
        || header.candidate_id != manifest.candidate_id
        || header.nominal_parameter_count != manifest.parameter_count
        || header.quantization != manifest.quantization
        || header.vocabulary_size != 8_000
        || header.maximum_context_tokens != 256
        || header.architecture.width != width
        || header.architecture.layers != layers
        || header.architecture.heads != heads
        || header.architecture.feed_forward != feed_forward
        || header.architecture.activation != "gelu"
        || !header.architecture.tied_embedding
        || !header.architecture.layer_norm_epsilon.is_finite()
        || (header.architecture.layer_norm_epsilon - 1e-5).abs() > f64::EPSILON
    {
        return Err("decoder model header does not match its manifest".to_string());
    }
    validate_quantized_tensor_layout(&header, payload.len(), width, layers, feed_forward)
}

pub(super) fn parse_quantized_decoder_envelope(
    bytes: &[u8],
) -> Result<(QuantizedDecoderHeader, &[u8]), String> {
    if bytes.len() < MODEL_MAGIC.len() + 4 || &bytes[..MODEL_MAGIC.len()] != MODEL_MAGIC {
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
    if !valid_sha256(&header.payload_sha256) || sha256_bytes(payload) != header.payload_sha256 {
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
