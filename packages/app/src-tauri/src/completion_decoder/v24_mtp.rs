use super::*;

pub(super) const WRITING_MTP_ENGINE_ID: &str = "public-v2.4-writing-mtp-v1";
pub(super) const WRITING_MTP_MANIFEST_SCHEMA: &str =
    "jotluck.autocomplete.public-v2.4-writing-mtp.v1";
pub(super) const WRITING_MTP_MODEL_SCHEMA: &str = "jotluck.autocomplete.quantized-writing-mtp.v1";
pub(super) const WRITING_MTP_MODEL_MAGIC: &[u8; 8] = b"JLFDQ05\0";
pub(super) const WRITING_MTP_FORMAT: &str = "JLFDQ05";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WritingMtpManifest {
    schema: String,
    format: String,
    engine: String,
    candidate_id: String,
    candidate_artifact_sha256: String,
    route: String,
    block_size: usize,
    model_sha256: String,
    tokenizer_sha256: String,
    parameter_count: u64,
    additional_parameter_count: u64,
    static_asset_bytes: u64,
    pub(super) assets: DecoderAssets,
    adaptive_thresholds: WritingMtpThresholds,
    evaluation_only: bool,
}

pub(super) fn normalize_writing_mtp_manifest(manifest: &WritingMtpManifest) -> DecoderManifest {
    DecoderManifest {
        schema: WRITING_MTP_MANIFEST_SCHEMA.to_string(),
        schema_version: 1,
        engine: manifest.engine.clone(),
        candidate_id: manifest.candidate_id.clone(),
        candidate_artifact_sha256: manifest.candidate_artifact_sha256.clone(),
        lifecycle: "trained".to_string(),
        evaluation_only: true,
        runtime_eligible: true,
        release_eligible: false,
        distribution_policy: None,
        route: Some("writing".to_string()),
        matrix_id: Some(format!("MTP-{}", manifest.block_size)),
        parameter_count: manifest.parameter_count,
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
            chinese_maximum_code_points: 16,
            english_maximum_code_points: 24,
            preserve_complete_english_word: true,
        },
        training: TrainingContract {
            cleaned_pool_bytes: 0,
            license_audit_passed: true,
            dataset_recipe: None,
            dataset_manifest_sha256: None,
        },
        oracle_precheck: OraclePrecheck {
            checkpoints: 0,
            oracle_at8: 0.0,
            oracle_at32: 0.0,
            chinese_oracle_at8: 0.0,
            english_oracle_at8: 0.0,
            passed: false,
        },
        assets: manifest.assets.clone(),
        runtime_static_delta_bytes: 0,
        measured_peak_memory_bytes: 0,
        adaptive_thresholds: Some(AdaptiveBeamThresholds {
            floor: manifest.adaptive_thresholds.floor,
            margin_floor: manifest.adaptive_thresholds.margin_floor,
        }),
        release_evidence: None,
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WritingMtpThresholds {
    floor: f32,
    margin_floor: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingMtpModelHeader {
    schema: String,
    format: String,
    engine: String,
    route: String,
    candidate_id: String,
    block_size: usize,
    nominal_parameter_count: u64,
    actual_parameter_count: u64,
    additional_parameter_count: u64,
    quantization: String,
    vocabulary_size: usize,
    maximum_context_tokens: usize,
    architecture: WritingMtpArchitecture,
    payload_sha256: String,
    tensors: Vec<QuantizedTensorDescriptor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingMtpArchitecture {
    width: usize,
    layers: usize,
    heads: usize,
    feed_forward: usize,
    activation: String,
    tied_embedding: bool,
    layer_norm_epsilon: f64,
    direct_head: bool,
    mtp_head_count: usize,
    projection: String,
}

pub(super) fn validate_writing_mtp_manifest(manifest: &WritingMtpManifest) -> Result<(), String> {
    if manifest.schema != WRITING_MTP_MANIFEST_SCHEMA
        || manifest.format != WRITING_MTP_FORMAT
        || manifest.engine != WRITING_MTP_ENGINE_ID
        || manifest.route != "writing"
        || !manifest.evaluation_only
        || !valid_identifier(&manifest.candidate_id)
        || !valid_sha256(&manifest.candidate_artifact_sha256)
        || !valid_sha256(&manifest.model_sha256)
        || !valid_sha256(&manifest.tokenizer_sha256)
        || manifest.assets.model.sha256 != manifest.model_sha256
        || manifest.assets.tokenizer.sha256 != manifest.tokenizer_sha256
        || manifest.static_asset_bytes
            < manifest
                .assets
                .model
                .bytes
                .saturating_add(manifest.assets.tokenizer.bytes)
        || !matches!(manifest.block_size, 2 | 4)
        || manifest.additional_parameter_count
            > if manifest.block_size == 2 {
                600_000
            } else {
                1_700_000
            }
        || manifest.static_asset_bytes > STATIC_LIMIT_BYTES
        || !valid_adaptive_threshold(
            manifest.adaptive_thresholds.floor,
            manifest.adaptive_thresholds.margin_floor,
        )
    {
        return Err("Writing MTP manifest contract is invalid".to_string());
    }
    let canonical = format!(
        "{{\"adaptiveThresholds\":{{\"floor\":{},\"marginFloor\":{}}},\"blockSize\":{},\"candidateId\":\"{}\",\"engine\":\"{}\",\"format\":\"{}\",\"modelSha256\":\"{}\",\"route\":\"writing\",\"tokenizerSha256\":\"{}\"}}",
        manifest.adaptive_thresholds.floor,
        manifest.adaptive_thresholds.margin_floor,
        manifest.block_size,
        manifest.candidate_id,
        manifest.engine,
        manifest.format,
        manifest.model_sha256,
        manifest.tokenizer_sha256,
    );
    if sha256_bytes(canonical.as_bytes()) != manifest.candidate_artifact_sha256 {
        return Err("Writing MTP candidate artifact identity mismatch".to_string());
    }
    if manifest.parameter_count == 0 {
        return Err("Writing MTP parameter count is invalid".to_string());
    }
    Ok(())
}

pub(super) fn validate_writing_mtp_model_bytes(
    bytes: &[u8],
    manifest: &WritingMtpManifest,
) -> Result<(), String> {
    validate_writing_mtp_manifest(manifest)?;
    if bytes.len() < WRITING_MTP_MODEL_MAGIC.len() + 4
        || &bytes[..WRITING_MTP_MODEL_MAGIC.len()] != WRITING_MTP_MODEL_MAGIC
    {
        return Err("Writing MTP model magic is invalid".to_string());
    }
    let header_length = u32::from_le_bytes(
        bytes[WRITING_MTP_MODEL_MAGIC.len()..WRITING_MTP_MODEL_MAGIC.len() + 4]
            .try_into()
            .map_err(|_| "Writing MTP model header length is invalid".to_string())?,
    ) as usize;
    if header_length == 0 || header_length > MAX_MODEL_HEADER_BYTES {
        return Err("Writing MTP model header length is invalid".to_string());
    }
    let header_start = WRITING_MTP_MODEL_MAGIC.len() + 4;
    let payload_start = header_start
        .checked_add(header_length)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| "Writing MTP model header exceeds the asset".to_string())?;
    let header: WritingMtpModelHeader = serde_json::from_slice(&bytes[header_start..payload_start])
        .map_err(|error| format!("invalid Writing MTP model header: {error}"))?;
    let payload = &bytes[payload_start..];
    if header.schema != WRITING_MTP_MODEL_SCHEMA
        || header.format != WRITING_MTP_FORMAT
        || header.engine != WRITING_MTP_ENGINE_ID
        || header.route != "writing"
        || header.candidate_id != manifest.candidate_id
        || header.block_size != manifest.block_size
        || header.actual_parameter_count != manifest.parameter_count
        || header.additional_parameter_count != manifest.additional_parameter_count
        || header.nominal_parameter_count != 32_000_000
        || header.quantization != "q4"
        || header.vocabulary_size != 8_000
        || header.maximum_context_tokens != 256
        || !valid_sha256(&header.payload_sha256)
        || sha256_bytes(payload) != header.payload_sha256
        || header.architecture.width != 512
        || header.architecture.layers != 10
        || header.architecture.heads != 8
        || header.architecture.feed_forward != 1_536
        || header.architecture.activation != "gelu"
        || !header.architecture.tied_embedding
        || !header.architecture.layer_norm_epsilon.is_finite()
        || (header.architecture.layer_norm_epsilon - 1e-5).abs() > f64::EPSILON
        || !header.architecture.direct_head
        || header.architecture.mtp_head_count != header.block_size - 1
        || header.architecture.projection != "rmsnorm-concat-linear-v1"
    {
        return Err("Writing MTP model header does not match its manifest".to_string());
    }
    validate_writing_mtp_tensor_layout(&header, payload.len())
}

fn valid_adaptive_threshold(floor: f32, margin_floor: f32) -> bool {
    [0.2_f32, 0.25, 0.3, 0.35, 0.4].contains(&floor)
        && [0.1_f32, 0.2, 0.3, 0.4, 0.5].contains(&margin_floor)
}

fn validate_writing_mtp_tensor_layout(
    header: &WritingMtpModelHeader,
    payload_bytes: usize,
) -> Result<(), String> {
    let mut tensors = HashMap::new();
    for tensor in &header.tensors {
        if tensor.name.is_empty() || tensors.insert(tensor.name.as_str(), tensor).is_some() {
            return Err("Writing MTP tensor names are invalid".to_string());
        }
    }
    let mut ranges = Vec::new();
    let mut parameter_count = 0_u64;
    for tensor in &header.tensors {
        if let Some(alias) = &tensor.alias_of {
            let target = tensors
                .get(alias.as_str())
                .ok_or_else(|| "Writing MTP tensor alias target is missing".to_string())?;
            if alias == &tensor.name || target.alias_of.is_some() {
                return Err("Writing MTP tensor alias chain is invalid".to_string());
            }
            if tensor.shape.is_some()
                || tensor.dtype.is_some()
                || tensor.group_size.is_some()
                || tensor.groups.is_some()
                || tensor.scale_offset.is_some()
                || tensor.scale_bytes.is_some()
                || tensor.offset.is_some()
                || tensor.bytes.is_some()
            {
                return Err("Writing MTP tensor alias carries payload fields".to_string());
            }
            continue;
        }
        let shape = tensor
            .shape
            .as_ref()
            .filter(|shape| !shape.is_empty() && shape.iter().all(|dimension| *dimension > 0))
            .ok_or_else(|| "Writing MTP tensor shape is invalid".to_string())?;
        let elements = shape
            .iter()
            .try_fold(1_usize, |total, dimension| total.checked_mul(*dimension))
            .ok_or_else(|| "Writing MTP tensor shape overflows".to_string())?;
        parameter_count = parameter_count
            .checked_add(elements as u64)
            .ok_or_else(|| "Writing MTP parameter count overflows".to_string())?;
        let dtype = tensor
            .dtype
            .as_deref()
            .ok_or_else(|| "Writing MTP tensor dtype is missing".to_string())?;
        let expected_bytes = match dtype {
            "q4" if shape.len() >= 2 => {
                let groups = elements.div_ceil(64);
                if tensor.group_size != Some(64) || tensor.groups != Some(groups) {
                    return Err("Writing MTP tensor quantization groups are invalid".to_string());
                }
                let scale_offset = tensor
                    .scale_offset
                    .ok_or_else(|| "Writing MTP tensor scale offset is missing".to_string())?;
                let scale_bytes = tensor
                    .scale_bytes
                    .filter(|value| *value == groups * 2)
                    .ok_or_else(|| "Writing MTP tensor scale bytes are invalid".to_string())?;
                ranges.push(payload_range(scale_offset, scale_bytes, payload_bytes)?);
                groups
                    .checked_mul(32)
                    .ok_or_else(|| "Writing MTP tensor q4 bytes overflow".to_string())?
            }
            "f16" if shape.len() < 2 => {
                if tensor.group_size.is_some()
                    || tensor.groups.is_some()
                    || tensor.scale_offset.is_some()
                    || tensor.scale_bytes.is_some()
                {
                    return Err("Writing MTP f16 tensor carries q4 fields".to_string());
                }
                elements
                    .checked_mul(2)
                    .ok_or_else(|| "Writing MTP tensor f16 bytes overflow".to_string())?
            }
            _ => return Err("Writing MTP tensor dtype does not match its shape".to_string()),
        };
        let offset = tensor
            .offset
            .ok_or_else(|| "Writing MTP tensor offset is missing".to_string())?;
        let length = tensor
            .bytes
            .filter(|value| *value == expected_bytes)
            .ok_or_else(|| "Writing MTP tensor bytes are invalid".to_string())?;
        ranges.push(payload_range(offset, length, payload_bytes)?);
    }
    if parameter_count != header.actual_parameter_count {
        return Err("Writing MTP actual parameter count is invalid".to_string());
    }
    ranges.sort_unstable();
    let mut cursor = 0;
    for (start, end) in ranges {
        if start != cursor || end <= start {
            return Err("Writing MTP tensor payload has a gap or overlap".to_string());
        }
        cursor = end;
    }
    if cursor != payload_bytes {
        return Err("Writing MTP tensor payload coverage is incomplete".to_string());
    }
    let width = header.architecture.width;
    let layers = header.architecture.layers;
    let feed_forward = header.architecture.feed_forward;
    expect_writing_mtp_shape(&tensors, "token_embedding.weight", &[8_000, width])?;
    expect_writing_mtp_shape(&tensors, "position_embedding.weight", &[256, width])?;
    expect_writing_mtp_shape(&tensors, "output.weight", &[8_000, width])?;
    expect_writing_mtp_shape(&tensors, "final_norm.weight", &[width])?;
    expect_writing_mtp_shape(&tensors, "final_norm.bias", &[width])?;
    for layer in 0..layers {
        let prefix = format!("blocks.layers.{layer}");
        expect_writing_mtp_shape(
            &tensors,
            &format!("{prefix}.self_attn.in_proj_weight"),
            &[3 * width, width],
        )?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("{prefix}.self_attn.in_proj_bias"),
            &[3 * width],
        )?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("{prefix}.self_attn.out_proj.weight"),
            &[width, width],
        )?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("{prefix}.self_attn.out_proj.bias"),
            &[width],
        )?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("{prefix}.linear1.weight"),
            &[feed_forward, width],
        )?;
        expect_writing_mtp_shape(&tensors, &format!("{prefix}.linear1.bias"), &[feed_forward])?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("{prefix}.linear2.weight"),
            &[width, feed_forward],
        )?;
        expect_writing_mtp_shape(&tensors, &format!("{prefix}.linear2.bias"), &[width])?;
        for norm in ["norm1", "norm2"] {
            expect_writing_mtp_shape(&tensors, &format!("{prefix}.{norm}.weight"), &[width])?;
            expect_writing_mtp_shape(&tensors, &format!("{prefix}.{norm}.bias"), &[width])?;
        }
    }
    for index in 0..header.architecture.mtp_head_count {
        expect_writing_mtp_shape(
            &tensors,
            &format!("mtp_heads.{index}.rms_hidden.weight"),
            &[width],
        )?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("mtp_heads.{index}.rms_embedding.weight"),
            &[width],
        )?;
        expect_writing_mtp_shape(
            &tensors,
            &format!("mtp_heads.{index}.projection.weight"),
            &[width, 2 * width],
        )?;
    }
    Ok(())
}

fn payload_range(
    offset: usize,
    length: usize,
    payload_bytes: usize,
) -> Result<(usize, usize), String> {
    let end = offset
        .checked_add(length)
        .filter(|end| *end <= payload_bytes)
        .ok_or_else(|| "Writing MTP tensor escapes its payload".to_string())?;
    Ok((offset, end))
}

fn expect_writing_mtp_shape(
    tensors: &HashMap<&str, &QuantizedTensorDescriptor>,
    name: &str,
    expected: &[usize],
) -> Result<(), String> {
    let tensor = tensors
        .get(name)
        .ok_or_else(|| format!("Writing MTP tensor is missing: {name}"))?;
    let resolved = if let Some(alias) = &tensor.alias_of {
        tensors
            .get(alias.as_str())
            .copied()
            .ok_or_else(|| format!("Writing MTP tensor alias target is missing: {alias}"))?
    } else {
        *tensor
    };
    if resolved.shape.as_deref() != Some(expected) {
        return Err(format!("Writing MTP tensor shape is invalid: {name}"));
    }
    Ok(())
}
