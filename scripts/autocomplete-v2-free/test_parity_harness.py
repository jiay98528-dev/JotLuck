from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path


NUMPY_AVAILABLE = importlib.util.find_spec("numpy") is not None


@unittest.skipUnless(NUMPY_AVAILABLE, "locked parity dependency numpy is not installed")
class ParityHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        global np, parity
        import numpy as np
        import parity_harness as parity

    def write_asset(self, root: Path, quantization: str) -> tuple[Path, np.ndarray]:
        source = np.linspace(-1.0, 1.0, 65, dtype=np.float32).reshape(5, 13)
        scale = np.float16(np.max(np.abs(source)) / (7 if quantization == "q4" else 127))
        scales = np.asarray([scale, scale], dtype="<f2").tobytes()
        quantized = np.zeros(128, dtype=np.int8)
        quantized[:65] = np.clip(
            np.rint(source.reshape(-1) / float(scale)),
            -8 if quantization == "q4" else -127,
            7 if quantization == "q4" else 127,
        ).astype(np.int8)
        if quantization == "q4":
            nibbles = (quantized + 8).astype(np.uint8)
            encoded = (nibbles[0::2] | (nibbles[1::2] << 4)).tobytes()
        else:
            encoded = quantized.tobytes()
        payload = scales + encoded
        header = {
            "schema": parity.MODEL_SCHEMA,
            "engine": parity.ENGINE_ID,
            "candidateId": f"tiny.{quantization}",
            "quantization": quantization,
            "vocabularySize": 8_000,
            "maximumContextTokens": 256,
            "architecture": {
                "width": 1,
                "layers": 1,
                "heads": 1,
                "feedForward": 1,
                "layerNormEpsilon": 1e-5,
            },
            "payloadSha256": hashlib.sha256(payload).hexdigest(),
            "tensors": [
                {
                    "name": "matrix",
                    "shape": [5, 13],
                    "dtype": quantization,
                    "groupSize": 64,
                    "groups": 2,
                    "scaleOffset": 0,
                    "scaleBytes": len(scales),
                    "offset": len(scales),
                    "bytes": len(encoded),
                },
                {"name": "matrix.alias", "aliasOf": "matrix"},
            ],
        }
        encoded_header = json.dumps(
            header, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        path = root / f"tiny.{quantization}.bin"
        path.write_bytes(
            parity.MODEL_MAGIC + struct.pack("<I", len(encoded_header)) + encoded_header + payload
        )
        return path, source

    def test_q4_and_q8_assets_are_independently_dequantized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for quantization, tolerance in (("q4", 0.08), ("q8", 0.005)):
                path, source = self.write_asset(root, quantization)
                asset = parity.parse_quantized_asset(path)
                actual = asset.tensor("matrix")
                np.testing.assert_allclose(actual, source, atol=tolerance, rtol=0)
                np.testing.assert_array_equal(asset.tensor("matrix.alias"), actual)

    def test_corrupt_payload_and_protected_paths_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, _ = self.write_asset(root, "q4")
            data = bytearray(path.read_bytes())
            data[-1] ^= 0x01
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                parity.parse_quantized_asset(path)
            with self.assertRaisesRegex(ValueError, "refuses final"):
                parity.reject_protected_path(root / "final" / "candidate.json")
            with self.assertRaisesRegex(ValueError, "production-public"):
                parity.reject_protected_path(root / "resources" / "autocomplete" / "public.json")

    def test_vector_metrics_and_stable_top_are_deterministic(self) -> None:
        values = np.asarray([1.0, 2.0, 2.0, -1.0], dtype=np.float32)
        self.assertEqual(parity.stable_top(values, 4), [1, 2, 0, 3])
        summary = parity.vector_summary(values)
        self.assertEqual(summary["count"], 4)
        self.assertEqual(summary["sha256F32Le"], parity.sha256_bytes(values.astype("<f4").tobytes()))
        metrics = parity.error_metrics(values, values.copy())
        self.assertEqual(metrics["maximumAbsolute"], 0.0)
        self.assertEqual(metrics["meanAbsolute"], 0.0)

    def test_recorded_command_redacts_context_but_not_token_ids(self) -> None:
        command, redacted = parity.recorded_command(
            ["parity_harness.py", "--context", "private note", "--report", "result.json"]
        )
        self.assertTrue(redacted)
        self.assertNotIn("private note", command)
        token_command, token_redacted = parity.recorded_command(
            ["parity_harness.py", "--token-ids", "2,4"]
        )
        self.assertFalse(token_redacted)
        self.assertEqual(token_command[-1], "2,4")


if __name__ == "__main__":
    unittest.main()
