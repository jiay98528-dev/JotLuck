use super::*;

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
}

#[test]
fn stable_softmax_is_normalized() {
    let mut values = vec![1_000.0, 999.0];
    softmax_in_place(&mut values).unwrap();
    assert!((values.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    assert!(values[0] > values[1]);
}
