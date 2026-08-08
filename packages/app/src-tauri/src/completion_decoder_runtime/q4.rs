use super::DecoderRuntime;
use rayon::prelude::*;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

const GROUP_SIZE: usize = 64;
const PACKED_GROUP_BYTES: usize = GROUP_SIZE / 2;
const CANCELLATION_ROW_INTERVAL: usize = 32;

thread_local! {
    static PROFILE_SESSION: RefCell<Option<ProfileSession>> = const { RefCell::new(None) };
}

#[derive(Debug, Default)]
struct ProfileEntry {
    calls: usize,
    elapsed: Duration,
}

#[derive(Debug)]
struct ProfileSession {
    started: Instant,
    entries: BTreeMap<String, ProfileEntry>,
}

#[derive(Debug)]
pub(crate) struct DecoderProfileSnapshot {
    pub(crate) total: Duration,
    pub(crate) entries: Vec<(String, usize, Duration)>,
}

pub(crate) struct ProfileSpan {
    label: Option<String>,
    started: Option<Instant>,
}

impl Drop for ProfileSpan {
    fn drop(&mut self) {
        let (Some(label), Some(started)) = (self.label.take(), self.started.take()) else {
            return;
        };
        record_profile(label, started.elapsed());
    }
}

pub(crate) fn begin_profile() -> bool {
    if std::env::var_os("JOTLUCK_COMPLETION_PROFILE").as_deref() != Some(std::ffi::OsStr::new("1"))
    {
        return false;
    }
    PROFILE_SESSION.with(|session| {
        session.replace(Some(ProfileSession {
            started: Instant::now(),
            entries: BTreeMap::new(),
        }));
    });
    true
}

pub(crate) fn profile_span(label: &'static str) -> ProfileSpan {
    let active = PROFILE_SESSION.with(|session| session.borrow().is_some());
    ProfileSpan {
        label: active.then(|| label.to_string()),
        started: active.then(Instant::now),
    }
}

pub(crate) fn profile_span_owned(label: String) -> ProfileSpan {
    let active = PROFILE_SESSION.with(|session| session.borrow().is_some());
    ProfileSpan {
        label: active.then_some(label),
        started: active.then(Instant::now),
    }
}

pub(crate) fn finish_profile() -> Option<DecoderProfileSnapshot> {
    PROFILE_SESSION.with(|session| {
        session.take().map(|session| DecoderProfileSnapshot {
            total: session.started.elapsed(),
            entries: session
                .entries
                .into_iter()
                .map(|(label, entry)| (label, entry.calls, entry.elapsed))
                .collect(),
        })
    })
}

impl DecoderRuntime {
    pub(crate) fn begin_performance_profile(&self) -> bool {
        begin_profile()
    }

    pub(crate) fn performance_profile_span(&self, label: &'static str) -> ProfileSpan {
        profile_span(label)
    }

    pub(crate) fn performance_profile_span_owned(&self, label: String) -> ProfileSpan {
        profile_span_owned(label)
    }

    pub(crate) fn emit_performance_profile(&self, request_id: u64, language_hint: &str) {
        let Some(snapshot) = finish_profile() else {
            return;
        };
        eprint!(
            "jotluck-completion-profile request={request_id} language={language_hint} total_ms={:.3}",
            snapshot.total.as_secs_f64() * 1_000.0
        );
        for (label, calls, elapsed) in snapshot.entries {
            eprint!(
                " {label}.calls={calls} {label}.ms={:.3}",
                elapsed.as_secs_f64() * 1_000.0
            );
        }
        eprintln!();
    }
}

fn record_profile(label: String, elapsed: Duration) {
    PROFILE_SESSION.with(|session| {
        let mut session = session.borrow_mut();
        let Some(session) = session.as_mut() else {
            return;
        };
        let entry = session.entries.entry(label).or_default();
        entry.calls += 1;
        entry.elapsed += elapsed;
    });
}

#[derive(Debug)]
pub(super) struct PackedQ4Tensor {
    scales: Vec<f32>,
    values: Vec<u8>,
    elements: usize,
}

