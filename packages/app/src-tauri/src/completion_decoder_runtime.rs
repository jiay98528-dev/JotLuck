use crate::completion_tokenizer::UnigramTokenizer;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

const MODEL_MAGIC_V2: &[u8; 8] = b"JLFDQ02\0";
const MODEL_MAGIC_V3: &[u8; 8] = b"JLFDQ03\0";
const MODEL_MAGIC_V4: &[u8; 8] = b"JLFDQ04\0";
const MODEL_MAGIC_V5: &[u8; 8] = b"JLFDQ05\0";
const MODEL_SCHEMA_V2: &str = "jotluck.autocomplete.quantized-decoder.v2";
const MODEL_SCHEMA_V3: &str = "jotluck.autocomplete.quantized-block-decoder.v1";
const MODEL_SCHEMA_V4: &str = "jotluck.autocomplete.quantized-routed-decoder.v1";
const MODEL_SCHEMA_V5: &str = "jotluck.autocomplete.quantized-writing-mtp.v1";
const MAX_HEADER_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelHeader {
    schema: String,
    #[serde(default)]
    route: Option<String>,
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
    #[serde(default = "default_block_size")]
    block_size: usize,
    #[serde(default)]
    future_projection_count: usize,
    #[serde(default = "default_sequential_head")]
    sequential_head: String,
    #[serde(default)]
    markov_rank: usize,
    #[serde(default = "default_confidence_head")]
    confidence_head: String,
    #[serde(default)]
    training_objective: String,
    #[serde(default)]
    position_loss_weights: Vec<f32>,
    #[serde(default)]
    direct_head: bool,
    #[serde(default)]
    mtp_head_count: usize,
}

const fn default_block_size() -> usize {
    1
}

fn default_sequential_head() -> String {
    "none".to_string()
}

fn default_confidence_head() -> String {
    "none".to_string()
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
    PackedQ4(PackedQ4Tensor),
    Dequantized(Vec<f32>),
    Float(Vec<f32>),
}

#[derive(Debug)]
struct Tensor {
    shape: Vec<usize>,
    storage: TensorStorage,
}

#[derive(Debug)]
struct DecoderModel {
    route: Option<String>,
    width: usize,
    layers: usize,
    heads: usize,
    layer_norm_epsilon: f32,
    maximum_context_tokens: usize,
    block_size: usize,
    future_projection_count: usize,
    sequential_head: String,
    markov_rank: usize,
    direct_mtp: bool,
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
    pub(crate) logit: f32,
    pub(crate) log_probability: f32,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DecoderCache {
    prefix: Arc<SharedKeyValuePrefix>,
    key_validity: Vec<bool>,
    layers: Vec<LayerKeyValueCache>,
    hidden: Vec<Vec<f32>>,
}

impl DecoderCache {
    #[cfg(test)]
    pub(crate) fn with_visible_tokens_for_test(visible_tokens: usize) -> Self {
        Self {
            prefix: Arc::new(SharedKeyValuePrefix {
                key_validity: vec![true; visible_tokens],
                layers: Vec::new(),
                hidden: vec![Vec::new(); visible_tokens],
            }),
            key_validity: Vec::new(),
            layers: Vec::new(),
            hidden: Vec::new(),
        }
    }

    pub(crate) fn estimated_bytes(&self) -> usize {
        let prefix_values = self
            .prefix
            .layers
            .iter()
            .map(|layer| {
                layer
                    .keys
                    .iter()
                    .map(|row| row.len().saturating_mul(std::mem::size_of::<f32>()))
                    .sum::<usize>()
                    .saturating_add(
                        layer
                            .values
                            .iter()
                            .map(|row| row.len().saturating_mul(std::mem::size_of::<f32>()))
                            .sum::<usize>(),
                    )
            })
            .sum::<usize>();
        let delta_values = self
            .layers
            .iter()
            .map(|layer| {
                layer
                    .keys
                    .iter()
                    .map(|row| row.len().saturating_mul(std::mem::size_of::<f32>()))
                    .sum::<usize>()
                    .saturating_add(
                        layer
                            .values
                            .iter()
                            .map(|row| row.len().saturating_mul(std::mem::size_of::<f32>()))
                            .sum::<usize>(),
                    )
            })
            .sum::<usize>();
        prefix_values
            .saturating_add(delta_values)
            .saturating_add(
                self.prefix
                    .hidden
                    .iter()
                    .chain(&self.hidden)
                    .map(|row| row.len().saturating_mul(std::mem::size_of::<f32>()))
                    .sum::<usize>(),
            )
            .saturating_add(self.prefix.key_validity.len())
            .saturating_add(self.key_validity.len())
    }

