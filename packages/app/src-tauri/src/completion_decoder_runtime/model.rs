use super::*;
use rayon::prelude::*;

pub(super) const PARALLEL_MATVEC_MIN_ROWS: usize = 128;
pub(super) const PARALLEL_MATVEC_MIN_OPERATIONS: usize = 128 * 1024;

impl DecoderModel {
    pub(super) fn load(path: &Path) -> Result<Self, String> {
        let bytes = fs::read(path)
            .map_err(|error| format!("unable to read quantized decoder model: {error}"))?;
        let (header, payload) = parse_envelope(&bytes)?;
        if header.schema != MODEL_SCHEMA
            || header.vocabulary_size != 8_000
            || header.maximum_context_tokens != 256
            || header.architecture.width == 0
            || header.architecture.layers == 0
            || header.architecture.heads == 0
            || header.architecture.width % header.architecture.heads != 0
            || !header.architecture.layer_norm_epsilon.is_finite()
            || header.architecture.layer_norm_epsilon <= 0.0
        {
            return Err("decoder model runtime header is invalid".to_string());
        }
        let mut tensors = HashMap::new();
        let mut aliases = HashMap::new();
        for descriptor in header.tensors {
            if let Some(target) = descriptor.alias_of {
                aliases.insert(descriptor.name, target);
                continue;
            }
            let shape = descriptor
                .shape
                .ok_or_else(|| "decoder runtime tensor shape is missing".to_string())?;
            let elements = element_count(&shape)?;
            let dtype = descriptor
                .dtype
                .ok_or_else(|| "decoder runtime tensor dtype is missing".to_string())?;
            let storage = match dtype.as_str() {
                "f16" => {
                    let offset = required(descriptor.offset, "offset")?;
                    let length = required(descriptor.bytes, "bytes")?;
                    if length != elements.saturating_mul(2) {
                        return Err("decoder f16 tensor length is invalid".to_string());
                    }
                    TensorStorage::Float(read_f16(payload, offset, length)?)
                }
                "q4" | "q8" => {
                    let bits = if dtype == "q4" { 4 } else { 8 };
                    let group_size = required(descriptor.group_size, "groupSize")?;
                    let groups = required(descriptor.groups, "groups")?;
                    if group_size != 64 || groups != elements.div_ceil(group_size) {
                        return Err("decoder quantized tensor groups are invalid".to_string());
                    }
                    let scale_offset = required(descriptor.scale_offset, "scaleOffset")?;
                    let scale_bytes = required(descriptor.scale_bytes, "scaleBytes")?;
                    let offset = required(descriptor.offset, "offset")?;
                    let length = required(descriptor.bytes, "bytes")?;
                    let expected_length = groups
                        .checked_mul(if bits == 4 {
                            group_size / 2
                        } else {
                            group_size
                        })
                        .ok_or_else(|| "decoder quantized tensor length overflow".to_string())?;
                    if scale_bytes != groups.saturating_mul(2) || length != expected_length {
                        return Err("decoder quantized tensor length is invalid".to_string());
                    }
                    let scales = read_f16(payload, scale_offset, scale_bytes)?;
                    if scales
                        .iter()
                        .any(|scale| !scale.is_finite() || *scale <= 0.0)
                    {
                        return Err("decoder quantized tensor scale is invalid".to_string());
                    }
                    let values = slice(payload, offset, length)?;
                    TensorStorage::Dequantized(dequantize_tensor(
                        bits, group_size, &scales, values, elements,
                    )?)
                }
                _ => return Err("decoder runtime tensor dtype is invalid".to_string()),
            };
            if tensors
                .insert(descriptor.name, Tensor { shape, storage })
                .is_some()
            {
                return Err("decoder runtime tensor name is duplicated".to_string());
            }
        }
        for (alias, target) in &aliases {
            if alias == target || !tensors.contains_key(target) {
                return Err("decoder runtime tensor alias is invalid".to_string());
            }
        }
        Ok(Self {
            width: header.architecture.width,
            layers: header.architecture.layers,
            heads: header.architecture.heads,
            layer_norm_epsilon: header.architecture.layer_norm_epsilon,
            maximum_context_tokens: header.maximum_context_tokens,
            tensors,
            aliases,
        })
    }

    pub(super) fn vocabulary_size(&self) -> Result<usize, String> {
        self.tensor("token_embedding.weight")?
            .shape
            .first()
            .copied()
            .ok_or_else(|| "decoder embedding shape is invalid".to_string())
    }