impl PackedQ4Tensor {
    pub(super) fn new(scales: Vec<f32>, values: Vec<u8>, elements: usize) -> Result<Self, String> {
        if elements == 0
            || scales
                .iter()
                .any(|scale| !scale.is_finite() || *scale <= 0.0)
        {
            return Err("decoder q4 tensor metadata is invalid".to_string());
        }
        let groups = elements.div_ceil(GROUP_SIZE);
        let expected_bytes = groups
            .checked_mul(PACKED_GROUP_BYTES)
            .ok_or_else(|| "decoder q4 tensor length overflow".to_string())?;
        if scales.len() != groups || values.len() != expected_bytes {
            return Err("decoder q4 tensor storage length is invalid".to_string());
        }
        Ok(Self {
            scales,
            values,
            elements,
        })
    }

    pub(super) fn row(&self, row: usize, columns: usize) -> Result<Vec<f32>, String> {
        let (start, end) = self.row_bounds(row, columns)?;
        (start..end)
            .map(|index| self.dequantized_value(index))
            .collect()
    }

    pub(super) fn dot_row(&self, row: usize, columns: usize, input: &[f32]) -> Result<f32, String> {
        if input.len() != columns {
            return Err("decoder dot-product shape mismatch".to_string());
        }
        let (start, _) = self.row_bounds(row, columns)?;
        #[cfg(target_arch = "x86_64")]
        if std::arch::is_x86_feature_detected!("avx2") && std::arch::is_x86_feature_detected!("fma")
        {
            // SAFETY: feature detection above guarantees AVX2/FMA support. Bounds are
            // validated by `row_bounds`; the AVX path only loads complete 64-value groups.
            return unsafe { self.dot_row_avx2(start, columns, input) };
        }
        self.dot_row_scalar(start, columns, input)
    }

    pub(super) fn matvec(
        &self,
        rows: usize,
        columns: usize,
        input: &[f32],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        self.validate_matrix_shape(rows, columns)?;
        if input.len() != columns {
            return Err("decoder dot-product shape mismatch".to_string());
        }
        if should_stop() {
            return Err(cancelled_error());
        }
        let _profile = profile_span("q4.matvec_kernel");
        #[cfg(target_arch = "x86_64")]
        if std::arch::is_x86_feature_detected!("avx2") && std::arch::is_x86_feature_detected!("fma")
        {
            // SAFETY: feature detection above guarantees AVX2/FMA support. The function
            // validates every row and only performs complete vector loads.
            return unsafe { self.matvec_avx2(rows, columns, input, should_stop) };
        }
        self.matvec_scalar(rows, columns, input, should_stop)
    }

    pub(super) fn matmul(
        &self,
        rows: usize,
        columns: usize,
        inputs: &[Vec<f32>],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        self.validate_matrix_shape(rows, columns)?;
        if inputs.iter().any(|input| input.len() != columns) {
            return Err("decoder batch matrix shape mismatch".to_string());
        }
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        let output_elements = rows
            .checked_mul(inputs.len())
            .ok_or_else(|| "decoder batch output size overflow".to_string())?;
        if should_stop() {
            return Err(cancelled_error());
        }
        let row_major = {
            let _profile = profile_span("q4.matmul_kernel");
            #[cfg(target_arch = "x86_64")]
            let row_major = if std::arch::is_x86_feature_detected!("avx2")
                && std::arch::is_x86_feature_detected!("fma")
            {
                // SAFETY: feature detection above guarantees AVX2/FMA support. Shape and
                // output sizes are checked before entering the target-feature function.
                unsafe { self.matmul_avx2(rows, columns, inputs, output_elements, should_stop)? }
            } else {
                self.matmul_scalar(rows, columns, inputs, output_elements, should_stop)?
            };
            #[cfg(not(target_arch = "x86_64"))]
            let row_major =
                self.matmul_scalar(rows, columns, inputs, output_elements, should_stop)?;
            row_major
        };
        let _profile = profile_span("q4.matmul_transpose");
        transpose_row_major(row_major, rows, inputs.len())
    }

