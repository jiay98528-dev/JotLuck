use super::*;
use std::path::PathBuf;
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
