from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
import warnings
from pathlib import Path
from unittest import mock


DEPENDENCIES_AVAILABLE = all(
    importlib.util.find_spec(module) is not None for module in ("numpy", "sentencepiece", "torch")
)


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, "locked training dependencies are not installed")
class TrainDecoderHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        global np, tokenizer_builder, trainer
        import numpy as np
        import prepare_tokenizer as tokenizer_builder
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

    def test_decoder_initializes_tied_embeddings_for_four_bit_export(self) -> None:
        trainer.torch.manual_seed(7)
        model = trainer.DecoderOnlyModel(width=16, layers=1, heads=4, feed_forward=32)
        token_weights = model.token_embedding.weight.detach().numpy()
        position_weights = model.position_embedding.weight.detach().numpy()

        self.assertIs(model.output.weight, model.token_embedding.weight)
        self.assertTrue(np.array_equal(token_weights[0], np.zeros(16, dtype=np.float32)))
        self.assertGreater(float(token_weights.std()), 0.015)
        self.assertLess(float(token_weights.std()), 0.025)
        self.assertGreater(float(position_weights.std()), 0.015)
        self.assertLess(float(position_weights.std()), 0.025)

    def test_q4_signed_mse_scale_reconstructs_better_than_legacy_max_abs(self) -> None:
        values = np.linspace(-1.0, 0.5, 64, dtype=np.float32)
        scales, encoded, _, report = trainer.quantize_grouped_array_with_report(
            values, "q4"
        )
        unpacked: list[int] = []
        for value in encoded:
            unpacked.extend([(value & 0x0F) - 8, (value >> 4) - 8])
        scale = float(np.frombuffer(scales, dtype="<f2")[0])
        reconstructed = np.asarray(unpacked[: values.size], dtype=np.float32) * scale

        legacy_scale = float(np.float16(np.max(np.abs(values)) / 7.0))
        legacy = (
            np.clip(np.rint(values / legacy_scale), -8, 7).astype(np.float32)
            * legacy_scale
        )
        measured_rmse = float(np.sqrt(np.mean(np.square(values - reconstructed))))
        legacy_rmse = float(np.sqrt(np.mean(np.square(values - legacy))))

        self.assertEqual(min(unpacked[: values.size]), -8)
        self.assertAlmostEqual(
            measured_rmse, report["reconstructionRootMeanSquareError"], places=7
        )
        self.assertLess(measured_rmse, legacy_rmse * 0.85)
        self.assertEqual(report["saturatedValues"], 0)

    def test_q4_report_distinguishes_clipping_from_endpoint_use(self) -> None:
        values = np.concatenate(
            (
                np.linspace(-0.1, 0.1, 63, dtype=np.float32),
                np.asarray([0.8], dtype=np.float32),
            )
        )
        _, _, _, report = trainer.quantize_grouped_array_with_report(values, "q4")
        self.assertEqual(report["elements"], 64)
        self.assertEqual(report["saturatedValues"], 1)
        self.assertAlmostEqual(report["saturationRate"], 1 / 64)
        self.assertGreaterEqual(report["endpointValues"], report["saturatedValues"])

    def test_export_reports_reconstruction_for_representative_tensors(self) -> None:
        trainer.torch.manual_seed(11)
        model = trainer.DecoderOnlyModel(width=16, layers=1, heads=4, feed_forward=32)
        config = type("Config", (), {"matrix_id": "16m-q4"})()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "fixture.q4.decoder.bin"
            _, _, diagnostics = trainer.export_quantized_model(
                model, config, target, "q4", "fixture.q4"
            )
            envelope = target.read_bytes()

        header_bytes = struct.unpack("<I", envelope[8:12])[0]
        header = json.loads(envelope[12 : 12 + header_bytes].decode("utf-8"))
        representatives = diagnostics["representativeTensors"]
        self.assertEqual(header["quantizationDiagnostics"], diagnostics)
        self.assertEqual(
            header["architecture"]["initialization"], trainer.MODEL_INITIALIZATION
        )
        self.assertEqual(diagnostics["scaleAlgorithm"], trainer.Q4_SCALE_ALGORITHM)
        self.assertEqual(
            diagnostics["integerRange"],
            {"minimum": -8, "maximum": 7, "zeroPoint": 0, "storageBias": 8},
        )
        self.assertIn("token_embedding.weight", representatives)
        self.assertIn("position_embedding.weight", representatives)
        self.assertIn("blocks.layers.0.self_attn.in_proj_weight", representatives)
        self.assertIn("blocks.layers.0.linear1.weight", representatives)
        self.assertLess(
            representatives["token_embedding.weight"][
                "reconstructionRootMeanSquareError"
            ],
            0.003,
        )
        self.assertLess(
            representatives["position_embedding.weight"][
                "reconstructionRootMeanSquareError"
            ],
            0.003,
        )

    def test_two_percent_warmup_transitions_to_cosine_decay(self) -> None:
        base = 3e-4
        self.assertAlmostEqual(trainer.scheduled_learning_rate(base, 0, 100, 2), base / 2)
        self.assertAlmostEqual(trainer.scheduled_learning_rate(base, 1, 100, 2), base)
        self.assertAlmostEqual(trainer.scheduled_learning_rate(base, 99, 100, 2), 0.0)

    def test_deterministic_cuda_contract_sets_cublas_workspace_before_training(self) -> None:
        config = type("Config", (), {"threads": 1, "seed": 7})()
        with mock.patch.dict(
            trainer.os.environ, {"CUBLAS_WORKSPACE_CONFIG": "unexpected"}, clear=False
        ):
            trainer.configure_determinism(config)
            self.assertEqual(trainer.os.environ["CUBLAS_WORKSPACE_CONFIG"], ":4096:8")
            self.assertTrue(trainer.torch.are_deterministic_algorithms_enabled())

    def test_decoder_uses_matching_boolean_attention_masks(self) -> None:
        model = trainer.DecoderOnlyModel(width=16, layers=1, heads=4, feed_forward=32)
        tokens = trainer.torch.tensor([[2, 4, 0]], dtype=trainer.torch.long)
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            logits = model(tokens)
        self.assertEqual(tuple(logits.shape), (1, 3, trainer.VOCABULARY_SIZE))
        self.assertFalse(
            any("mismatched src_key_padding_mask and mask" in str(item.message) for item in captured)
        )

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
            self.assertEqual(
                adjusted_signature["modelInitialization"], trainer.MODEL_INITIALIZATION
            )
            self.assertEqual(adjusted_signature["globalBatchSize"], 128)
            self.assertEqual(adjusted_signature["oomAdjustments"], [adjustment])

    def test_remote_resume_mode_preserves_fresh_and_recoverable_startup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint_dir = Path(directory) / "candidate.checkpoints"
            with mock.patch.dict(
                trainer.os.environ, {"JOTLUCK_REMOTE_RESUME_MODE": "if-available"}
            ):
                self.assertIsNone(trainer.resolve_resume_request(None, checkpoint_dir))
                checkpoint_dir.mkdir()
                self.assertEqual(
                    trainer.resolve_resume_request(None, checkpoint_dir), "auto"
                )

            with mock.patch.dict(
                trainer.os.environ, {"JOTLUCK_REMOTE_RESUME_MODE": "required"}
            ):
                self.assertEqual(
                    trainer.resolve_resume_request(None, checkpoint_dir), "auto"
                )
                with self.assertRaisesRegex(ValueError, "cannot both"):
                    trainer.resolve_resume_request("auto", checkpoint_dir)

            with mock.patch.dict(
                trainer.os.environ, {"JOTLUCK_REMOTE_RESUME_MODE": "never"}
            ):
                self.assertIsNone(trainer.resolve_resume_request(None, checkpoint_dir))

    def test_shared_tokenizer_assets_must_be_supplied_as_a_pair(self) -> None:
        model = Path("tokenizer.unigram.model")
        runtime = Path("tokenizer.runtime.json")
        trainer.validate_shared_tokenizer_paths(model, runtime)
        trainer.validate_shared_tokenizer_paths(None, None)
        with self.assertRaisesRegex(ValueError, "provided together"):
            trainer.validate_shared_tokenizer_paths(model, None)
        with self.assertRaisesRegex(ValueError, "provided together"):
            trainer.validate_shared_tokenizer_paths(None, runtime)

    def test_shared_tokenizer_bundle_binds_selection_and_both_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selection = root / "selection.json"
            selection.write_text("{}\n", encoding="utf-8")
            receipt = root / "selection-stage.json"
            receipt.write_text("{}\n", encoding="utf-8")
            audit = root / "fingerprint-audit.json"
            audit.write_text("{}\n", encoding="utf-8")
            output = (
                root
                / "scripts/corpus/_web-cache/autocomplete-v2-free/tokenizers/formal-fixture"
            )
            train_file = root / "train.txt"
            train_file.write_text("fixture", encoding="utf-8")

            def fake_train_assets(staging: Path, _paths: object) -> tuple[Path, Path]:
                model = staging / "tokenizer.unigram.model"
                runtime = staging / "tokenizer.runtime.json"
                model.write_bytes(b"model")
                runtime.write_text('{"schema":"fixture"}\n', encoding="utf-8")
                return model, runtime

            with (
                mock.patch.object(
                    tokenizer_builder.trainer,
                    "load_selection",
                    return_value=(
                        {
                            "selectedBytes": trainer.FORMAL_MATRIX_MINIMUM_BYTES,
                            "inputTreeSha256": "a" * 64,
                        },
                        [train_file],
                        [],
                    ),
                ),
                mock.patch.object(
                    tokenizer_builder.trainer,
                    "train_tokenizer_assets",
                    side_effect=fake_train_assets,
                ),
            ):
                manifest = tokenizer_builder.build_bundle(
                    root, selection, receipt, audit, output, 20260805
                )

            self.assertEqual(manifest["inputTreeSha256"], "a" * 64)
            self.assertEqual(manifest["trainDocuments"], 1)
            self.assertEqual(
                manifest["selectionStageReceiptSha256"], trainer.sha256_file(receipt)
            )
            self.assertEqual(manifest["assets"]["model"]["sha256"], hashlib.sha256(b"model").hexdigest())
            self.assertTrue((output / "manifest.json").is_file())

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
                    config,
                    candidate_id,
                    quantization,
                    model,
                    tokenizer,
                    1_024,
                    "d" * 64,
                    "e" * 64,
                    None,
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

    def test_remote_bundle_manifest_binds_sorted_files_and_job_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "candidate.q4.manifest.json").write_text("{}\n", encoding="utf-8")
            (root / "smoke.q4.decoder.bin").write_bytes(b"model")
            (root / "smoke.best.float.pt").write_bytes(b"checkpoint")
            (root / "tokenizer.runtime.json").write_text("{}\n", encoding="utf-8")
            (root / "tokenizer.unigram.model").write_bytes(b"tokenizer")
            (root / "training-report.json").write_text("{}\n", encoding="utf-8")

            manifest = trainer.create_remote_bundle_manifest(
                root, "smoke-16m", "a" * 64, "2026-08-06T00:00:00.000Z"
            )
            paths = [file["relativePath"] for file in manifest["files"]]
            self.assertEqual(paths, sorted(paths))
            self.assertNotIn("manifest.json", paths)
            self.assertEqual(manifest["jobId"], "smoke-16m")
            self.assertEqual(manifest["sourceJobSha256"], "a" * 64)
            base = {key: value for key, value in manifest.items() if key != "bundleSha256"}
            expected = hashlib.sha256(trainer.canonical_json(base).encode("utf-8")).hexdigest()
            self.assertEqual(manifest["bundleSha256"], expected)
            self.assertEqual(
                manifest["totalBytes"], sum(file["bytes"] for file in manifest["files"])
            )

    def test_remote_bundle_environment_fails_closed_when_partial(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.dict(
                trainer.os.environ,
                {"JOTLUCK_REMOTE_JOB_ID": "smoke-16m"},
                clear=True,
            ):
                with self.assertRaisesRegex(ValueError, "environment is incomplete"):
                    trainer.write_remote_bundle_manifest_from_environment(root)

    def test_explicit_cuda_fails_closed_when_unavailable(self) -> None:
        if trainer.torch.cuda.is_available():
            self.assertEqual(trainer.resolve_device("cuda").type, "cuda")
        else:
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                trainer.resolve_device("cuda")


if __name__ == "__main__":
    unittest.main()