    #[cfg(test)]
    pub(super) fn dequantized(&self) -> Result<Vec<f32>, String> {
        (0..self.elements)
            .map(|index| self.dequantized_value(index))
            .collect()
    }

    #[cfg(test)]
    pub(super) fn matmul_scalar_for_test(
        &self,
        rows: usize,
        columns: usize,
        inputs: &[Vec<f32>],
    ) -> Result<Vec<Vec<f32>>, String> {
        self.validate_matrix_shape(rows, columns)?;
        if inputs.iter().any(|input| input.len() != columns) {
            return Err("decoder batch matrix shape mismatch".to_string());
        }
        let output_elements = rows
            .checked_mul(inputs.len())
            .ok_or_else(|| "decoder batch output size overflow".to_string())?;
        let row_major = self.matmul_scalar(rows, columns, inputs, output_elements, &|| false)?;
        transpose_row_major(row_major, rows, inputs.len())
    }

    fn validate_matrix_shape(&self, rows: usize, columns: usize) -> Result<(), String> {
        let expected = rows
            .checked_mul(columns)
            .ok_or_else(|| "decoder matrix size overflow".to_string())?;
        if rows == 0 || columns == 0 || expected != self.elements {
            return Err("decoder q4 matrix storage length is invalid".to_string());
        }
        Ok(())
    }

    fn row_bounds(&self, row: usize, columns: usize) -> Result<(usize, usize), String> {
        if columns == 0 {
            return Err("decoder matrix row is invalid".to_string());
        }
        let start = row
            .checked_mul(columns)
            .ok_or_else(|| "decoder matrix row offset overflow".to_string())?;
        let end = start
            .checked_add(columns)
            .ok_or_else(|| "decoder matrix row offset overflow".to_string())?;
        if end > self.elements {
            return Err("decoder matrix row escapes storage".to_string());
        }
        Ok((start, end))
    }

    fn dequantized_value(&self, index: usize) -> Result<f32, String> {
        let (quantized, group) = self.quantized_value(index)?;
        let scale = *self
            .scales
            .get(group)
            .ok_or_else(|| "decoder quantized scale index is invalid".to_string())?;
        Ok(quantized * scale)
    }

    fn quantized_value(&self, index: usize) -> Result<(f32, usize), String> {
        if index >= self.elements {
            return Err("decoder q4 index is invalid".to_string());
        }
        let group = index / GROUP_SIZE;
        let within = index % GROUP_SIZE;
        let packed_offset = group
            .checked_mul(PACKED_GROUP_BYTES)
            .and_then(|offset| offset.checked_add(within / 2))
            .ok_or_else(|| "decoder q4 index overflow".to_string())?;
        let packed = *self
            .values
            .get(packed_offset)
            .ok_or_else(|| "decoder q4 index is invalid".to_string())?;
        let nibble = if within.is_multiple_of(2) {
            packed & 0x0f
        } else {
            packed >> 4
        };
        Ok(((i16::from(nibble) - 8) as f32, group))
    }

    fn scalar_segment(
        &self,
        flat_start: usize,
        input: &[f32],
        input_start: usize,
        length: usize,
    ) -> Result<f32, String> {
        let group = flat_start / GROUP_SIZE;
        let scale = *self
            .scales
            .get(group)
            .ok_or_else(|| "decoder quantized scale index is invalid".to_string())?;
        let mut sum = 0.0_f32;
        for offset in 0..length {
            let index = flat_start
                .checked_add(offset)
                .ok_or_else(|| "decoder q4 index overflow".to_string())?;
            let (value, actual_group) = self.quantized_value(index)?;
            if actual_group != group {
                return Err("decoder q4 segment crosses a group boundary".to_string());
            }
            let input_value = *input
                .get(input_start + offset)
                .ok_or_else(|| "decoder dot-product shape mismatch".to_string())?;
            sum = value.mul_add(input_value, sum);
        }
        Ok(sum * scale)
    }

