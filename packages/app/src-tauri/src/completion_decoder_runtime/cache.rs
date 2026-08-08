use super::*;

pub(super) struct CachedAttentionContext<'a> {
    pub(super) prefix: &'a LayerKeyValueCache,
    pub(super) prefix_validity: &'a [bool],
    pub(super) delta: &'a LayerKeyValueCache,
    pub(super) delta_validity: &'a [bool],
    pub(super) current_key: &'a [f32],
    pub(super) current_value: &'a [f32],
    pub(super) current_is_valid: bool,
}

struct PendingTokenAppend {
    key_is_valid: bool,
    layers: Vec<(Vec<f32>, Vec<f32>)>,
    hidden: Vec<f32>,
}

impl DecoderModel {
    pub(super) fn prefill(
        &self,
        tokens: &[usize],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<DecoderPrefill, String> {
        self.prefill_batched(tokens, should_stop)
    }

    pub(super) fn advance(
        &self,
        cache: &mut DecoderCache,
        token_id: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        let pending = self.evaluate_token(cache, token_id, should_stop)?;
        let logits = self.project_output(&pending.hidden, should_stop)?;
        Self::commit_token(cache, pending);
        Ok(logits)
    }

    fn evaluate_token(
        &self,
        cache: &DecoderCache,
        token_id: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<PendingTokenAppend, String> {
        self.validate_cache(cache)?;
        let position = cache.prefix.key_validity.len() + cache.key_validity.len();
        if position >= self.maximum_context_tokens || token_id >= self.vocabulary_size()? {
            return Err("decoder token append is outside the model context".to_string());
        }
        let mut hidden = self.matrix_row("token_embedding.weight", token_id)?;
        let positional = self.matrix_row("position_embedding.weight", position)?;
        add_in_place(&mut hidden, &positional)?;
        let mut pending = Vec::with_capacity(self.layers);
        let key_is_valid = token_id != 0;

        for layer in 0..self.layers {
            if should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            let prefix = format!("blocks.layers.{layer}");
            let normalized = self.layer_norm(
                &hidden,
                &format!("{prefix}.norm1.weight"),
                &format!("{prefix}.norm1.bias"),
            )?;
            let projected = self.linear(
                &format!("{prefix}.self_attn.in_proj_weight"),
                &format!("{prefix}.self_attn.in_proj_bias"),
                &normalized,
                should_stop,
            )?;
            let query = &projected[..self.width];
            let key = projected[self.width..2 * self.width].to_vec();
            let value = projected[2 * self.width..].to_vec();
            let attention = self.cached_attention(
                query,
                CachedAttentionContext {
                    prefix: &cache.prefix.layers[layer],
                    prefix_validity: &cache.prefix.key_validity,
                    delta: &cache.layers[layer],
                    delta_validity: &cache.key_validity,
                    current_key: &key,
                    current_value: &value,
                    current_is_valid: key_is_valid,
                },
            )?;
            let mut attention_output = self.linear(
                &format!("{prefix}.self_attn.out_proj.weight"),
                &format!("{prefix}.self_attn.out_proj.bias"),
                &attention,
                should_stop,
            )?;
            add_in_place(&mut attention_output, &hidden)?;
            let normalized = self.layer_norm(
                &attention_output,
                &format!("{prefix}.norm2.weight"),
                &format!("{prefix}.norm2.bias"),
            )?;
            let mut feed_forward = self.linear(
                &format!("{prefix}.linear1.weight"),
                &format!("{prefix}.linear1.bias"),
                &normalized,
                should_stop,
            )?;
            feed_forward.iter_mut().for_each(|item| *item = gelu(*item));
            hidden = self.linear(
                &format!("{prefix}.linear2.weight"),
                &format!("{prefix}.linear2.bias"),
                &feed_forward,
                should_stop,
            )?;
            add_in_place(&mut hidden, &attention_output)?;
            pending.push((key, value));
        }

        Ok(PendingTokenAppend {
            key_is_valid,
            layers: pending,
            hidden,
        })
    }

    fn project_output(
        &self,
        hidden: &[f32],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        let normalized = self.layer_norm(hidden, "final_norm.weight", "final_norm.bias")?;
        self.matvec("output.weight", &normalized, should_stop)
    }

    fn commit_token(cache: &mut DecoderCache, pending: PendingTokenAppend) {
        for (layer, (key, value)) in cache.layers.iter_mut().zip(pending.layers) {
            layer.keys.push(key);
            layer.values.push(value);
        }
        cache.key_validity.push(pending.key_is_valid);
    }

    pub(super) fn validate_cache(&self, cache: &DecoderCache) -> Result<(), String> {
        if cache.prefix.layers.len() != self.layers
            || cache.layers.len() != self.layers
            || cache.prefix.layers.iter().any(|layer| {
                layer.keys.len() != cache.prefix.key_validity.len()
                    || layer.values.len() != cache.prefix.key_validity.len()
                    || layer.keys.iter().any(|value| value.len() != self.width)
                    || layer.values.iter().any(|value| value.len() != self.width)
            })
            || cache.layers.iter().any(|layer| {
                layer.keys.len() != cache.key_validity.len()
                    || layer.values.len() != cache.key_validity.len()
                    || layer.keys.iter().any(|value| value.len() != self.width)
                    || layer.values.iter().any(|value| value.len() != self.width)
            })
        {
            return Err("decoder KV cache is inconsistent".to_string());
        }
        Ok(())
    }

    pub(super) fn cached_attention(
        &self,
        query: &[f32],
        context: CachedAttentionContext<'_>,
    ) -> Result<Vec<f32>, String> {
        let head_width = self.width / self.heads;
        let scale = (head_width as f32).sqrt().recip();
        let mut output = vec![0.0; self.width];
        for head in 0..self.heads {
            let start = head * head_width;
            let end = start + head_width;
            let mut scores =
                Vec::with_capacity(context.prefix.keys.len() + context.delta.keys.len() + 1);
            let mut values =
                Vec::with_capacity(context.prefix.values.len() + context.delta.values.len() + 1);
            for ((key, value), valid) in context
                .prefix
                .keys
                .iter()
                .zip(&context.prefix.values)
                .zip(context.prefix_validity)
            {
                if *valid {
                    scores.push(dot(&query[start..end], &key[start..end])? * scale);
                    values.push(value.as_slice());
                }
            }
            for ((key, value), valid) in context
                .delta
                .keys
                .iter()
                .zip(&context.delta.values)
                .zip(context.delta_validity)
            {
                if *valid {
                    scores.push(dot(&query[start..end], &key[start..end])? * scale);
                    values.push(value.as_slice());
                }
            }
            if context.current_is_valid {
                scores.push(dot(&query[start..end], &context.current_key[start..end])? * scale);
                values.push(context.current_value);
            }
            if scores.is_empty() {
                return Err("decoder attention has no valid key".to_string());
            }
            softmax_in_place(&mut scores)?;
            for (value, probability) in values.into_iter().zip(scores) {
                for offset in 0..head_width {
                    output[start + offset] += probability * value[start + offset];
                }
            }
        }
        Ok(output)
    }
}
