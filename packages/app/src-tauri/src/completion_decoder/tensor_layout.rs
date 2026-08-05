use super::*;

pub(super) fn validate_quantized_tensor_layout(
    header: &QuantizedDecoderHeader,
    payload_bytes: usize,
    width: usize,
    layers: usize,
    feed_forward: usize,
) -> Result<(), String> {
    let mut tensors = HashMap::new();
    for tensor in &header.tensors {
        if tensor.name.is_empty() || tensors.insert(tensor.name.as_str(), tensor).is_some() {
            return Err("decoder model tensor names are invalid".to_string());
        }
    }

    let mut ranges = Vec::new();
    let mut parameter_count = 0_u64;
    for tensor in &header.tensors {
        if let Some(alias) = &tensor.alias_of {
            let target = tensors
                .get(alias.as_str())
                .ok_or_else(|| "decoder tensor alias target is missing".to_string())?;
            if alias == &tensor.name || target.alias_of.is_some() {
                return Err("decoder tensor alias chain is invalid".to_string());
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
                return Err("decoder tensor alias carries payload fields".to_string());
            }
            continue;
        }
        let shape = tensor
            .shape
            .as_ref()
            .filter(|shape| !shape.is_empty() && shape.iter().all(|dimension| *dimension > 0))
            .ok_or_else(|| "decoder tensor shape is invalid".to_string())?;
        let elements = shape
            .iter()
            .try_fold(1_usize, |total, dimension| total.checked_mul(*dimension));
        let elements = elements.ok_or_else(|| "decoder tensor shape overflow".to_string())?;
        parameter_count = parameter_count
            .checked_add(elements as u64)
            .ok_or_else(|| "decoder parameter count overflow".to_string())?;
        let dtype = tensor
            .dtype
            .as_deref()
            .ok_or_else(|| "decoder tensor dtype is missing".to_string())?;
        let expected_bytes = match dtype {
            "q4" if shape.len() >= 2 && header.quantization == "q4" => {
                let groups = elements.div_ceil(64);
                validate_group_descriptor(tensor, groups)?;
                ranges.push(quantized_scale_range(tensor, groups, payload_bytes)?);
                groups
                    .checked_mul(32)
                    .ok_or_else(|| "decoder tensor byte length overflow".to_string())?
            }
            "q8" if shape.len() >= 2 && header.quantization == "q8" => {
                let groups = elements.div_ceil(64);
                validate_group_descriptor(tensor, groups)?;
                ranges.push(quantized_scale_range(tensor, groups, payload_bytes)?);
                groups
                    .checked_mul(64)
                    .ok_or_else(|| "decoder tensor byte length overflow".to_string())?
            }
            "f16" if shape.len() < 2 => {
                if tensor.group_size.is_some()
                    || tensor.groups.is_some()
                    || tensor.scale_offset.is_some()
                    || tensor.scale_bytes.is_some()
                {
                    return Err("decoder f16 tensor carries quantization fields".to_string());
                }
                elements
                    .checked_mul(2)
                    .ok_or_else(|| "decoder tensor byte length overflow".to_string())?
            }
            _ => return Err("decoder tensor dtype does not match its shape".to_string()),
        };
        let offset = tensor
            .offset
            .ok_or_else(|| "decoder tensor offset is missing".to_string())?;
        let length = tensor
            .bytes
            .filter(|length| *length == expected_bytes)
            .ok_or_else(|| "decoder tensor byte length is invalid".to_string())?;
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= payload_bytes)
            .ok_or_else(|| "decoder tensor escapes its payload".to_string())?;
        ranges.push((offset, end));
    }
    if parameter_count != header.actual_parameter_count {
        return Err("decoder actual parameter count is invalid".to_string());
    }
    ranges.sort_unstable();
    let mut cursor = 0;
    for (start, end) in ranges {
        if start != cursor || end <= start {
            return Err("decoder tensor payload has a gap or overlap".to_string());
        }
        cursor = end;
    }
    if cursor != payload_bytes {
        return Err("decoder tensor payload coverage is incomplete".to_string());
    }

    expect_tensor_shape(&tensors, "token_embedding.weight", &[8_000, width])?;
    expect_tensor_shape(&tensors, "position_embedding.weight", &[256, width])?;
    expect_tensor_shape(&tensors, "output.weight", &[8_000, width])?;
    expect_tensor_shape(&tensors, "final_norm.weight", &[width])?;
    expect_tensor_shape(&tensors, "final_norm.bias", &[width])?;
    for layer in 0..layers {
        let prefix = format!("blocks.layers.{layer}");
        expect_tensor_shape(
            &tensors,
            &format!("{prefix}.self_attn.in_proj_weight"),
            &[3 * width, width],
        )?;
        expect_tensor_shape(
            &tensors,
            &format!("{prefix}.self_attn.in_proj_bias"),
            &[3 * width],
        )?;
        expect_tensor_shape(
            &tensors,
            &format!("{prefix}.self_attn.out_proj.weight"),
            &[width, width],
        )?;
        expect_tensor_shape(
            &tensors,
            &format!("{prefix}.self_attn.out_proj.bias"),
            &[width],
        )?;
        expect_tensor_shape(
            &tensors,
            &format!("{prefix}.linear1.weight"),
            &[feed_forward, width],
        )?;
        expect_tensor_shape(&tensors, &format!("{prefix}.linear1.bias"), &[feed_forward])?;
        expect_tensor_shape(
            &tensors,
            &format!("{prefix}.linear2.weight"),
            &[width, feed_forward],
        )?;
        expect_tensor_shape(&tensors, &format!("{prefix}.linear2.bias"), &[width])?;
        for norm in ["norm1", "norm2"] {
            expect_tensor_shape(&tensors, &format!("{prefix}.{norm}.weight"), &[width])?;
            expect_tensor_shape(&tensors, &format!("{prefix}.{norm}.bias"), &[width])?;
        }
    }
    Ok(())
}