    fn dot_row_scalar(
        &self,
        flat_start: usize,
        columns: usize,
        input: &[f32],
    ) -> Result<f32, String> {
        let mut total = 0.0_f32;
        let mut column = 0;
        while column < columns {
            let index = flat_start + column;
            let available = GROUP_SIZE - index % GROUP_SIZE;
            let length = available.min(columns - column);
            total += self.scalar_segment(index, input, column, length)?;
            column += length;
        }
        Ok(total)
    }

    fn matvec_scalar(
        &self,
        rows: usize,
        columns: usize,
        input: &[f32],
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        let mut output = Vec::with_capacity(rows);
        for row in 0..rows {
            if row.is_multiple_of(CANCELLATION_ROW_INTERVAL) && should_stop() {
                return Err(cancelled_error());
            }
            let start = row
                .checked_mul(columns)
                .ok_or_else(|| "decoder matrix row offset overflow".to_string())?;
            output.push(self.dot_row_scalar(start, columns, input)?);
        }
        Ok(output)
    }

    fn matmul_scalar(
        &self,
        rows: usize,
        columns: usize,
        inputs: &[Vec<f32>],
        output_elements: usize,
        should_stop: &(impl Fn() -> bool + Sync),
    ) -> Result<Vec<f32>, String> {
        let batch = inputs.len();
        let mut output = vec![0.0_f32; output_elements];
        for row in 0..rows {
            if row.is_multiple_of(CANCELLATION_ROW_INTERVAL) && should_stop() {
                return Err(cancelled_error());
            }
            let row_start = row
                .checked_mul(columns)
                .ok_or_else(|| "decoder matrix row offset overflow".to_string())?;
            let output_start = row
                .checked_mul(batch)
                .ok_or_else(|| "decoder batch output offset overflow".to_string())?;
            let mut column = 0;
            while column < columns {
                let index = row_start + column;
                let available = GROUP_SIZE - index % GROUP_SIZE;
                let length = available.min(columns - column);
                for (beam, input) in inputs.iter().enumerate() {
                    output[output_start + beam] +=
                        self.scalar_segment(index, input, column, length)?;
                }
                column += length;
            }
        }
        Ok(output)
    }
}

fn transpose_row_major(
    row_major: Vec<f32>,
    rows: usize,
    batch: usize,
) -> Result<Vec<Vec<f32>>, String> {
    if row_major.len()
        != rows
            .checked_mul(batch)
            .ok_or_else(|| "decoder batch output size overflow".to_string())?
    {
        return Err("decoder batch output storage is invalid".to_string());
    }
    let mut output: Vec<Vec<f32>> = (0..batch).map(|_| Vec::with_capacity(rows)).collect();
    for row in row_major.chunks_exact(batch) {
        for (beam, value) in row.iter().copied().enumerate() {
            output[beam].push(value);
        }
    }
    Ok(output)
}

fn cancelled_error() -> String {
    "decoder inference cancelled or expired".to_string()
}

#[cfg(target_arch = "x86_64")]
mod avx2 {
    use super::*;
    use std::arch::x86_64::*;

    impl PackedQ4Tensor {
        #[target_feature(enable = "avx2,fma")]
        pub(super) unsafe fn dot_row_avx2(
            &self,
            flat_start: usize,
            columns: usize,
            input: &[f32],
        ) -> Result<f32, String> {
            let mut total = 0.0_f32;
            let mut column = 0;
            while column < columns {
                let index = flat_start + column;
                let available = GROUP_SIZE - index % GROUP_SIZE;
                let length = available.min(columns - column);
                if index.is_multiple_of(GROUP_SIZE) && length == GROUP_SIZE {
                    let group = index / GROUP_SIZE;
                    let packed = self.packed_group(group)?;
                    // SAFETY: the slice contains one complete packed group and the input
                    // contains 64 values from the validated row.
                    let quantized = unsafe { expand_group(packed.as_ptr()) };
                    // SAFETY: the caller feature-checks AVX2/FMA and the 64-value input
                    // segment was validated by the public entry point.
                    let sum = unsafe { dot_expanded(&quantized, input.as_ptr().add(column)) };
                    total = sum.mul_add(self.scales[group], total);
                } else {
                    total += self.scalar_segment(index, input, column, length)?;
                }
                column += length;
            }
            Ok(total)
        }