    pub(crate) fn truncate_to(&self, visible_tokens: usize) -> Option<Self> {
        let prefix_len = self.prefix.key_validity.len();
        let total_len = prefix_len.saturating_add(self.key_validity.len());
        if visible_tokens == 0 || visible_tokens > total_len {
            return None;
        }
        if visible_tokens <= prefix_len {
            return Some(Self {
                prefix: Arc::new(SharedKeyValuePrefix {
                    key_validity: self.prefix.key_validity[..visible_tokens].to_vec(),
                    layers: self
                        .prefix
                        .layers
                        .iter()
                        .map(|layer| LayerKeyValueCache {
                            keys: layer.keys[..visible_tokens].to_vec(),
                            values: layer.values[..visible_tokens].to_vec(),
                        })
                        .collect(),
                    hidden: self.prefix.hidden[..visible_tokens].to_vec(),
                }),
                key_validity: Vec::new(),
                layers: (0..self.layers.len())
                    .map(|_| LayerKeyValueCache::default())
                    .collect(),
                hidden: Vec::new(),
            });
        }
        let delta_len = visible_tokens - prefix_len;
        Some(Self {
            prefix: Arc::clone(&self.prefix),
            key_validity: self.key_validity[..delta_len].to_vec(),
            layers: self
                .layers
                .iter()
                .map(|layer| LayerKeyValueCache {
                    keys: layer.keys[..delta_len].to_vec(),
                    values: layer.values[..delta_len].to_vec(),
                })
                .collect(),
            hidden: self.hidden[..delta_len].to_vec(),
        })
    }

    fn last_hidden(&self) -> Option<&[f32]> {
        self.hidden
            .last()
            .or_else(|| self.prefix.hidden.last())
            .map(Vec::as_slice)
    }
}

#[derive(Debug, Default, PartialEq)]
struct SharedKeyValuePrefix {
    key_validity: Vec<bool>,
    layers: Vec<LayerKeyValueCache>,
    hidden: Vec<Vec<f32>>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct LayerKeyValueCache {
    keys: Vec<Vec<f32>>,
    values: Vec<Vec<f32>>,
}

#[derive(Debug)]
pub(crate) struct DecoderPrefill {
    pub(crate) cache: DecoderCache,
    pub(crate) logits: Vec<f32>,
    pub(crate) hidden: Vec<f32>,
}

#[derive(Debug)]
pub(crate) struct BlockDraft {
    pub(crate) prefill: DecoderPrefill,
    pub(crate) token_ids: Vec<usize>,
    pub(crate) per_position_logits: Vec<Vec<f32>>,
    pub(crate) conditional_confidence: Vec<f32>,
}

#[derive(Debug)]
pub(crate) struct DecoderGenerationStep {
    pub(crate) selected_token_id: usize,
    pub(crate) top_tokens: Vec<TokenScore>,
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

    pub(crate) fn encode_generation_context(
        &self,
        value: &str,
        reserved_tokens: usize,
    ) -> Vec<usize> {
        self.encode_generation_context_with_limit(value, reserved_tokens, usize::MAX)
    }

    pub(crate) fn encode_generation_context_with_limit(
        &self,
        value: &str,
        reserved_tokens: usize,
        maximum_prompt_tokens: usize,
    ) -> Vec<usize> {
        let maximum = self
            .model
            .maximum_context_tokens
            .saturating_sub(reserved_tokens)
            .min(maximum_prompt_tokens)
            .max(1);
        self.tokenizer.encode(value, maximum)
    }

    pub(crate) fn decode_tokens(&self, token_ids: &[usize]) -> String {
        self.tokenizer.decode(token_ids)
    }

    pub(crate) fn is_terminal(&self, token_id: usize) -> bool {
        self.tokenizer.is_terminal(token_id)
    }

    pub(crate) fn is_block_decoder(&self) -> bool {
        self.model.block_size > 1
    }

    pub(crate) fn route(&self) -> Option<&str> {
        self.model.route.as_deref()
    }

