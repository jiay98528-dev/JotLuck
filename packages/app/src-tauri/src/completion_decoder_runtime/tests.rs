use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

#[test]
fn half_conversion_covers_normal_subnormal_and_infinity() {
    assert_eq!(half_to_f32(0x3c00), 1.0);
    assert!(half_to_f32(0x0001) > 0.0);
    assert!(half_to_f32(0x7c00).is_infinite());
}

#[test]
fn q4_and_q8_values_use_group_scales() {
    let q4 = vec![0x8f; 32];
    assert_eq!(quantized_value(4, 64, &[0.5], &q4, 0).unwrap(), 3.5);
    assert_eq!(quantized_value(4, 64, &[0.5], &q4, 1).unwrap(), 0.0);
    assert_eq!(
        quantized_value(8, 64, &[0.25], &[0xff; 64], 2).unwrap(),
        -0.25
    );
    assert_eq!(
        dequantize_tensor(4, 64, &[0.5], &q4, 2).unwrap(),
        vec![3.5, 0.0]
    );
}

#[test]
fn stable_softmax_is_normalized() {
    let mut values = vec![1_000.0, 999.0];
    softmax_in_place(&mut values).unwrap();
    assert!((values.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    assert!(values[0] > values[1]);
}

fn float_tensor(shape: &[usize], values: Vec<f32>) -> Tensor {
    Tensor {
        shape: shape.to_vec(),
        storage: TensorStorage::Float(values),
    }
}

fn packed_q4_tensor(rows: usize, columns: usize) -> (Tensor, Vec<f32>) {
    let elements = rows.checked_mul(columns).unwrap();
    let groups = elements.div_ceil(64);
    let scales: Vec<f32> = (0..groups)
        .map(|group| ((group % 4) + 1) as f32 / 32.0)
        .collect();
    let mut packed = vec![0x88_u8; groups * 32];
    let mut reference = Vec::with_capacity(elements);
    for index in 0..elements {
        let group = index / 64;
        let within = index % 64;
        let quantized = ((index * 7 + group * 3 + 5) % 16) as u8;
        let packed_index = group * 32 + within / 2;
        if within.is_multiple_of(2) {
            packed[packed_index] = (packed[packed_index] & 0xf0) | quantized;
        } else {
            packed[packed_index] = (packed[packed_index] & 0x0f) | (quantized << 4);
        }
        reference.push((i16::from(quantized) - 8) as f32 * scales[group]);
    }
    (
        Tensor {
            shape: vec![rows, columns],
            storage: TensorStorage::PackedQ4(
                PackedQ4Tensor::new(scales, packed, elements).unwrap(),
            ),
        },
        reference,
    )
}

fn q4_inputs(batch: usize, columns: usize) -> Vec<Vec<f32>> {
    (0..batch)
        .map(|beam| {
            (0..columns)
                .map(|column| {
                    let index = beam * columns + column;
                    ((index % 23) as f32 - 11.0) / 19.0
                })
                .collect()
        })
        .collect()
}

fn reference_matmul(
    values: &[f32],
    rows: usize,
    columns: usize,
    inputs: &[Vec<f32>],
) -> Vec<Vec<f32>> {
    inputs
        .iter()
        .map(|input| {
            values
                .chunks_exact(columns)
                .take(rows)
                .map(|weights| dot(weights, input).unwrap())
                .collect()
        })
        .collect()
}

fn assert_vectors_close(actual: &[f32], expected: &[f32], absolute: f32, relative: f32) {
    assert_eq!(actual.len(), expected.len());
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        let difference = (*actual - *expected).abs();
        let tolerance = absolute + relative * expected.abs();
        assert!(
            difference <= tolerance,
            "value {index} differs: actual={actual} expected={expected} difference={difference} tolerance={tolerance}"
        );
    }
}

fn maximum_difference(actual: &[f32], expected: &[f32]) -> f32 {
    actual
        .iter()
        .zip(expected)
        .map(|(actual, expected)| (*actual - *expected).abs())
        .fold(0.0_f32, f32::max)
}

fn assert_batches_close(actual: &[Vec<f32>], expected: &[Vec<f32>], absolute: f32, relative: f32) {
    assert_eq!(actual.len(), expected.len());
    for (actual, expected) in actual.iter().zip(expected) {
        assert_vectors_close(actual, expected, absolute, relative);
    }
}

fn dequantize_q4_tensors_for_reference(model: &mut DecoderModel) {
    let names: Vec<String> = model.tensors.keys().cloned().collect();
    for name in names {
        let values = match &model.tensors[&name].storage {
            TensorStorage::PackedQ4(storage) => Some(storage.dequantized().unwrap()),
            TensorStorage::Dequantized(_) | TensorStorage::Float(_) => None,
        };
        if let Some(values) = values {
            model.tensors.get_mut(&name).unwrap().storage = TensorStorage::Dequantized(values);
        }
    }
}

fn assert_cache_close(
    actual: &DecoderCache,
    expected: &DecoderCache,
    absolute: f32,
    relative: f32,
) {
    assert_eq!(actual.prefix.key_validity, expected.prefix.key_validity);
    assert_eq!(actual.key_validity, expected.key_validity);
    assert_eq!(actual.prefix.layers.len(), expected.prefix.layers.len());
    assert_eq!(actual.layers.len(), expected.layers.len());
    for (actual, expected) in actual.prefix.layers.iter().zip(&expected.prefix.layers) {
        assert_batches_close(&actual.keys, &expected.keys, absolute, relative);
        assert_batches_close(&actual.values, &expected.values, absolute, relative);
    }
    for (actual, expected) in actual.layers.iter().zip(&expected.layers) {
        assert_batches_close(&actual.keys, &expected.keys, absolute, relative);
        assert_batches_close(&actual.values, &expected.values, absolute, relative);
    }
}

fn synthetic_model() -> DecoderModel {
    let width = 2;
    let vocabulary = 4;
    let context = 8;
    let mut tensors = HashMap::new();
    tensors.insert(
        "token_embedding.weight".to_string(),
        float_tensor(
            &[vocabulary, width],
            vec![0.0, 0.0, 0.3, -0.2, -0.4, 0.5, 0.7, 0.1],
        ),
    );
    tensors.insert(
        "position_embedding.weight".to_string(),
        float_tensor(&[context, width], vec![0.0; context * width]),
    );
    tensors.insert(
        "output.weight".to_string(),
        float_tensor(
            &[vocabulary, width],
            vec![0.0, 0.0, 0.3, -0.2, -0.4, 0.5, 0.7, 0.1],
        ),
    );
    tensors.insert(
        "final_norm.weight".to_string(),
        float_tensor(&[width], vec![1.0; width]),
    );
    tensors.insert(
        "final_norm.bias".to_string(),
        float_tensor(&[width], vec![0.0; width]),
    );
    let prefix = "blocks.layers.0";
    tensors.insert(
        format!("{prefix}.self_attn.in_proj_weight"),
        float_tensor(
            &[3 * width, width],
            vec![1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
        ),
    );
    tensors.insert(
        format!("{prefix}.self_attn.in_proj_bias"),
        float_tensor(&[3 * width], vec![0.0; 3 * width]),
    );
    tensors.insert(
        format!("{prefix}.self_attn.out_proj.weight"),
        float_tensor(&[width, width], vec![1.0, 0.0, 0.0, 1.0]),
    );
    tensors.insert(
        format!("{prefix}.self_attn.out_proj.bias"),
        float_tensor(&[width], vec![0.0; width]),
    );
    tensors.insert(
        format!("{prefix}.linear1.weight"),
        float_tensor(&[width, width], vec![0.2, -0.1, 0.1, 0.3]),
    );
    tensors.insert(
        format!("{prefix}.linear1.bias"),
        float_tensor(&[width], vec![0.0; width]),
    );
    tensors.insert(
        format!("{prefix}.linear2.weight"),
        float_tensor(&[width, width], vec![0.1, 0.2, -0.2, 0.1]),
    );
    tensors.insert(
        format!("{prefix}.linear2.bias"),
        float_tensor(&[width], vec![0.0; width]),
    );
    for norm in ["norm1", "norm2"] {
        tensors.insert(
            format!("{prefix}.{norm}.weight"),
            float_tensor(&[width], vec![1.0; width]),
        );
        tensors.insert(
            format!("{prefix}.{norm}.bias"),
            float_tensor(&[width], vec![0.0; width]),
        );
    }
    DecoderModel {
        width,
        layers: 1,
        heads: 1,
        layer_norm_epsilon: 1e-5,
        maximum_context_tokens: context,
        tensors,
        aliases: HashMap::new(),
    }
}

#[test]
fn packed_q4_batch_matches_dequantized_reference_for_beam_sizes_and_tails() {
    let rows = 7;
    let columns = 70;
    let (tensor, reference) = packed_q4_tensor(rows, columns);
    let mut model = synthetic_model();
    model.tensors.insert("q4.weight".to_string(), tensor);
    let tensor = model.tensor("q4.weight").unwrap();
    let storage = match &tensor.storage {
        TensorStorage::PackedQ4(storage) => storage,
        TensorStorage::Dequantized(_) | TensorStorage::Float(_) => panic!("q4 was unpacked"),
    };

    assert!(tensor.matrix_values().is_err());
    for row in 0..rows {
        assert_vectors_close(
            &tensor.row(row).unwrap(),
            &reference[row * columns..(row + 1) * columns],
            0.0,
            0.0,
        );
    }

    for batch in [1, 3, 6, 13, 32] {
        let inputs = q4_inputs(batch, columns);
        let expected = reference_matmul(&reference, rows, columns, &inputs);
        let scalar = storage
            .matmul_scalar_for_test(rows, columns, &inputs)
            .unwrap();
        let direct = storage.matmul(rows, columns, &inputs, &|| false).unwrap();
        let dispatched = model.matvec_batch("q4.weight", &inputs, &|| false).unwrap();
        assert_batches_close(&scalar, &expected, 2e-6, 2e-6);
        assert_batches_close(&direct, &expected, 2e-6, 2e-6);
        assert_eq!(dispatched, direct);
        assert_eq!(
            direct,
            storage.matmul(rows, columns, &inputs, &|| false).unwrap()
        );
    }
}

#[test]
fn packed_q4_matvec_and_metadata_fail_closed() {
    assert!(PackedQ4Tensor::new(vec![1.0], vec![0; 31], 64).is_err());
    assert!(PackedQ4Tensor::new(vec![0.0], vec![0; 32], 64).is_err());
    assert!(PackedQ4Tensor::new(vec![f32::NAN], vec![0; 32], 64).is_err());
    assert!(PackedQ4Tensor::new(vec![1.0], vec![0; 32], 0).is_err());

    let rows = 9;
    let columns = 65;
    let (tensor, reference) = packed_q4_tensor(rows, columns);
    let input = q4_inputs(1, columns).pop().unwrap();
    let mut model = synthetic_model();
    model.tensors.insert("q4.weight".to_string(), tensor);

    let expected = reference_matmul(&reference, rows, columns, std::slice::from_ref(&input))
        .pop()
        .unwrap();
    let actual = model.matvec("q4.weight", &input, &|| false).unwrap();
    assert_vectors_close(&actual, &expected, 2e-6, 2e-6);
    assert!(model
        .matvec("q4.weight", &input[..columns - 1], &|| false)
        .is_err());
    assert!(model
        .matvec("q4.weight", &input, &|| true)
        .unwrap_err()
        .contains("cancelled or expired"));
    assert!(model
        .matvec_batch("q4.weight", &[input[..columns - 1].to_vec()], &|| false)
        .is_err());
}

#[test]
fn packed_q4_batch_cancellation_preserves_caches() {
    let mut model = synthetic_model();
    let (weight, _) = packed_q4_tensor(6, 2);
    model.tensors.insert(
        "blocks.layers.0.self_attn.in_proj_weight".to_string(),
        weight,
    );
    let prefill = model.prefill(&[1, 2], &|| false).unwrap();
    let mut caches = vec![prefill.cache.clone(), prefill.cache];
    let before = caches.clone();
    let calls = AtomicUsize::new(0);
    let should_stop = || calls.fetch_add(1, Ordering::SeqCst) >= 1;
    let result = model.advance_batch(&mut caches, &[2, 3], &should_stop);

    assert!(result.unwrap_err().contains("cancelled or expired"));
    assert!(calls.load(Ordering::SeqCst) >= 2);
    assert_eq!(caches, before);
}

#[test]
fn incremental_kv_cache_matches_full_causal_rebuild() {
    let model = synthetic_model();
    let mut prefill = model.prefill(&[1, 2], &|| false).unwrap();
    let full = model.next_token_logits(&[1, 2], &|| false).unwrap();
    assert_eq!(prefill.logits, full);
    assert!(prefill.cache.key_validity.is_empty());
    assert_eq!(prefill.cache.prefix.key_validity.len(), 2);

    let cloned = prefill.cache.clone();
    assert!(Arc::ptr_eq(&prefill.cache.prefix, &cloned.prefix));
    let cached_next = model.advance(&mut prefill.cache, 3, &|| false).unwrap();
    let rebuilt_next = model.next_token_logits(&[1, 2, 3], &|| false).unwrap();
    assert_eq!(cached_next, rebuilt_next);
    assert_eq!(prefill.cache.key_validity.len(), 1);
    assert!(cloned.key_validity.is_empty());
}

#[test]
fn cancelled_cache_append_is_transactional() {
    let model = synthetic_model();
    let mut cache = model.prefill(&[1, 2], &|| false).unwrap().cache;
    let result = model.advance(&mut cache, 3, &|| true);
    assert!(result.unwrap_err().contains("cancelled or expired"));
    assert!(cache.key_validity.is_empty());
    assert!(cache.layers.iter().all(|layer| layer.keys.is_empty()));
}

#[test]
fn batched_advance_matches_scalar_for_one_and_multiple_beams() {
    let model = synthetic_model();
    let prefill = model.prefill(&[1, 2], &|| false).unwrap();

    let mut scalar_cache = prefill.cache.clone();
    let scalar_logits = model.advance(&mut scalar_cache, 3, &|| false).unwrap();
    let mut one_cache = vec![prefill.cache.clone()];
    let one_logits = model
        .advance_batch(&mut one_cache, &[3], &|| false)
        .unwrap();
    assert_eq!(one_logits, vec![scalar_logits]);
    assert_eq!(one_cache, vec![scalar_cache]);

    let mut sequential_caches = vec![prefill.cache.clone(), prefill.cache.clone()];
    let sequential_logits = vec![
        model
            .advance(&mut sequential_caches[0], 2, &|| false)
            .unwrap(),
        model
            .advance(&mut sequential_caches[1], 3, &|| false)
            .unwrap(),
    ];
    let mut batch_caches = vec![prefill.cache.clone(), prefill.cache];
    let batch_logits = model
        .advance_batch(&mut batch_caches, &[2, 3], &|| false)
        .unwrap();
    assert_eq!(batch_logits, sequential_logits);
    assert_eq!(batch_caches, sequential_caches);
}

#[test]
fn cancelled_batch_advance_is_transactional() {
    let model = synthetic_model();
    let prefill = model.prefill(&[1, 2], &|| false).unwrap();
    let mut caches = vec![prefill.cache.clone(), prefill.cache];
    let before = caches.clone();
    let result = model.advance_batch(&mut caches, &[2, 3], &|| true);

    assert!(result.unwrap_err().contains("cancelled or expired"));
    assert_eq!(caches, before);
}

#[test]
fn parallel_matvec_preserves_row_and_accumulation_order() {
    let mut model = synthetic_model();
    let rows = model::PARALLEL_MATVEC_MIN_ROWS;
    let columns = model::PARALLEL_MATVEC_MIN_OPERATIONS.div_ceil(rows);
    let values: Vec<f32> = (0..rows * columns)
        .map(|index| ((index % 29) as f32 - 14.0) / 17.0)
        .collect();
    let input: Vec<f32> = (0..columns)
        .map(|index| ((index % 13) as f32 - 6.0) / 11.0)
        .collect();
    model.tensors.insert(
        "parallel.weight".to_string(),
        Tensor {
            shape: vec![rows, columns],
            storage: TensorStorage::Dequantized(values),
        },
    );

    let tensor = model.tensor("parallel.weight").unwrap();
    let expected: Vec<f32> = (0..rows)
        .map(|row| tensor.dot_row(row, &input).unwrap())
        .collect();
    let actual = model.matvec("parallel.weight", &input, &|| false).unwrap();

    assert_eq!(actual, expected);
}

#[test]
#[ignore = "requires a real decoder bundle through JOTLUCK_COMPLETION_BENCH_BUNDLE"]
fn profiles_real_q4_prefill_advance_and_rank() {
    let bundle = PathBuf::from(
        std::env::var_os("JOTLUCK_COMPLETION_BENCH_BUNDLE")
            .expect("JOTLUCK_COMPLETION_BENCH_BUNDLE must point to a real decoder bundle"),
    );
    let load_started = Instant::now();
    let runtime = DecoderRuntime::load(
        &bundle.join("v2-free-16m-formal-32mib-20260807-b.q4.decoder.bin"),
        &bundle.join("tokenizer.runtime.json"),
    )
    .unwrap();
    let load_elapsed = load_started.elapsed();
    let tokens = runtime.encode_generation_context("今天我们需要继续完善离线补全", 24);

    let prefill_started = Instant::now();
    let mut prefill = runtime.prefill(&tokens, &|| false).unwrap();
    let prefill_elapsed = prefill_started.elapsed();

    let rank_started = Instant::now();
    let ranked = runtime.rank_logits(&prefill.logits, 32).unwrap();
    let rank_elapsed = rank_started.elapsed();

    let output_head_started = Instant::now();
    let output_head = runtime
        .model
        .matvec("output.weight", &vec![0.25; runtime.model.width], &|| false)
        .unwrap();
    let output_head_elapsed = output_head_started.elapsed();

    let mut batch_caches = vec![prefill.cache.clone(); 32];
    let batch_token_ids = vec![ranked[0].token_id; batch_caches.len()];
    let batch_advance_started = Instant::now();
    let batch_logits = runtime
        .advance_batch(&mut batch_caches, &batch_token_ids, &|| false)
        .unwrap();
    let batch_advance_elapsed = batch_advance_started.elapsed();

    let advance_started = Instant::now();
    let logits = runtime
        .advance(&mut prefill.cache, ranked[0].token_id, &|| false)
        .unwrap();
    let advance_elapsed = advance_started.elapsed();

    eprintln!(
        "decoder-profile load={load_elapsed:?} tokens={} prefill={prefill_elapsed:?} rank={rank_elapsed:?} output-head={output_head_elapsed:?} advance={advance_elapsed:?} batch32-advance={batch_advance_elapsed:?} logits={} output-logits={} batch-logits={}",
        tokens.len(),
        logits.len(),
        output_head.len(),
        batch_logits.len()
    );
}

#[test]
#[ignore = "requires a real decoder bundle through JOTLUCK_COMPLETION_BENCH_BUNDLE"]
fn real_q4_matches_dequantized_layers_logits_cache_and_tokens() {
    let bundle = PathBuf::from(
        std::env::var_os("JOTLUCK_COMPLETION_BENCH_BUNDLE")
            .expect("JOTLUCK_COMPLETION_BENCH_BUNDLE must point to a real decoder bundle"),
    );
    let model_path = bundle.join("v2-free-16m-formal-32mib-20260807-b.q4.decoder.bin");
    let tokenizer_path = bundle.join("tokenizer.runtime.json");
    let packed = DecoderRuntime::load(&model_path, &tokenizer_path).unwrap();
    let mut reference = DecoderRuntime::load(&model_path, &tokenizer_path).unwrap();
    let packed_tensors = packed
        .model
        .tensors
        .values()
        .filter(|tensor| matches!(tensor.storage, TensorStorage::PackedQ4(_)))
        .count();
    assert!(packed_tensors > 0);
    dequantize_q4_tensors_for_reference(&mut reference.model);
    assert!(reference
        .model
        .tensors
        .values()
        .all(|tensor| !matches!(tensor.storage, TensorStorage::PackedQ4(_))));

    let context = "# 离线写作\n\n今天我们需要继续完善离线补全，并保持中文段落自然连贯。";
    let tokens = packed.encode_generation_context(context, 24);
    assert_eq!(tokens, reference.encode_generation_context(context, 24));

    let packed_trace = packed.parity_trace(&tokens).unwrap();
    let reference_trace = reference.parity_trace(&tokens).unwrap();
    assert_vectors_close(
        &packed_trace.embedding_last,
        &reference_trace.embedding_last,
        0.0,
        0.0,
    );
    assert_eq!(
        packed_trace.layer_last.len(),
        reference_trace.layer_last.len()
    );
    for (actual, expected) in packed_trace
        .layer_last
        .iter()
        .zip(&reference_trace.layer_last)
    {
        assert_vectors_close(actual, expected, 2e-4, 2e-5);
    }
    assert_vectors_close(
        &packed_trace.final_norm_last,
        &reference_trace.final_norm_last,
        2e-4,
        2e-5,
    );
    assert_vectors_close(&packed_trace.logits, &reference_trace.logits, 5e-4, 2e-5);

    let mut packed_prefill = packed.prefill(&tokens, &|| false).unwrap();
    let mut reference_prefill = reference.prefill(&tokens, &|| false).unwrap();
    assert_vectors_close(
        &packed_prefill.logits,
        &reference_prefill.logits,
        5e-4,
        2e-5,
    );
    assert_cache_close(&packed_prefill.cache, &reference_prefill.cache, 2e-4, 2e-5);
    let packed_ranked = packed.rank_logits(&packed_prefill.logits, 32).unwrap();
    let reference_ranked = reference
        .rank_logits(&reference_prefill.logits, 32)
        .unwrap();
    assert_eq!(
        packed_ranked
            .iter()
            .map(|token| token.token_id)
            .collect::<Vec<_>>(),
        reference_ranked
            .iter()
            .map(|token| token.token_id)
            .collect::<Vec<_>>()
    );

    let next_token = packed_ranked[0].token_id;
    let packed_logits = packed
        .advance(&mut packed_prefill.cache, next_token, &|| false)
        .unwrap();
    let reference_logits = reference
        .advance(&mut reference_prefill.cache, next_token, &|| false)
        .unwrap();
    assert_vectors_close(&packed_logits, &reference_logits, 5e-4, 2e-5);
    assert_cache_close(&packed_prefill.cache, &reference_prefill.cache, 2e-4, 2e-5);

    let packed_steps = packed.greedy_trace(&tokens, 4, &|| false).unwrap();
    let reference_steps = reference.greedy_trace(&tokens, 4, &|| false).unwrap();
    assert_eq!(packed_steps.len(), reference_steps.len());
    for (actual, expected) in packed_steps.iter().zip(&reference_steps) {
        assert_eq!(actual.selected_token_id, expected.selected_token_id);
        assert_eq!(
            actual
                .top_tokens
                .iter()
                .map(|token| token.token_id)
                .collect::<Vec<_>>(),
            expected
                .top_tokens
                .iter()
                .map(|token| token.token_id)
                .collect::<Vec<_>>()
        );
    }

    eprintln!(
        "real packed-q4 parity tensors={packed_tensors} tokens={} last-layer-max-diff={:e} logits-max-diff={:e}",
        tokens.len(),
        maximum_difference(
            packed_trace.layer_last.last().unwrap(),
            reference_trace.layer_last.last().unwrap()
        ),
        maximum_difference(&packed_trace.logits, &reference_trace.logits)
    );
}