        #[target_feature(enable = "avx2,fma")]
        pub(super) unsafe fn matvec_avx2(
            &self,
            rows: usize,
            columns: usize,
            input: &[f32],
            should_stop: &(impl Fn() -> bool + Sync),
        ) -> Result<Vec<f32>, String> {
            (0..rows)
                .into_par_iter()
                .map(|row| {
                    if row.is_multiple_of(CANCELLATION_ROW_INTERVAL) && should_stop() {
                        return Err(cancelled_error());
                    }
                    let start = row
                        .checked_mul(columns)
                        .ok_or_else(|| "decoder matrix row offset overflow".to_string())?;
                    // SAFETY: runtime feature detection guards this function; every Rayon
                    // task owns one output index and reads a validated immutable row/input.
                    unsafe { self.dot_row_avx2(start, columns, input) }
                })
                .collect()
        }

        #[target_feature(enable = "avx2,fma")]
        pub(super) unsafe fn matmul_avx2(
            &self,
            _rows: usize,
            columns: usize,
            inputs: &[Vec<f32>],
            output_elements: usize,
            should_stop: &(impl Fn() -> bool + Sync),
        ) -> Result<Vec<f32>, String> {
            let batch = inputs.len();
            let mut output = vec![0.0_f32; output_elements];
            output
                .par_chunks_mut(batch)
                .enumerate()
                .try_for_each(|(row, row_output)| {
                    if row.is_multiple_of(CANCELLATION_ROW_INTERVAL) && should_stop() {
                        return Err(cancelled_error());
                    }
                    // SAFETY: runtime feature detection guards the caller. Rayon gives each
                    // task a disjoint row output while model weights and inputs are read-only.
                    unsafe {
                        self.matmul_row_avx2(row, columns, inputs, row_output)?;
                    }
                    Ok::<(), String>(())
                })?;
            Ok(output)
        }

        #[target_feature(enable = "avx2,fma")]
        unsafe fn matmul_row_avx2(
            &self,
            row: usize,
            columns: usize,
            inputs: &[Vec<f32>],
            output: &mut [f32],
        ) -> Result<(), String> {
            if output.len() != inputs.len() {
                return Err("decoder batch output storage is invalid".to_string());
            }
            let row_start = row
                .checked_mul(columns)
                .ok_or_else(|| "decoder matrix row offset overflow".to_string())?;
            let mut column = 0;
            while column < columns {
                let index = row_start + column;
                let available = GROUP_SIZE - index % GROUP_SIZE;
                let length = available.min(columns - column);
                if index.is_multiple_of(GROUP_SIZE) && length == GROUP_SIZE {
                    let group = index / GROUP_SIZE;
                    let packed = self.packed_group(group)?;
                    // SAFETY: packed contains exactly one complete group.
                    let quantized = unsafe { expand_group(packed.as_ptr()) };
                    let scale = self.scales[group];
                    let mut beam = 0;
                    while beam + 4 <= inputs.len() {
                        // SAFETY: every input length was checked before dispatch. Each pointer
                        // addresses the same validated 64-column segment of a distinct beam.
                        let sums = unsafe {
                            dot_expanded_four(
                                &quantized,
                                [
                                    inputs[beam].as_ptr().add(column),
                                    inputs[beam + 1].as_ptr().add(column),
                                    inputs[beam + 2].as_ptr().add(column),
                                    inputs[beam + 3].as_ptr().add(column),
                                ],
                            )
                        };
                        for offset in 0..4 {
                            output[beam + offset] =
                                sums[offset].mul_add(scale, output[beam + offset]);
                        }
                        beam += 4;
                    }
                    for (beam, input) in inputs.iter().enumerate().skip(beam) {
                        // SAFETY: every input length was checked before dispatch.
                        let sum = unsafe { dot_expanded(&quantized, input.as_ptr().add(column)) };
                        output[beam] = sum.mul_add(scale, output[beam]);
                    }
                } else {
                    for (beam, input) in inputs.iter().enumerate() {
                        output[beam] += self.scalar_segment(index, input, column, length)?;
                    }
                }
                column += length;
            }
            Ok(())
        }

