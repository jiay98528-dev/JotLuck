use super::cache::CachedAttentionContext;
use super::*;
use rayon::prelude::*;

type QkvBatch = (Vec<Vec<f32>>, Vec<Vec<f32>>, Vec<Vec<f32>>);

impl DecoderModel {
    pub(super) fn matvec_batch(
        &self,
        name: &str,
        inputs: &[Vec<f32>],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        let tensor = self.tensor(name)?;
        if tensor.shape.len() != 2 || inputs.iter().any(|input| input.len() != tensor.shape[1]) {
            return Err(format!("decoder batch matrix shape mismatch: {name}"));
        }
        let batch_size = inputs.len();
        let rows = tensor.shape[0];
        let columns = tensor.shape[1];
        let input_elements = columns
            .checked_mul(batch_size)
            .ok_or_else(|| "decoder batch input size overflow".to_string())?;
        let output_elements = rows
            .checked_mul(batch_size)
            .ok_or_else(|| "decoder batch output size overflow".to_string())?;
        let mut column_major = vec![0.0_f32; input_elements];
        for (beam, input) in inputs.iter().enumerate() {
            for (column, value) in input.iter().copied().enumerate() {
                column_major[column * batch_size + beam] = value;
            }
        }
        let mut row_major = vec![0.0_f32; output_elements];
        row_major
            .par_chunks_mut(batch_size)
            .enumerate()
            .try_for_each(|(row, output)| {
                if row % 64 == 0 && should_stop() {
                    return Err("decoder inference cancelled or expired".to_string());
                }
                let weights = tensor.row_slice(row)?;
                for (weight, input_column) in
                    weights.iter().zip(column_major.chunks_exact(batch_size))
                {
                    for (value, input) in output.iter_mut().zip(input_column) {
                        *value = weight.mul_add(*input, *value);
                    }
                }
                Ok::<(), String>(())
            })?;

        let mut output: Vec<Vec<f32>> = (0..batch_size).map(|_| Vec::with_capacity(rows)).collect();
        for row in row_major.chunks_exact(batch_size) {
            for (beam, value) in row.iter().copied().enumerate() {
                output[beam].push(value);
            }
        }
        Ok(output)
    }

    fn linear_batch(
        &self,
        weight: &str,
        bias: &str,
        inputs: &[Vec<f32>],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        let mut output = self.matvec_batch(weight, inputs, should_stop)?;
        let bias = self.vector(bias)?;
        for value in &mut output {
            add_in_place(value, bias)?;
        }
        Ok(output)
    }

    fn layer_norm_batch(
        &self,
        inputs: &[Vec<f32>],
        weight: &str,
        bias: &str,
    ) -> Result<Vec<Vec<f32>>, String> {
        inputs
            .iter()
            .map(|input| self.layer_norm(input, weight, bias))
            .collect()
    }