    #[cfg(test)]
    pub(super) fn next_token_logits(
        &self,
        tokens: &[usize],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        if tokens.is_empty() || tokens.len() > self.maximum_context_tokens {
            return Err("decoder token context length is invalid".to_string());
        }
        let mut hidden = Vec::with_capacity(tokens.len());
        for (position, token) in tokens.iter().enumerate() {
            if *token >= self.vocabulary_size()? {
                return Err("decoder token id is invalid".to_string());
            }
            let mut value = self.matrix_row("token_embedding.weight", *token)?;
            let positional = self.matrix_row("position_embedding.weight", position)?;
            add_in_place(&mut value, &positional)?;
            hidden.push(value);
        }

        for layer in 0..self.layers {
            if should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            hidden = self.forward_layer(layer, &hidden, should_stop)?;
        }
        let final_hidden = hidden
            .last()
            .ok_or_else(|| "decoder hidden state is empty".to_string())?;
        let normalized = self.layer_norm(final_hidden, "final_norm.weight", "final_norm.bias")?;
        self.matvec("output.weight", &normalized, should_stop)
    }

    pub(super) fn parity_trace(&self, tokens: &[usize]) -> Result<DecoderParityTrace, String> {
        if tokens.is_empty() || tokens.len() > self.maximum_context_tokens {
            return Err("decoder token context length is invalid".to_string());
        }
        let vocabulary_size = self.vocabulary_size()?;
        let mut hidden = Vec::with_capacity(tokens.len());
        for (position, token) in tokens.iter().enumerate() {
            if *token >= vocabulary_size {
                return Err("decoder token id is invalid".to_string());
            }
            let mut value = self.matrix_row("token_embedding.weight", *token)?;
            let positional = self.matrix_row("position_embedding.weight", position)?;
            add_in_place(&mut value, &positional)?;
            hidden.push(value);
        }
        let embedding_last = hidden
            .last()
            .cloned()
            .ok_or_else(|| "decoder hidden state is empty".to_string())?;
        let mut layer_last = Vec::with_capacity(self.layers);
        for layer in 0..self.layers {
            hidden = self.forward_layer(layer, &hidden, &|| false)?;
            layer_last.push(
                hidden
                    .last()
                    .cloned()
                    .ok_or_else(|| "decoder hidden state is empty".to_string())?,
            );
        }
        let final_hidden = hidden
            .last()
            .ok_or_else(|| "decoder hidden state is empty".to_string())?;
        let final_norm_last =
            self.layer_norm(final_hidden, "final_norm.weight", "final_norm.bias")?;
        let logits = self.matvec("output.weight", &final_norm_last, &|| false)?;
        Ok(DecoderParityTrace {
            embedding_last,
            layer_last,
            final_norm_last,
            logits,
        })
    }