    pub(crate) fn draft_block(
        &self,
        tokens: &[usize],
        maximum_tokens: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<BlockDraft, String> {
        self.model.draft_block(tokens, maximum_tokens, should_stop)
    }

    pub(crate) fn draft_block_from_prefill(
        &self,
        prefill: DecoderPrefill,
        maximum_tokens: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<BlockDraft, String> {
        self.model
            .draft_block_from_prefill(prefill, maximum_tokens, should_stop)
    }

    pub(crate) fn prefill(
        &self,
        tokens: &[usize],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<DecoderPrefill, String> {
        self.model.prefill(tokens, should_stop)
    }

    pub(crate) fn advance(
        &self,
        cache: &mut DecoderCache,
        token_id: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        self.model.advance(cache, token_id, should_stop)
    }

    pub(crate) fn advance_batch(
        &self,
        caches: &mut [DecoderCache],
        token_ids: &[usize],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        self.model.advance_batch(caches, token_ids, should_stop)
    }

    pub(crate) fn cached_logits(
        &self,
        cache: &DecoderCache,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        self.model.validate_cache(cache)?;
        let hidden = cache
            .last_hidden()
            .ok_or_else(|| "decoder KV cache has no visible hidden state".to_string())?;
        self.model.project_output(hidden, should_stop)
    }

    pub(crate) fn cached_hidden(&self, cache: &DecoderCache) -> Result<Vec<f32>, String> {
        self.model.validate_cache(cache)?;
        cache
            .last_hidden()
            .map(ToOwned::to_owned)
            .ok_or_else(|| "decoder KV cache has no visible hidden state".to_string())
    }

    pub(crate) fn rank_logits(
        &self,
        logits: &[f32],
        maximum: usize,
    ) -> Result<Vec<TokenScore>, String> {
        rank_logits(logits, maximum)
    }

    /// Same softmax ranking as `rank_logits`, but the returned set always
    /// includes the extra token ids (e.g. personal-prior continuations) even
    /// when the model ranks them below the top-k.
    pub(crate) fn rank_logits_with_extra(
        &self,
        logits: &[f32],
        maximum: usize,
        extra_token_ids: &[usize],
    ) -> Result<Vec<TokenScore>, String> {
        rank_logits_with_extra(logits, maximum, extra_token_ids)
    }

    pub(crate) fn greedy_trace(
        &self,
        tokens: &[usize],
        maximum_new_tokens: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<DecoderGenerationStep>, String> {
        let mut prefill = self.prefill(tokens, should_stop)?;
        let mut steps = Vec::with_capacity(maximum_new_tokens);
        for step in 0..maximum_new_tokens {
            if should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            let top_tokens = self.rank_logits(&prefill.logits, 32)?;
            let selected_token_id = top_tokens
                .first()
                .map(|score| score.token_id)
                .ok_or_else(|| "decoder logits produced no token".to_string())?;
            steps.push(DecoderGenerationStep {
                selected_token_id,
                top_tokens,
            });
            if self.is_terminal(selected_token_id) {
                break;
            }
            if step + 1 < maximum_new_tokens {
                prefill.logits =
                    self.advance(&mut prefill.cache, selected_token_id, should_stop)?;
            }
        }
        Ok(steps)
    }

    pub(crate) fn parity_trace(&self, tokens: &[usize]) -> Result<DecoderParityTrace, String> {
        self.model.parity_trace(tokens)
    }
}

fn softmax_log_denominator(logits: &[f32]) -> Result<f32, String> {
    if logits.is_empty() {
        return Err("decoder logits are empty".to_string());
    }
    if logits.iter().any(|value| !value.is_finite()) {
        return Err("decoder logits are not finite".to_string());
    }
    let maximum_logit = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let denominator: f32 = logits
        .iter()
        .map(|value| (*value - maximum_logit).exp())
        .sum();
    if !denominator.is_finite() || denominator <= 0.0 {
        return Err("decoder logits are not finite".to_string());
    }
    Ok(maximum_logit + denominator.ln())
}

fn rank_logits(logits: &[f32], maximum: usize) -> Result<Vec<TokenScore>, String> {
    if logits.is_empty() || maximum == 0 {
        return Ok(Vec::new());
    }
    let log_denominator = softmax_log_denominator(logits)?;
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
                logit: logits[token_id],
                log_probability,
            }
        })
        .collect())
}

fn rank_logits_with_extra(
    logits: &[f32],
    maximum: usize,
    extra_token_ids: &[usize],
) -> Result<Vec<TokenScore>, String> {
    if extra_token_ids.is_empty() {
        return rank_logits(logits, maximum);
    }
    if logits.is_empty() || maximum == 0 {
        return Ok(Vec::new());
    }
    if extra_token_ids
        .iter()
        .any(|token_id| *token_id >= logits.len())
    {
        return Err("decoder extra token id is out of range".to_string());
    }
    let log_denominator = softmax_log_denominator(logits)?;
    let mut indices: Vec<usize> = (0..logits.len()).collect();
    indices.sort_unstable_by(|left, right| {
        logits[*right]
            .partial_cmp(&logits[*left])
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.cmp(right))
    });
    let mut selected: Vec<usize> = indices.into_iter().take(maximum).collect();
    for token_id in extra_token_ids {
        if !selected.contains(token_id) {
            selected.push(*token_id);
        }
    }
    selected.sort_unstable_by(|left, right| {
        logits[*right]
            .partial_cmp(&logits[*left])
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.cmp(right))
    });
    Ok(selected
        .into_iter()
        .map(|token_id| {
            let log_probability = logits[token_id] - log_denominator;
            TokenScore {
                token_id,
                logit: logits[token_id],
                log_probability,
            }
        })
        .collect())
}

mod batch;
mod cache;
mod model;
mod q4;
mod tensor;

use q4::PackedQ4Tensor;
use tensor::*;

#[cfg(test)]
mod tests;
