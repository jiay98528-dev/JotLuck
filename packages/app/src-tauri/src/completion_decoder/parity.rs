use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;

const PARITY_SCHEMA: &str = "jotluck.autocomplete.decoder-parity.v1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParityRequest {
    protocol_version: u32,
    request_id: u64,
    #[serde(default)]
    token_ids: Option<Vec<usize>>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    maximum_new_tokens: usize,
    #[serde(default)]
    include_beam_sequences: bool,
    #[serde(default = "unknown_language_hint")]
    language_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParityResponse {
    schema: &'static str,
    protocol_version: u32,
    request_id: u64,
    candidate_id: String,
    token_ids: Vec<usize>,
    decoded_top: Vec<DecodedToken>,
    embedding_last: EncodedVector,
    layer_last: Vec<EncodedVector>,
    final_norm_last: EncodedVector,
    logits: EncodedVector,
    top32: Vec<ParityTopToken>,
    generation_steps: Vec<ParityGenerationStep>,
    beam_sequences: Vec<ParityBeamSequence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParityError {
    schema: &'static str,
    protocol_version: u32,
    request_id: u64,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ParityEnvelope {
    Response(Box<ParityResponse>),
    Error(ParityError),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncodedVector {
    count: usize,
    f32_le_base64: String,
    sha256: String,
    minimum: f32,
    maximum: f32,
    mean: f64,
    l2: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParityTopToken {
    token_id: usize,
    logit: f32,
    rank: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParityGenerationStep {
    selected_token_id: usize,
    decoded_text: String,
    top32: Vec<ParityTopToken>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParityBeamSequence {
    token_ids: Vec<usize>,
    decoded_text: String,
    normalized_score: f32,
}

fn unknown_language_hint() -> String {
    "unknown".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodedToken {
    token_id: usize,
    text: String,
}

pub(crate) fn run_completion_parity_if_requested() -> bool {
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() != Some(std::ffi::OsStr::new(PARITY_ARGUMENT)) {
        return false;
    }
    let manifest_path = arguments.next().map(PathBuf::from);
    let extra_argument = arguments.next().is_some();
    let result = if !parity_enabled(std::env::var_os("JOTLUCK_AUTOCOMPLETE_EVALUATION")) {
        Err("completion parity is disabled".to_string())
    } else if extra_argument {
        Err("completion parity received unexpected arguments".to_string())
    } else if let Some(path) = manifest_path {
        run_parity(&path)
    } else {
        Err("completion parity manifest path is missing".to_string())
    };
    if let Err(error) = result {
        let mut writer = BufWriter::new(io::stdout().lock());
        let _ = write_frame(
            &mut writer,
            &ParityEnvelope::Error(ParityError {
                schema: PARITY_SCHEMA,
                protocol_version: PROTOCOL_VERSION,
                request_id: 0,
                error,
            }),
        );
    }
    true
}

fn parity_enabled(value: Option<std::ffi::OsString>) -> bool {
    value.as_deref() == Some(std::ffi::OsStr::new("1"))
}

fn run_parity(manifest_path: &Path) -> Result<(), String> {
    let candidate = load_candidate(manifest_path)?;
    if candidate.manifest.lifecycle != "trained" || !candidate.manifest.evaluation_only {
        return Err("completion parity requires a trained evaluation manifest".to_string());
    }
    let mut reader = BufReader::new(io::stdin().lock());
    let request: ParityRequest =
        read_frame(&mut reader).map_err(|error| format!("invalid parity frame: {error}"))?;
    let response = evaluate_request(&candidate, request)?;
    let mut writer = BufWriter::new(io::stdout().lock());
    write_frame(&mut writer, &ParityEnvelope::Response(Box::new(response)))
        .map_err(|error| format!("unable to write parity frame: {error}"))
}

fn evaluate_request(
    candidate: &LoadedCandidate,
    request: ParityRequest,
) -> Result<ParityResponse, String> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err("completion parity protocol mismatch".to_string());
    }
    let tokens = match (request.token_ids, request.context) {
        (Some(tokens), None) => tokens,
        (None, Some(context)) if context.len() <= 16 * 1024 => {
            candidate.runtime.encode_context(&context)
        }
        _ => return Err("parity request must contain exactly one bounded input".to_string()),
    };
    if tokens.is_empty() || tokens.len() > 256 {
        return Err("parity token context length is invalid".to_string());
    }
    if request.maximum_new_tokens > 8
        || tokens
            .len()
            .saturating_add(request.maximum_new_tokens.saturating_sub(1))
            > 256
        || !matches!(request.language_hint.as_str(), "zh" | "en" | "unknown")
        || (request.include_beam_sequences && tokens.len() > 232)
    {
        return Err("parity generation length is invalid".to_string());
    }
    let trace = candidate.runtime.parity_trace(&tokens)?;
    let generation =
        candidate
            .runtime
            .greedy_trace(&tokens, request.maximum_new_tokens, &|| false)?;
    let beam_sequences = if request.include_beam_sequences {
        super::worker::beam_sequences_for_parity(
            &candidate.runtime,
            &tokens,
            &request.language_hint,
        )?
    } else {
        Vec::new()
    };
    build_response(
        candidate,
        request.request_id,
        tokens,
        trace,
        generation,
        beam_sequences,
    )
}

fn build_response(
    candidate: &LoadedCandidate,
    request_id: u64,
    tokens: Vec<usize>,
    trace: DecoderParityTrace,
    generation: Vec<crate::completion_decoder_runtime::DecoderGenerationStep>,
    beam_sequences: Vec<super::worker::BeamParitySequence>,
) -> Result<ParityResponse, String> {
    let mut indices: Vec<usize> = (0..trace.logits.len()).collect();
    indices.sort_unstable_by(|left, right| {
        trace.logits[*right]
            .partial_cmp(&trace.logits[*left])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.cmp(right))
    });
    let top32 = indices
        .into_iter()
        .take(32)
        .enumerate()
        .map(|(rank, token_id)| ParityTopToken {
            token_id,
            logit: trace.logits[token_id],
            rank,
        })
        .collect::<Vec<_>>();
    let decoded_top = top32
        .iter()
        .map(|item| DecodedToken {
            token_id: item.token_id,
            text: candidate.runtime.decode_tokens(&[item.token_id]),
        })
        .collect();
    let mut generated_token_ids = Vec::with_capacity(generation.len());
    let generation_steps = generation
        .into_iter()
        .map(|step| {
            generated_token_ids.push(step.selected_token_id);
            ParityGenerationStep {
                selected_token_id: step.selected_token_id,
                decoded_text: candidate.runtime.decode_tokens(&generated_token_ids),
                top32: step
                    .top_tokens
                    .into_iter()
                    .enumerate()
                    .map(|(rank, token)| ParityTopToken {
                        token_id: token.token_id,
                        logit: token.logit,
                        rank,
                    })
                    .collect(),
            }
        })
        .collect();
    let beam_sequences = beam_sequences
        .into_iter()
        .map(|sequence| ParityBeamSequence {
            decoded_text: candidate.runtime.decode_tokens(&sequence.token_ids),
            token_ids: sequence.token_ids,
            normalized_score: sequence.normalized_score,
        })
        .collect();
    Ok(ParityResponse {
        schema: PARITY_SCHEMA,
        protocol_version: PROTOCOL_VERSION,
        request_id,
        candidate_id: candidate.manifest.candidate_id.clone(),
        token_ids: tokens,
        decoded_top,
        embedding_last: encode_vector(&trace.embedding_last)?,
        layer_last: trace
            .layer_last
            .iter()
            .map(|value| encode_vector(value))
            .collect::<Result<_, _>>()?,
        final_norm_last: encode_vector(&trace.final_norm_last)?,
        logits: encode_vector(&trace.logits)?,
        top32,
        generation_steps,
        beam_sequences,
    })
}

fn encode_vector(values: &[f32]) -> Result<EncodedVector, String> {
    if values.is_empty() || values.iter().any(|value| !value.is_finite()) {
        return Err("parity vector is empty or non-finite".to_string());
    }
    let mut bytes = Vec::with_capacity(values.len() * 4);
    let mut minimum = f32::INFINITY;
    let mut maximum = f32::NEG_INFINITY;
    let mut sum = 0.0_f64;
    let mut squared = 0.0_f64;
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
        minimum = minimum.min(*value);
        maximum = maximum.max(*value);
        sum += f64::from(*value);
        squared += f64::from(*value) * f64::from(*value);
    }
    Ok(EncodedVector {
        count: values.len(),
        f32_le_base64: BASE64.encode(&bytes),
        sha256: sha256_bytes(&bytes),
        minimum,
        maximum,
        mean: sum / values.len() as f64,
        l2: squared.sqrt(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parity_gate_requires_exact_evaluation_value() {
        assert!(parity_enabled(Some("1".into())));
        assert!(!parity_enabled(None));
        assert!(!parity_enabled(Some("true".into())));
        assert!(!parity_enabled(Some("0".into())));
    }

    #[test]
    fn vector_encoding_is_lossless_and_stable() {
        let encoded = encode_vector(&[1.0, -2.0, 0.5]).unwrap();
        assert_eq!(encoded.count, 3);
        assert_eq!(BASE64.decode(&encoded.f32_le_base64).unwrap().len(), 12);
        assert_eq!(encoded.minimum, -2.0);
        assert_eq!(encoded.maximum, 1.0);
        assert_eq!(encoded.sha256.len(), 64);
    }
}