    pub(super) fn forward_layer(
        &self,
        layer: usize,
        hidden: &[Vec<f32>],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        let prefix = format!("blocks.layers.{layer}");
        let normalized: Vec<Vec<f32>> = hidden
            .iter()
            .map(|value| {
                self.layer_norm(
                    value,
                    &format!("{prefix}.norm1.weight"),
                    &format!("{prefix}.norm1.bias"),
                )
            })
            .collect::<Result<_, _>>()?;
        let mut queries = Vec::with_capacity(hidden.len());
        let mut keys = Vec::with_capacity(hidden.len());
        let mut values = Vec::with_capacity(hidden.len());
        for value in &normalized {
            let projected = self.linear(
                &format!("{prefix}.self_attn.in_proj_weight"),
                &format!("{prefix}.self_attn.in_proj_bias"),
                value,
                should_stop,
            )?;
            queries.push(projected[..self.width].to_vec());
            keys.push(projected[self.width..2 * self.width].to_vec());
            values.push(projected[2 * self.width..].to_vec());
        }
        let attended = self.causal_attention(&queries, &keys, &values, should_stop)?;
        let mut attention_residual = Vec::with_capacity(hidden.len());
        for (source, attention) in hidden.iter().zip(attended) {
            let mut projected = self.linear(
                &format!("{prefix}.self_attn.out_proj.weight"),
                &format!("{prefix}.self_attn.out_proj.bias"),
                &attention,
                should_stop,
            )?;
            add_in_place(&mut projected, source)?;
            attention_residual.push(projected);
        }

        let mut output = Vec::with_capacity(hidden.len());
        for value in &attention_residual {
            let normalized = self.layer_norm(
                value,
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
            let mut projected = self.linear(
                &format!("{prefix}.linear2.weight"),
                &format!("{prefix}.linear2.bias"),
                &feed_forward,
                should_stop,
            )?;
            add_in_place(&mut projected, value)?;
            output.push(projected);
        }
        Ok(output)
    }

    pub(super) fn causal_attention(
        &self,
        queries: &[Vec<f32>],
        keys: &[Vec<f32>],
        values: &[Vec<f32>],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        let head_width = self.width / self.heads;
        let scale = (head_width as f32).sqrt().recip();
        let mut output = vec![vec![0.0; self.width]; queries.len()];
        for position in 0..queries.len() {
            if position % 8 == 0 && should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            for head in 0..self.heads {
                let start = head * head_width;
                let end = start + head_width;
                let mut scores = Vec::with_capacity(position + 1);
                for key in keys.iter().take(position + 1) {
                    scores.push(dot(&queries[position][start..end], &key[start..end])? * scale);
                }
                softmax_in_place(&mut scores)?;
                for (source, probability) in values.iter().take(position + 1).zip(scores) {
                    for offset in 0..head_width {
                        output[position][start + offset] += probability * source[start + offset];
                    }
                }
            }
        }
        Ok(output)
    }

    pub(super) fn linear(
        &self,
        weight: &str,
        bias: &str,
        input: &[f32],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        let mut output = self.matvec(weight, input, should_stop)?;
        let bias = self.vector(bias)?;
        add_in_place(&mut output, bias)?;
        Ok(output)
    }

    pub(super) fn layer_norm(
        &self,
        input: &[f32],
        weight: &str,
        bias: &str,
    ) -> Result<Vec<f32>, String> {
        let weight = self.vector(weight)?;
        let bias = self.vector(bias)?;
        if input.len() != weight.len() || input.len() != bias.len() || input.is_empty() {
            return Err("decoder layer norm shape mismatch".to_string());
        }
        let mean = input.iter().sum::<f32>() / input.len() as f32;
        let variance = input
            .iter()
            .map(|value| {
                let difference = *value - mean;
                difference * difference
            })
            .sum::<f32>()
            / input.len() as f32;
        let denominator = (variance + self.layer_norm_epsilon).sqrt();
        Ok(input
            .iter()
            .zip(weight)
            .zip(bias)
            .map(|((value, scale), offset)| {
                ((*value - mean) / denominator).mul_add(*scale, *offset)
            })
            .collect())
    }

    pub(super) fn matvec(
        &self,
        name: &str,
        input: &[f32],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        let tensor = self.tensor(name)?;
        if tensor.shape.len() != 2 || tensor.shape[1] != input.len() {
            return Err(format!("decoder matrix shape mismatch: {name}"));
        }
        let rows = tensor.shape[0];
        if rows >= PARALLEL_MATVEC_MIN_ROWS
            && rows.saturating_mul(input.len()) >= PARALLEL_MATVEC_MIN_OPERATIONS
        {
            return (0..rows)
                .into_par_iter()
                .map(|row| {
                    if row % 64 == 0 && should_stop() {
                        return Err("decoder inference cancelled or expired".to_string());
                    }
                    tensor.dot_row(row, input)
                })
                .collect();
        }
        let mut output = Vec::with_capacity(tensor.shape[0]);
        for row in 0..rows {
            if row % 64 == 0 && should_stop() {
                return Err("decoder inference cancelled or expired".to_string());
            }
            output.push(tensor.dot_row(row, input)?);
        }
        Ok(output)
    }

    pub(super) fn matrix_row(&self, name: &str, row: usize) -> Result<Vec<f32>, String> {
        let tensor = self.tensor(name)?;
        if tensor.shape.len() != 2 || row >= tensor.shape[0] {
            return Err(format!("decoder matrix row is invalid: {name}"));
        }
        tensor.row(row)
    }

    pub(super) fn vector(&self, name: &str) -> Result<&[f32], String> {
        let tensor = self.tensor(name)?;
        if tensor.shape.len() != 1 {
            return Err(format!("decoder vector shape mismatch: {name}"));
        }
        match &tensor.storage {
            TensorStorage::Float(values) => Ok(values),
            TensorStorage::Dequantized(_) => {
                Err(format!("decoder vector storage is invalid: {name}"))
            }
        }
    }

    pub(super) fn tensor(&self, name: &str) -> Result<&Tensor, String> {
        let resolved = self.aliases.get(name).map_or(name, String::as_str);
        self.tensors
            .get(resolved)
            .ok_or_else(|| format!("decoder tensor is missing: {name}"))
    }
}
