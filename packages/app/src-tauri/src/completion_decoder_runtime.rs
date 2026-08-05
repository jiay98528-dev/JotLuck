use crate::completion_tokenizer::UnigramTokenizer;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MODEL_MAGIC: &[u8; 8] = b"JLFDQ02\0";
const MODEL_SCHEMA: &str = "jotluck.autocomplete.quantized-decoder.v2";
const MAX_HEADER_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelHeader {
    schema: String,
    payload_sha256: String,
    vocabulary_size: usize,
    maximum_context_tokens: usize,
    architecture: Architecture,
    tensors: Vec<TensorDescriptor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Architecture {
    width: usize,
    layers: usize,
    heads: usize,
    layer_norm_epsilon: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TensorDescriptor {
    name: String,
    #[serde(default)]
    alias_of: Option<String>,
    #[serde(default)]
    shape: Option<Vec<usize>>,
    #[serde(default)]
    dtype: Option<String>,
    #[serde(default)]
    group_size: Option<usize>,
    #[serde(default)]
    groups: Option<usize>,
    #[serde(default)]
    scale_offset: Option<usize>,
    #[serde(default)]
    scale_bytes: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    bytes: Option<usize>,
}

#[derive(Debug)]
enum TensorStorage {
    Quantized {
        bits: u8,
        group_size: usize,
        scales: Vec<f32>,
        values: Vec<u8>,
    },
    Float(Vec<f32>),
}

#[derive(Debug)]
struct Tensor {
    shape: Vec<usize>,
    storage: TensorStorage,
}

#[derive(Debug)]
struct DecoderModel {
    width: usize,
    layers: usize,
    heads: usize,
    layer_norm_epsilon: f32,
    maximum_context_tokens: usize,
    tensors: HashMap<String, Tensor>,
    aliases: HashMap<String, String>,
}

#[derive(Debug)]
pub(crate) struct DecoderRuntime {
    tokenizer: UnigramTokenizer,
    model: DecoderModel,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct TokenScore {
    pub(crate) token_id: usize,
    pub(crate) log_probability: f32,
    pub(crate) probability: f32,
}

#[derive(Debug)]
pub(crate) struct DecoderParityTrace {
    pub(crate) embedding_last: Vec<f32>,
    pub(crate) layer_last: Vec<Vec<f32>>,
    pub(crate) final_norm_last: Vec<f32>,
    pub(crate) logits: Vec<f32>,
}

impl DecoderRuntime {
    pub(crate) fn load(model_path: &Path, tokenizer_path: &Path) -> Result<Self, String> {
        let tokenizer = UnigramTokenizer::load(tokenizer_path)?;
        let model = DecoderModel::load(model_path)?;
        if tokenizer.vocabulary_size() != model.vocabulary_size()? {
            return Err("decoder tokenizer/model vocabulary mismatch".to_string());
        }
        Ok(Self { tokenizer, model })
    }

    pub(crate) fn encode_context(&self, value: &str) -> Vec<usize> {
        self.tokenizer
            .encode(value, self.model.maximum_context_tokens)
    }

    pub(crate) fn decode_tokens(&self, token_ids: &[usize]) -> String {
        self.tokenizer.decode(token_ids)
    }

    pub(crate) fn is_terminal(&self, token_id: usize) -> bool {
        self.tokenizer.is_terminal(token_id)
    }

    pub(crate) fn top_tokens(
        &self,
        tokens: &[usize],
        maximum: usize,
        should_stop: &impl Fn() -> bool,
    ) -> Result<Vec<TokenScore>, String> {
        let logits = self.model.next_token_logits(tokens, should_stop)?;
        if logits.is_empty() || maximum == 0 {
            return Ok(Vec::new());
        }
        let maximum_logit = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let denominator: f32 = logits
            .iter()
            .map(|value| (*value - maximum_logit).exp())
            .sum();
        if !denominator.is_finite() || denominator <= 0.0 {
            return Err("decoder logits are not finite".to_string());
        }
        let log_denominator = maximum_logit + denominator.ln();
        let mut indices: Vec<usize> = (0..logits.len()).collect();
        indices.sort_unstable_by(|left, right| {
            logits[*right]
                .partial_cmp(&logits[*left])
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.cmp(right))
        });
        Ok(indices
            .into_iter()
            .take(maximum)
            .map(|token_id| {
                let log_probability = logits[token_id] - log_denominator;
                TokenScore {
                    token_id,
                    log_probability,
                    probability: log_probability.exp(),
                }
            })
            .collect())
    }

    pub(crate) fn parity_trace(&self, tokens: &[usize]) -> Result<DecoderParityTrace, String> {
        self.model.parity_trace(tokens)
    }
}

mod model;
mod tensor;

use tensor::*;

#[cfg(test)]
mod tests;