pub(super) fn validate_group_descriptor(
    tensor: &QuantizedTensorDescriptor,
    expected_groups: usize,
) -> Result<(), String> {
    if tensor.group_size != Some(64) || tensor.groups != Some(expected_groups) {
        return Err("decoder quantization groups are invalid".to_string());
    }
    Ok(())
}

pub(super) fn quantized_scale_range(
    tensor: &QuantizedTensorDescriptor,
    groups: usize,
    payload_bytes: usize,
) -> Result<(usize, usize), String> {
    let offset = tensor
        .scale_offset
        .ok_or_else(|| "decoder tensor scale offset is missing".to_string())?;
    let expected = groups
        .checked_mul(2)
        .ok_or_else(|| "decoder tensor scale byte length overflow".to_string())?;
    let length = tensor
        .scale_bytes
        .filter(|length| *length == expected)
        .ok_or_else(|| "decoder tensor scale byte length is invalid".to_string())?;
    let end = offset
        .checked_add(length)
        .filter(|end| *end <= payload_bytes)
        .ok_or_else(|| "decoder tensor scales escape its payload".to_string())?;
    Ok((offset, end))
}

pub(super) fn expect_tensor_shape(
    tensors: &HashMap<&str, &QuantizedTensorDescriptor>,
    name: &str,
    expected: &[usize],
) -> Result<(), String> {
    let tensor = tensors
        .get(name)
        .ok_or_else(|| format!("decoder model tensor is missing: {name}"))?;
    let resolved = if let Some(alias) = &tensor.alias_of {
        tensors
            .get(alias.as_str())
            .copied()
            .ok_or_else(|| format!("decoder tensor alias target is missing: {alias}"))?
    } else {
        *tensor
    };
    if resolved.shape.as_deref() != Some(expected) {
        return Err(format!("decoder model tensor shape is invalid: {name}"));
    }
    Ok(())
}

pub(super) fn validate_ready_response(
    ready: &CompletionDecoderReadyResponse,
    candidate: &LoadedCandidate,
    worker_pid: u32,
) -> Result<(), String> {
    if ready != &ready_response(candidate, worker_pid) {
        return Err("completion worker ready identity mismatch".to_string());
    }
    Ok(())
}

pub(super) fn ready_response(
    candidate: &LoadedCandidate,
    worker_pid: u32,
) -> CompletionDecoderReadyResponse {
    CompletionDecoderReadyResponse {
        protocol_version: PROTOCOL_VERSION,
        engine_id: ENGINE_ID.to_string(),
        candidate_id: candidate.manifest.candidate_id.clone(),
        worker_pid,
        manifest_bytes: candidate.manifest_bytes,
        model_bytes: candidate.manifest.assets.model.bytes,
        tokenizer_bytes: candidate.manifest.assets.tokenizer.bytes,
        runtime_static_delta_bytes: candidate.manifest.runtime_static_delta_bytes,
        peak_memory_limit_bytes: PEAK_MEMORY_LIMIT_BYTES,
    }
}

pub(super) fn validate_evaluation_manifest_path(path: &Path) -> Result<(), String> {
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if !normalized.contains("/autocomplete-v2-free/") || !normalized.contains("/candidates/") {
        return Err(
            "evaluation manifest must remain in the V2 free candidate directory".to_string(),
        );
    }
    Ok(())
}

pub(super) fn validate_canonical_manifest_path(path: &Path) -> Result<(), String> {
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if !normalized.ends_with("/autocomplete/autocomplete-public.manifest.json") {
        return Err("release decoder must use the unique canonical manifest".to_string());
    }
    Ok(())
}

pub(super) fn resolve_requested_manifest_path(
    app: &tauri::AppHandle,
    value: &str,
) -> Result<PathBuf, String> {
    if value != "@canonical" {
        return Ok(PathBuf::from(value));
    }
    app.path()
        .resource_dir()
        .map(|root| root.join("autocomplete/autocomplete-public.manifest.json"))
        .map_err(|error| format!("unable to resolve canonical decoder resources: {error}"))
}

pub(super) fn evaluation_runtime_allowed() -> bool {
    cfg!(debug_assertions)
        || std::env::var("JOTLUCK_AUTOCOMPLETE_EVALUATION").is_ok_and(|value| value == "1")
}

pub(super) fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

pub(super) fn valid_asset_name(value: &str) -> bool {
    valid_identifier(value) && !value.contains("..") && !value.contains(['/', '\\'])
}

pub(super) fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("unable to hash decoder asset: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("unable to hash decoder asset: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn sha256_bytes(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}