        fn packed_group(&self, group: usize) -> Result<&[u8], String> {
            let start = group
                .checked_mul(PACKED_GROUP_BYTES)
                .ok_or_else(|| "decoder q4 group offset overflow".to_string())?;
            let end = start
                .checked_add(PACKED_GROUP_BYTES)
                .ok_or_else(|| "decoder q4 group offset overflow".to_string())?;
            self.values
                .get(start..end)
                .ok_or_else(|| "decoder q4 group escapes storage".to_string())
        }
    }

    #[target_feature(enable = "avx2")]
    unsafe fn expand_half_group(pointer: *const u8) -> [__m256; 4] {
        // SAFETY: callers provide a pointer to at least 16 packed bytes.
        let packed = unsafe { _mm_loadu_si128(pointer.cast::<__m128i>()) };
        let mask = _mm_set1_epi8(15);
        let bias = _mm_set1_epi8(8);
        let low = _mm_and_si128(packed, mask);
        let high = _mm_and_si128(_mm_srli_epi16(packed, 4), mask);
        let first = _mm_sub_epi8(_mm_unpacklo_epi8(low, high), bias);
        let second = _mm_sub_epi8(_mm_unpackhi_epi8(low, high), bias);
        [
            _mm256_cvtepi32_ps(_mm256_cvtepi8_epi32(first)),
            _mm256_cvtepi32_ps(_mm256_cvtepi8_epi32(_mm_srli_si128(first, 8))),
            _mm256_cvtepi32_ps(_mm256_cvtepi8_epi32(second)),
            _mm256_cvtepi32_ps(_mm256_cvtepi8_epi32(_mm_srli_si128(second, 8))),
        ]
    }

    #[target_feature(enable = "avx2")]
    unsafe fn expand_group(pointer: *const u8) -> [__m256; 8] {
        // SAFETY: callers provide a pointer to one complete 32-byte packed group.
        let first = unsafe { expand_half_group(pointer) };
        // SAFETY: the second half begins 16 bytes inside that complete group.
        let second = unsafe { expand_half_group(pointer.add(16)) };
        [
            first[0], first[1], first[2], first[3], second[0], second[1], second[2], second[3],
        ]
    }

    #[target_feature(enable = "avx2,fma")]
    unsafe fn dot_expanded(quantized: &[__m256; 8], input: *const f32) -> f32 {
        let mut sum = _mm256_setzero_ps();
        for (index, values) in quantized.iter().enumerate() {
            // SAFETY: the caller guarantees 64 contiguous input values.
            let input_values = unsafe { _mm256_loadu_ps(input.add(index * 8)) };
            sum = _mm256_fmadd_ps(*values, input_values, sum);
        }
        horizontal_sum(sum)
    }

    #[target_feature(enable = "avx2,fma")]
    unsafe fn dot_expanded_four(quantized: &[__m256; 8], inputs: [*const f32; 4]) -> [f32; 4] {
        let mut sums = [_mm256_setzero_ps(); 4];
        for (index, values) in quantized.iter().enumerate() {
            for beam in 0..4 {
                // SAFETY: the caller guarantees 64 contiguous values for every beam pointer.
                let input_values = unsafe { _mm256_loadu_ps(inputs[beam].add(index * 8)) };
                sums[beam] = _mm256_fmadd_ps(*values, input_values, sums[beam]);
            }
        }
        [
            horizontal_sum(sums[0]),
            horizontal_sum(sums[1]),
            horizontal_sum(sums[2]),
            horizontal_sum(sums[3]),
        ]
    }

    #[target_feature(enable = "avx2")]
    fn horizontal_sum(value: __m256) -> f32 {
        let low = _mm256_castps256_ps128(value);
        let high = _mm256_extractf128_ps(value, 1);
        let sum = _mm_add_ps(low, high);
        let sum = _mm_hadd_ps(sum, sum);
        let sum = _mm_hadd_ps(sum, sum);
        _mm_cvtss_f32(sum)
    }
}