    pub(super) fn prefill_batched(
        &self,
        tokens: &[usize],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<DecoderPrefill, String> {
        if tokens.is_empty() || tokens.len() > self.maximum_context_tokens {
            return Err("decoder token context length is invalid".to_string());
        }
        let vocabulary_size = self.vocabulary_size()?;
        let mut hidden = Vec::with_capacity(tokens.len());
        for (position, token_id) in tokens.iter().copied().enumerate() {
            if token_id >= vocabulary_size {
                return Err("decoder token id is invalid".to_string());
            }
            let mut value = self.matrix_row("token_embedding.weight", token_id)?;
            let positional = self.matrix_row("position_embedding.weight", position)?;
            add_in_place(&mut value, &positional)?;
            hidden.push(value);
        }

        let mut prefix_layers = Vec::with_capacity(self.layers);
        for layer in 0..self.layers {
            if should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            let prefix = format!("blocks.layers.{layer}");
            let normalized = self.layer_norm_batch(
                &hidden,
                &format!("{prefix}.norm1.weight"),
                &format!("{prefix}.norm1.bias"),
            )?;
            let projected = self.linear_batch(
                &format!("{prefix}.self_attn.in_proj_weight"),
                &format!("{prefix}.self_attn.in_proj_bias"),
                &normalized,
                should_stop,
            )?;
            let (queries, keys, values) = split_qkv(projected, self.width)?;
            let attended = self.causal_attention(&queries, &keys, &values, should_stop)?;
            let mut attention_residual = self.linear_batch(
                &format!("{prefix}.self_attn.out_proj.weight"),
                &format!("{prefix}.self_attn.out_proj.bias"),
                &attended,
                should_stop,
            )?;
            add_batch_in_place(&mut attention_residual, &hidden)?;

            let normalized = self.layer_norm_batch(
                &attention_residual,
                &format!("{prefix}.norm2.weight"),
                &format!("{prefix}.norm2.bias"),
            )?;
            let mut feed_forward = self.linear_batch(
                &format!("{prefix}.linear1.weight"),
                &format!("{prefix}.linear1.bias"),
                &normalized,
                should_stop,
            )?;
            feed_forward
                .iter_mut()
                .flatten()
                .for_each(|value| *value = gelu(*value));
            hidden = self.linear_batch(
                &format!("{prefix}.linear2.weight"),
                &format!("{prefix}.linear2.bias"),
                &feed_forward,
                should_stop,
            )?;
            add_batch_in_place(&mut hidden, &attention_residual)?;
            prefix_layers.push(LayerKeyValueCache { keys, values });
        }

        let final_hidden = hidden
            .last()
            .ok_or_else(|| "decoder hidden state is empty".to_string())?;
        let normalized = self.layer_norm(final_hidden, "final_norm.weight", "final_norm.bias")?;
        let logits = self.matvec("output.weight", &normalized, should_stop)?;
        if should_stop() {
            return Err("decoder inference cancelled or expired".to_string());
        }
        Ok(DecoderPrefill {
            cache: DecoderCache {
                prefix: Arc::new(SharedKeyValuePrefix {
                    key_validity: tokens.iter().map(|token_id| *token_id != 0).collect(),
                    layers: prefix_layers,
                }),
                key_validity: Vec::new(),
                layers: (0..self.layers)
                    .map(|_| LayerKeyValueCache::default())
                    .collect(),
            },
            logits,
        })
    }

    pub(super) fn advance_batch(
        &self,
        caches: &mut [DecoderCache],
        token_ids: &[usize],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        if caches.len() != token_ids.len() {
            return Err("decoder batch cache/token count mismatch".to_string());
        }
        if caches.is_empty() {
            return Ok(Vec::new());
        }
        let vocabulary_size = self.vocabulary_size()?;
        let mut hidden = Vec::with_capacity(caches.len());
        let mut key_validity = Vec::with_capacity(caches.len());
        for (cache, token_id) in caches.iter().zip(token_ids.iter().copied()) {
            self.validate_cache(cache)?;
            let position = cache.prefix.key_validity.len() + cache.key_validity.len();
            if position >= self.maximum_context_tokens || token_id >= vocabulary_size {
                return Err("decoder token append is outside the model context".to_string());
            }
            let mut value = self.matrix_row("token_embedding.weight", token_id)?;
            let positional = self.matrix_row("position_embedding.weight", position)?;
            add_in_place(&mut value, &positional)?;
            hidden.push(value);
            key_validity.push(token_id != 0);
        }

        let mut pending: Vec<Vec<(Vec<f32>, Vec<f32>)>> = (0..caches.len())
            .map(|_| Vec::with_capacity(self.layers))
            .collect();
        for layer in 0..self.layers {
            if should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            let prefix = format!("blocks.layers.{layer}");
            let normalized = self.layer_norm_batch(
                &hidden,
                &format!("{prefix}.norm1.weight"),
                &format!("{prefix}.norm1.bias"),
            )?;
            let projected = self.linear_batch(
                &format!("{prefix}.self_attn.in_proj_weight"),
                &format!("{prefix}.self_attn.in_proj_bias"),
                &normalized,
                should_stop,
            )?;
            let (queries, keys, values) = split_qkv(projected, self.width)?;
            let mut attended = Vec::with_capacity(caches.len());
            for index in 0..caches.len() {
                attended.push(self.cached_attention(
                    &queries[index],
                    CachedAttentionContext {
                        prefix: &caches[index].prefix.layers[layer],
                        prefix_validity: &caches[index].prefix.key_validity,
                        delta: &caches[index].layers[layer],
                        delta_validity: &caches[index].key_validity,
                        current_key: &keys[index],
                        current_value: &values[index],
                        current_is_valid: key_validity[index],
                    },
                )?);
            }
            let mut attention_residual = self.linear_batch(
                &format!("{prefix}.self_attn.out_proj.weight"),
                &format!("{prefix}.self_attn.out_proj.bias"),
                &attended,
                should_stop,
            )?;
            add_batch_in_place(&mut attention_residual, &hidden)?;

            let normalized = self.layer_norm_batch(
                &attention_residual,
                &format!("{prefix}.norm2.weight"),
                &format!("{prefix}.norm2.bias"),
            )?;
            let mut feed_forward = self.linear_batch(
                &format!("{prefix}.linear1.weight"),
                &format!("{prefix}.linear1.bias"),
                &normalized,
                should_stop,
            )?;
            feed_forward
                .iter_mut()
                .flatten()
                .for_each(|value| *value = gelu(*value));
            hidden = self.linear_batch(
                &format!("{prefix}.linear2.weight"),
                &format!("{prefix}.linear2.bias"),
                &feed_forward,
                should_stop,
            )?;
            add_batch_in_place(&mut hidden, &attention_residual)?;
            for index in 0..pending.len() {
                pending[index].push((keys[index].clone(), values[index].clone()));
            }
        }

        let normalized = self.layer_norm_batch(&hidden, "final_norm.weight", "final_norm.bias")?;
        let logits = self.matvec_batch("output.weight", &normalized, should_stop)?;
        if should_stop() {
            return Err("decoder inference cancelled or expired".to_string());
        }
        for ((cache, layers), is_valid) in caches.iter_mut().zip(pending).zip(key_validity) {
            for (layer, (key, value)) in cache.layers.iter_mut().zip(layers) {
                layer.keys.push(key);
                layer.values.push(value);
            }
            cache.key_validity.push(is_valid);
        }
        Ok(logits)
    }
}

fn split_qkv(projected: Vec<Vec<f32>>, width: usize) -> Result<QkvBatch, String> {
    let mut queries = Vec::with_capacity(projected.len());
    let mut keys = Vec::with_capacity(projected.len());
    let mut values = Vec::with_capacity(projected.len());
    for value in projected {
        if value.len() != 3 * width {
            return Err("decoder attention projection shape mismatch".to_string());
        }
        queries.push(value[..width].to_vec());
        keys.push(value[width..2 * width].to_vec());
        values.push(value[2 * width..].to_vec());
    }
    Ok((queries, keys, values))
}

fn add_batch_in_place(target: &mut [Vec<f32>], source: &[Vec<f32>]) -> Result<(), String> {
    if target.len() != source.len() {
        return Err("decoder batch residual count mismatch".to_string());
    }
    for (target, source) in target.iter_mut().zip(source) {
        add_in_place(target, source)?;
    }
    Ok(())
}
