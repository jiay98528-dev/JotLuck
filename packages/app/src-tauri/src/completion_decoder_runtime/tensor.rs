use super::*;

impl Tensor {
    pub(super) fn matrix_values(&self) -> Result<&[f32], String> {
        if self.shape.len() != 2 {
            return Err("decoder matrix shape is invalid".to_string());
        }
        let expected = self.shape[0]
            .checked_mul(self.shape[1])
            .ok_or_else(|| "decoder matrix size overflow".to_string())?;
        let values = match &self.storage {
            TensorStorage::Float(values) | TensorStorage::Dequantized(values) => values,
        };
        if values.len() != expected {
            return Err("decoder matrix storage length is invalid".to_string());
        }
        Ok(values)
    }

    pub(super) fn row_slice(&self, row: usize) -> Result<&[f32], String> {
        if self.shape.len() != 2 || row >= self.shape[0] {
            return Err("decoder matrix row is invalid".to_string());
        }
        let columns = self.shape[1];
        self.matrix_values()?
            .get(row * columns..(row + 1) * columns)
            .ok_or_else(|| "decoder matrix row escapes storage".to_string())
    }

    pub(super) fn row(&self, row: usize) -> Result<Vec<f32>, String> {
        self.row_slice(row).map(<[f32]>::to_vec)
    }

    pub(super) fn dot_row(&self, row: usize, input: &[f32]) -> Result<f32, String> {
        dot(self.row_slice(row)?, input)
    }
}

pub(super) fn parse_envelope(bytes: &[u8]) -> Result<(ModelHeader, &[u8]), String> {
    if bytes.len() < 12 || &bytes[..8] != MODEL_MAGIC {
        return Err("decoder model magic is invalid".to_string());
    }
    let length = u32::from_le_bytes(
        bytes[8..12]
            .try_into()
            .map_err(|_| "decoder model header length is invalid".to_string())?,
    ) as usize;
    if length == 0 || length > MAX_HEADER_BYTES || 12 + length > bytes.len() {
        return Err("decoder model header length is invalid".to_string());
    }
    let header: ModelHeader = serde_json::from_slice(&bytes[12..12 + length])
        .map_err(|error| format!("invalid decoder model header: {error}"))?;
    let payload = &bytes[12 + length..];
    let actual = format!("{:x}", Sha256::digest(payload));
    if header.payload_sha256 != actual {
        return Err("decoder model payload SHA-256 mismatch".to_string());
    }
    Ok((header, payload))
}

pub(super) fn required<T>(value: Option<T>, field: &str) -> Result<T, String> {
    value.ok_or_else(|| format!("decoder tensor {field} is missing"))
}

pub(super) fn element_count(shape: &[usize]) -> Result<usize, String> {
    if shape.is_empty() || shape.contains(&0) {
        return Err("decoder tensor shape is invalid".to_string());
    }
    shape.iter().try_fold(1_usize, |total, dimension| {
        total
            .checked_mul(*dimension)
            .ok_or_else(|| "decoder tensor shape overflow".to_string())
    })
}

pub(super) fn slice(payload: &[u8], offset: usize, length: usize) -> Result<&[u8], String> {
    payload
        .get(offset..offset.saturating_add(length))
        .filter(|value| value.len() == length)
        .ok_or_else(|| "decoder tensor escapes its payload".to_string())
}

pub(super) fn read_f16(payload: &[u8], offset: usize, length: usize) -> Result<Vec<f32>, String> {
    let bytes = slice(payload, offset, length)?;
    if bytes.len() % 2 != 0 {
        return Err("decoder f16 payload length is invalid".to_string());
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|item| half_to_f32(u16::from_le_bytes([item[0], item[1]])))
        .collect())
}

pub(super) fn half_to_f32(value: u16) -> f32 {
    let sign = u32::from(value & 0x8000) << 16;
    let exponent = (value >> 10) & 0x1f;
    let mantissa = u32::from(value & 0x03ff);
    let bits = match exponent {
        0 if mantissa == 0 => sign,
        0 => {
            let mut normalized = mantissa;
            let mut shift = 0_u32;
            while normalized & 0x400 == 0 {
                normalized <<= 1;
                shift += 1;
            }
            sign | ((113_u32 - shift) << 23) | ((normalized & 0x3ff) << 13)
        }
        0x1f => sign | 0x7f80_0000 | (mantissa << 13),
        _ => sign | ((u32::from(exponent) + 112) << 23) | (mantissa << 13),
    };
    f32::from_bits(bits)
}

pub(super) fn quantized_value(
    bits: u8,
    group_size: usize,
    scales: &[f32],
    values: &[u8],
    index: usize,
) -> Result<f32, String> {
    let group = index / group_size;
    let within = index % group_size;
    let scale = *scales
        .get(group)
        .ok_or_else(|| "decoder quantized scale index is invalid".to_string())?;
    let quantized = if bits == 4 {
        let packed = *values
            .get(group * (group_size / 2) + within / 2)
            .ok_or_else(|| "decoder q4 index is invalid".to_string())?;
        let nibble = if within.is_multiple_of(2) {
            packed & 0x0f
        } else {
            packed >> 4
        };
        i16::from(nibble) - 8
    } else {
        i16::from(i8::from_le_bytes([*values
            .get(group * group_size + within)
            .ok_or_else(|| "decoder q8 index is invalid".to_string())?]))
    };
    Ok(quantized as f32 * scale)
}

pub(super) fn dequantize_tensor(
    bits: u8,
    group_size: usize,
    scales: &[f32],
    values: &[u8],
    elements: usize,
) -> Result<Vec<f32>, String> {
    let mut output = Vec::with_capacity(elements);
    for index in 0..elements {
        output.push(quantized_value(bits, group_size, scales, values, index)?);
    }
    Ok(output)
}

pub(super) fn add_in_place(target: &mut [f32], source: &[f32]) -> Result<(), String> {
    if target.len() != source.len() {
        return Err("decoder residual shape mismatch".to_string());
    }
    for (target, source) in target.iter_mut().zip(source) {
        *target += *source;
    }
    Ok(())
}

pub(super) fn dot(left: &[f32], right: &[f32]) -> Result<f32, String> {
    if left.len() != right.len() {
        return Err("decoder dot-product shape mismatch".to_string());
    }
    Ok(left
        .iter()
        .zip(right)
        .fold(0.0, |total, (left, right)| left.mul_add(*right, total)))
}

pub(super) fn softmax_in_place(values: &mut [f32]) -> Result<(), String> {
    let maximum = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut total = 0.0;
    for value in values.iter_mut() {
        *value = (*value - maximum).exp();
        total += *value;
    }
    if !total.is_finite() || total <= 0.0 {
        return Err("decoder attention softmax is invalid".to_string());
    }
    values.iter_mut().for_each(|value| *value /= total);
    Ok(())
}

pub(super) fn gelu(value: f32) -> f32 {
    0.5 * value * (1.0 + erf(value / std::f32::consts::SQRT_2))
}

pub(super) fn erf(value: f32) -> f32 {
    let sign = value.signum();
    let absolute = value.abs();
    let t = 1.0 / (1.0 + 0.327_591_1 * absolute);
    let polynomial = (((((1.061_405_4 * t - 1.453_152_1) * t) + 1.421_413_8) * t - 0.284_496_72)
        * t
        + 0.254_829_6)
        * t;
    sign * (1.0 - polynomial * (-absolute * absolute).exp())
}
