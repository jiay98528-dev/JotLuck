from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


DEPENDENCIES_AVAILABLE = all(
    importlib.util.find_spec(module) is not None for module in ("numpy", "sentencepiece", "torch")
)


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, "locked training dependencies are not installed")
class TrainDecoderHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        global np, trainer
        import numpy as np
        import train_decoder as trainer

    def test_q4_groups_have_f16_scales_and_fixed_32_byte_payloads(self) -> None:
        values = np.arange(15, dtype=np.float32).reshape(3, 5) - 7
        scales, encoded, groups = trainer.quantize_grouped_array(values, "q4")
        self.assertEqual(groups, 1)
        self.assertEqual(len(scales), 2)
        self.assertEqual(len(encoded), 32)
        unpacked: list[int] = []
        for value in encoded:
            unpacked.extend([(value & 0x0F) - 8, (value >> 4) - 8])
        self.assertEqual(unpacked[15:], [0] * 49)

    def test_q8_groups_have_f16_scales_and_fixed_64_byte_payloads(self) -> None:
        values = np.linspace(-1, 1, 65, dtype=np.float32).reshape(1, 65)
        scales, encoded, groups = trainer.quantize_grouped_array(values, "q8")
        self.assertEqual(groups, 2)
        self.assertEqual(len(scales), 4)
        self.assertEqual(len(encoded), 128)
        self.assertEqual(encoded[65:], bytes(63))

    def test_two_percent_warmup_transitions_to_cosine_decay(self) -> None:
        base = 3e-4
        self.assertAlmostEqual(trainer.scheduled_learning_rate(base, 0, 100, 2), base / 2)
        self.assertAlmostEqual(trainer.scheduled_learning_rate(base, 1, 100, 2), base)
        self.assertAlmostEqual(trainer.scheduled_learning_rate(base, 99, 100, 2), 0.0)

    def test_formal_microbatch_defaults_and_oom_chains_keep_global_batch_128(self) -> None:
        self.assertEqual(trainer.default_micro_batch_size("16m-q4"), 8)
        self.assertEqual(trainer.default_micro_batch_size("24m-q4"), 4)
        self.assertEqual(trainer.default_micro_batch_size("32m-q4"), 4)
        self.assertEqual(trainer.allowed_micro_batch_sizes("16m-q4"), (8, 4, 2, 1))
        self.assertEqual(trainer.allowed_micro_batch_sizes("24m-q4"), (4, 2, 1))

        adjustment = trainer.next_oom_adjustment(8)
        self.assertEqual(
            adjustment,
            {
                "reason": "cudaOutOfMemory",
                "fromMicroBatchSize": 8,
                "toMicroBatchSize": 4,
                "fromGradientAccumulationSteps": 16,
                "toGradientAccumulationSteps": 32,
                "globalBatchSize": 128,
            },
        )
        self.assertIsNone(trainer.next_oom_adjustment(1))
        with self.assertRaisesRegex(ValueError, "fixed OOM chain"):
            trainer.validate_micro_batch_size("24m-q4", 8)

    def test_oom_history_is_bound_to_checkpoint_and_resume_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = type(
                "Config",
                (),
                {
                    "matrix_id": "16m-q4",
                    "candidate_id": "16m-seed-1",
                    "checkpoint_dir": root,
                    "resume": None,
                    "batch_size": 8,
                    "seed": 7,
                    "epochs": 3,
                    "learning_rate": 3e-4,
                },
            )()
            selection_sha256 = "a" * 64
            initial = trainer.load_or_initialize_oom_state(config, selection_sha256)
            self.assertEqual(initial["activeMicroBatchSize"], 8)
            adjustment = trainer.next_oom_adjustment(8)
            adjusted = trainer.write_oom_state(
                config, selection_sha256, 8, 4, [adjustment]
            )
            config.resume = "auto"
            resumed = trainer.load_or_initialize_oom_state(config, selection_sha256)
            self.assertEqual(resumed, adjusted)

            base_signature = trainer.checkpoint_signature(
                config, selection_sha256, 12, 1, 8, 8, 16, []
            )
            adjusted_signature = trainer.checkpoint_signature(
                config, selection_sha256, 12, 1, 8, 4, 32, [adjustment]
            )
            self.assertNotEqual(base_signature, adjusted_signature)
            self.assertEqual(adjusted_signature["globalBatchSize"], 128)
            self.assertEqual(adjusted_signature["oomAdjustments"], [adjustment])

    def test_checkpoint_retention_keeps_last_two_without_touching_best(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for step in (1, 2, 3):
                (root / f"step-{step:09d}.pt").write_bytes(b"step")
            (root / "best.pt").write_bytes(b"best")
            trainer.prune_step_checkpoints(root)
            self.assertEqual(
                sorted(path.name for path in root.iterdir()),
                ["best.pt", "step-000000002.pt", "step-000000003.pt"],
            )

    def test_16m_architecture_exports_q4_and_q8_from_one_float_model(self) -> None:
        config = type(
            "Config", (), {"matrix_id": "16m-q4", "candidate_id": "16m-seed-1"}
        )()
        self.assertEqual(sorted(trainer.MATRIX), ["16m-q4", "24m-q4", "32m-q4"])
        self.assertEqual(trainer.export_quantizations(config), ("q4", "q8"))
        self.assertEqual(trainer.export_candidate_id(config, "q4"), "16m-seed-1.q4")
        self.assertEqual(trainer.export_candidate_id(config, "q8"), "16m-seed-1.q8")
        with self.assertRaisesRegex(ValueError, "export-only"):
            trainer.validate_training_matrix_id("16m-q8")
        config.matrix_id = "24m-q4"
        self.assertEqual(trainer.export_quantizations(config), ("q4",))

    def test_trained_manifests_bind_unique_candidate_and_asset_identity(self) -> None:
        config = type(
            "Config", (), {"matrix_id": "16m-q4", "candidate_id": "16m-seed-1"}
        )()
        tokenizer = {"file": "tokenizer.runtime.json", "bytes": 20, "sha256": "b" * 64}
        manifests = []
        for quantization, model_hash in (("q4", "a" * 64), ("q8", "c" * 64)):
            candidate_id = trainer.export_candidate_id(config, quantization)
            model = {
                "file": f"16m-seed-1.{quantization}.decoder.bin",
                "bytes": 100,
                "sha256": model_hash,
            }
            manifests.append(
                trainer.build_trained_manifest(
                    config, candidate_id, quantization, model, tokenizer, 1_024
                )
            )

        self.assertNotEqual(manifests[0]["candidateId"], manifests[1]["candidateId"])
        self.assertNotEqual(
            manifests[0]["candidateArtifactSha256"],
            manifests[1]["candidateArtifactSha256"],
        )
        for manifest in manifests:
            self.assertEqual(manifest["lifecycle"], "trained")
            self.assertTrue(manifest["evaluationOnly"])
            self.assertTrue(manifest["runtimeEligible"])
            self.assertFalse(manifest["releaseEligible"])
            self.assertNotIn("releaseEvidence", manifest)
            self.assertEqual(
                manifest["oraclePrecheck"],
                {
                    "checkpoints": 0,
                    "oracleAt8": 0,
                    "oracleAt32": 0,
                    "chineseOracleAt8": 0,
                    "englishOracleAt8": 0,
                    "passed": False,
                },
            )
            self.assertEqual(manifest["runtimeStaticDeltaBytes"], 0)
            self.assertEqual(manifest["measuredPeakMemoryBytes"], 0)
            self.assertEqual(
                manifest["measurementClaims"],
                {
                    "runtimeStaticDeltaBytes": False,
                    "measuredPeakMemoryBytes": False,
                },
            )

    def test_explicit_cuda_fails_closed_when_unavailable(self) -> None:
        if trainer.torch.cuda.is_available():
            self.assertEqual(trainer.resolve_device("cuda").type, "cuda")
        else:
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                trainer.resolve_device("cuda")


if __name__ == "__main__":
    unittest.main()
