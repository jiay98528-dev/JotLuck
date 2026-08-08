#!/usr/bin/env python3
"""Candidate-only trainer for public-v2-free-decoder-v1.

The trainer is deliberately isolated from final holdouts and production
resources. It trains one float checkpoint per architecture, selects the best
checkpoint by development loss, and exports the fixed Q4/Q8 candidate assets.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import random
import re
import shutil
import struct
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import sentencepiece as spm
import torch
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset

from tokenizer_runtime import (
    UnigramRuntimeTokenizer,
    encode_documents,
    export_sentencepiece_runtime,
    normalize_text,
)

ENGINE_ID = "public-v2-free-decoder-v1"
SELECTION_SCHEMA = "jotluck.autocomplete.v2-free-licensed-corpus.v1"
TRAINING_REPORT_SCHEMA = "jotluck.autocomplete.v2-free-training.v1"
CHECKPOINT_SCHEMA = "jotluck.autocomplete.v2-free-checkpoint.v1"
FLOAT_CHECKPOINT_SCHEMA = "jotluck.autocomplete.v2-free-float-model.v1"
MODEL_SCHEMA = "jotluck.autocomplete.quantized-decoder.v2"
MANIFEST_SCHEMA = "jotluck.autocomplete.public-free-decoder.v1"
MODEL_MAGIC = b"JLFDQ02\0"
VOCABULARY_SIZE = 8_000
MAX_CONTEXT_TOKENS = 256
MAX_TRAINING_POOL_BYTES = 512 * 1024 * 1024
FORMAL_MATRIX_MINIMUM_BYTES = 128 * 1024 * 1024
FORMAL_STAGE_SCHEMA = "jotluck.autocomplete.v2-free-selection-stage.v1"
FINGERPRINT_AUDIT_SCHEMA = "jotluck.autocomplete.v2-free-fingerprint-audit.v1"
GLOBAL_BATCH_SIZE = 128
QUANTIZATION_GROUP_SIZE = 64
CHECKPOINT_INTERVAL_STEPS = 1_000
CHECKPOINTS_TO_KEEP = 2
WARMUP_RATIO = 0.02
DEV_FRACTION_FALLBACK = 0.05
LAYER_NORM_EPSILON = 1e-5
MODEL_INITIALIZATION = "normal-0.02-v1"
EMBEDDING_INITIALIZATION_STD = 0.02
Q4_SCALE_ALGORITHM = "groupwise-symmetric-mse-v1"
Q8_SCALE_ALGORITHM = "groupwise-symmetric-maxabs-v1"
Q4_SCALE_OPTIMIZATION_ITERATIONS = 4
QUANTIZATION_CHUNK_GROUPS = 4_096
QUANTIZATION_DIAGNOSTICS_SCHEMA = "jotluck.autocomplete.quantization-diagnostics.v1"
OOM_STATE_SCHEMA = "jotluck.autocomplete.v2-free-oom-state.v1"
REMOTE_BUNDLE_SCHEMA = "jotluck.autocomplete.v2-free.remote-bundle.v1"
REMOTE_JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
REMOTE_RESUME_MODES = {"never", "if-available", "required"}

# matrix id -> width, layers, heads, feed-forward, primary quantization
MATRIX: dict[str, tuple[int, int, int, int, str]] = {
    "16m-q4": (384, 8, 4, 1_024, "q4"),
    "24m-q4": (448, 9, 7, 1_280, "q4"),
    "32m-q4": (512, 10, 8, 1_536, "q4"),
}
NOMINAL_PARAMETERS = {
    "16m-q4": 16_000_000,
    "24m-q4": 24_000_000,
    "32m-q4": 32_000_000,
}


@dataclass(frozen=True)
class Config:
    workspace_root: Path
    selection_path: Path
    matrix_id: str
    candidate_id: str
    output_dir: Path
    checkpoint_dir: Path
    tokenizer_model_path: Path | None
    tokenizer_runtime_path: Path | None
    selection_stage_receipt_path: Path | None
    fingerprint_audit_path: Path | None
    resume: str | None
    device: str
    seed: int
    epochs: int
    batch_size: int
    learning_rate: float
    threads: int


@dataclass(frozen=True)
class TrainingResult:
    model: "DecoderOnlyModel"
    train_losses: list[float]
    dev_evaluations: list[dict[str, float | int]]
    best_dev_loss: float
    best_step: int
    total_steps: int
    warmup_steps: int
    resumed_from: str | None
    initial_micro_batch_size: int
    final_micro_batch_size: int
    gradient_accumulation_steps: int
    oom_adjustments: list[dict[str, Any]]


class TokenWindows(Dataset[tuple[Tensor, Tensor]]):
    def __init__(self, token_ids: list[int], context_tokens: int) -> None:
        self.tokens = torch.tensor(token_ids, dtype=torch.long)
        self.context_tokens = context_tokens

    def __len__(self) -> int:
        return max(0, (self.tokens.numel() - 1) // self.context_tokens)

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor]:
        start = index * self.context_tokens
        value = self.tokens[start : start + self.context_tokens + 1]
        if value.numel() < self.context_tokens + 1:
            value = torch.nn.functional.pad(
                value, (0, self.context_tokens + 1 - value.numel()), value=0
            )
        return value[:-1], value[1:]


class DecoderOnlyModel(nn.Module):
    def __init__(self, width: int, layers: int, heads: int, feed_forward: int) -> None:
        super().__init__()
        self.token_embedding = nn.Embedding(VOCABULARY_SIZE, width, padding_idx=0)
        self.position_embedding = nn.Embedding(MAX_CONTEXT_TOKENS, width)
        block = nn.TransformerEncoderLayer(
            d_model=width,
            nhead=heads,
            dim_feedforward=feed_forward,
            dropout=0.0,
            activation="gelu",
            layer_norm_eps=LAYER_NORM_EPSILON,
            batch_first=True,
            norm_first=True,
        )
        self.blocks = nn.TransformerEncoder(block, num_layers=layers, enable_nested_tensor=False)
        self.final_norm = nn.LayerNorm(width, eps=LAYER_NORM_EPSILON)
        self.output = nn.Linear(width, VOCABULARY_SIZE, bias=False)
        self.output.weight = self.token_embedding.weight
        self.register_buffer("positions", torch.arange(MAX_CONTEXT_TOKENS), persistent=False)
        self.reset_jotluck_embeddings()

    def reset_jotluck_embeddings(self) -> None:
        """Use the decoder recipe's small embedding distribution.

        ``nn.Embedding`` otherwise defaults to a unit-normal distribution.  That
        distribution is roughly 25-50x wider than the Transformer projections in
        this model and makes a four-bit tied input/output embedding needlessly
        destructive.  Keep the padding row exactly zero after initialization.
        """

        nn.init.normal_(
            self.token_embedding.weight,
            mean=0.0,
            std=EMBEDDING_INITIALIZATION_STD,
        )
        nn.init.normal_(
            self.position_embedding.weight,
            mean=0.0,
            std=EMBEDDING_INITIALIZATION_STD,
        )
        with torch.no_grad():
            self.token_embedding.weight[0].zero_()

    def forward(self, tokens: Tensor) -> Tensor:
        length = tokens.shape[1]
        hidden = self.token_embedding(tokens) + self.position_embedding(self.positions[:length])
        causal_mask = torch.triu(
            torch.ones((length, length), dtype=torch.bool, device=tokens.device), diagonal=1
        )
        padding_mask = tokens.eq(0)
        hidden = self.blocks(hidden, mask=causal_mask, src_key_padding_mask=padding_mask)
        return self.output(self.final_norm(hidden))


def validate_training_matrix_id(matrix_id: str) -> None:
    if matrix_id == "16m-q8":
        raise ValueError(
            "16m-q8 is export-only; train 16m-q4 once and export Q4/Q8 from that float checkpoint"
        )
    if matrix_id not in MATRIX:
        raise ValueError(f"unsupported training matrix: {matrix_id}")


def default_micro_batch_size(matrix_id: str) -> int:
    validate_training_matrix_id(matrix_id)
    return 8 if matrix_id == "16m-q4" else 4


def allowed_micro_batch_sizes(matrix_id: str) -> tuple[int, ...]:
    initial = default_micro_batch_size(matrix_id)
    return tuple(initial // (2**index) for index in range(int(math.log2(initial)) + 1))


def validate_micro_batch_size(matrix_id: str, batch_size: int) -> None:
    if batch_size not in allowed_micro_batch_sizes(matrix_id):
        allowed = " → ".join(str(value) for value in allowed_micro_batch_sizes(matrix_id))
        raise ValueError(f"microbatch for {matrix_id} must follow the fixed OOM chain {allowed}")


def parse_args() -> Config:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--matrix-id", required=True)
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--tokenizer-model", type=Path)
    parser.add_argument("--tokenizer-runtime", type=Path)
    parser.add_argument("--selection-stage-receipt", type=Path)
    parser.add_argument("--fingerprint-audit", type=Path)
    parser.add_argument("--resume", nargs="?", const="auto")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--seed", type=int, default=20260805)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument(
        "--batch-size",
        type=int,
        help="microbatch override; defaults to 8 for 16M and 4 for 24M/32M",
    )
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()
    try:
        validate_training_matrix_id(args.matrix_id)
    except ValueError as error:
        parser.error(str(error))
    if not 1 <= args.epochs <= 8:
        parser.error("epochs must be between 1 and 8")
    batch_size = (
        default_micro_batch_size(args.matrix_id) if args.batch_size is None else args.batch_size
    )
    try:
        validate_micro_batch_size(args.matrix_id, batch_size)
    except ValueError as error:
        parser.error(str(error))
    if args.learning_rate <= 0.0 or not math.isfinite(args.learning_rate):
        parser.error("learning-rate must be finite and positive")
    if args.threads < 1:
        parser.error("threads must be positive")
    if (
        not args.candidate_id
        or len(args.candidate_id) > 92
        or not args.candidate_id[0].isalnum()
        or any(
            character not in "abcdefghijklmnopqrstuvwxyz0123456789._-"
            for character in args.candidate_id
        )
    ):
        parser.error("candidate-id must be a lowercase safe identifier of at most 92 characters")
    root = args.workspace_root.resolve()
    output = args.output_dir.resolve()
    allowed = (root / "scripts/corpus/_web-cache/autocomplete-v2-free/candidates").resolve()
    if output == allowed or allowed not in output.parents:
        parser.error("output-dir must be a child of the isolated V2 free candidate root")
    checkpoint_dir = output.parent / f".{args.candidate_id}.checkpoints"
    resume = resolve_resume_request(args.resume, checkpoint_dir)
    try:
        validate_shared_tokenizer_paths(args.tokenizer_model, args.tokenizer_runtime)
        validate_formal_governance_paths(
            args.selection_stage_receipt, args.fingerprint_audit
        )
    except ValueError as error:
        parser.error(str(error))
    return Config(
        workspace_root=root,
        selection_path=resolve_inside(root, args.selection),
        matrix_id=args.matrix_id,
        candidate_id=args.candidate_id,
        output_dir=output,
        checkpoint_dir=checkpoint_dir,
        tokenizer_model_path=(
            resolve_inside(root, args.tokenizer_model) if args.tokenizer_model is not None else None
        ),
        tokenizer_runtime_path=(
            resolve_inside(root, args.tokenizer_runtime)
            if args.tokenizer_runtime is not None
            else None
        ),
        selection_stage_receipt_path=(
            resolve_inside(root, args.selection_stage_receipt)
            if args.selection_stage_receipt is not None
            else None
        ),
        fingerprint_audit_path=(
            resolve_inside(root, args.fingerprint_audit)
            if args.fingerprint_audit is not None
            else None
        ),
        resume=resume,
        device=args.device,
        seed=args.seed,
        epochs=args.epochs,
        batch_size=batch_size,
        learning_rate=args.learning_rate,
        threads=args.threads,
    )


def resolve_resume_request(cli_resume: str | None, checkpoint_dir: Path) -> str | None:
    remote_mode = os.environ.get("JOTLUCK_REMOTE_RESUME_MODE")
    if remote_mode is None:
        return cli_resume
    if remote_mode not in REMOTE_RESUME_MODES:
        raise ValueError("unsupported remote resume mode")
    if cli_resume is not None:
        raise ValueError("remote resume mode and --resume cannot both be specified")
    if remote_mode == "never":
        return None
    if remote_mode == "required":
        return "auto"
    return "auto" if checkpoint_dir.is_dir() else None


def validate_shared_tokenizer_paths(model_path: Path | None, runtime_path: Path | None) -> None:
    if (model_path is None) != (runtime_path is None):
        raise ValueError("tokenizer-model and tokenizer-runtime must be provided together")


def validate_formal_governance_paths(receipt_path: Path | None, audit_path: Path | None) -> None:
    if (receipt_path is None) != (audit_path is None):
        raise ValueError("selection-stage-receipt and fingerprint-audit must be provided together")


def resolve_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is unavailable")
        return torch.device("cuda")
    if requested == "auto" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def configure_determinism(config: Config) -> None:
    os.environ["OMP_NUM_THREADS"] = str(config.threads)
    os.environ["MKL_NUM_THREADS"] = str(config.threads)
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
    random.seed(config.seed)
    np.random.seed(config.seed)
    torch.manual_seed(config.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(config.seed)
    torch.set_num_threads(config.threads)
    torch.use_deterministic_algorithms(True)
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True


def load_selection(config: Config) -> tuple[dict[str, Any], list[Path], list[Path]]:
    selection_bytes = config.selection_path.read_bytes()
    selection = json.loads(selection_bytes.decode("utf-8"))
    if selection.get("schema") != SELECTION_SCHEMA or selection.get("schemaVersion") != 1:
        raise ValueError("unsupported V2 free licensed-corpus selection")
    documents = selection.get("documents")
    if not isinstance(documents, list) or not documents:
        raise ValueError("licensed-corpus selection has no documents")
    records: list[tuple[Path, str, str]] = []
    total = 0
    for index, item in enumerate(documents):
        if not isinstance(item, dict) or item.get("licenseApproved") is not True:
            raise ValueError(f"documents[{index}] is not license-approved")
        relative = item.get("relativePath")
        expected_hash = item.get("sha256")
        split = item.get("split", "train")
        if (
            not isinstance(relative, str)
            or not is_sha256(expected_hash)
            or split not in {"train", "development"}
        ):
            raise ValueError(f"documents[{index}] identity is invalid")
        path = resolve_inside(config.workspace_root, Path(relative))
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise ValueError(f"documents[{index}] SHA-256 mismatch")
        total += len(data)
        if total > MAX_TRAINING_POOL_BYTES:
            raise ValueError("cleaned training pool exceeds 512 MiB")
        records.append((path, split, expected_hash))
    if selection.get("selectedBytes") != total:
        raise ValueError("selection byte total is invalid")

    if total >= FORMAL_MATRIX_MINIMUM_BYTES:
        validate_formal_selection_governance(config, selection, selection_bytes)

    train_paths = [path for path, split, _ in records if split == "train"]
    dev_paths = [path for path, split, _ in records if split == "development"]
    if not train_paths:
        raise ValueError("licensed-corpus selection has no training documents")
    if not dev_paths:
        # Backward-compatible deterministic document-level fallback. New formal
        # selections should provide an explicit development split.
        ordered = sorted(
            ((expected_hash, path) for path, _, expected_hash in records), key=lambda item: item[0]
        )
        dev_count = max(1, math.ceil(len(ordered) * DEV_FRACTION_FALLBACK))
        if len(ordered) > 1:
            dev_set = {path for _, path in ordered[: min(dev_count, len(ordered) - 1)]}
            dev_paths = [path for path in train_paths if path in dev_set]
            train_paths = [path for path in train_paths if path not in dev_set]
        else:
            dev_paths = list(train_paths)
    return selection, train_paths, dev_paths


def validate_formal_selection_governance(
    config: Config, selection: dict[str, Any], selection_bytes: bytes
) -> dict[str, str]:
    receipt_path = config.selection_stage_receipt_path
    audit_path = config.fingerprint_audit_path
    if receipt_path is None or audit_path is None:
        raise ValueError(
            "formal matrix training requires a selection stage receipt and fingerprint audit"
        )
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if not isinstance(receipt, dict) or not isinstance(audit, dict):
        raise ValueError("formal governance artifacts must be JSON objects")
    receipt_hash = receipt.get("receiptSha256")
    receipt_without_hash = dict(receipt)
    receipt_without_hash.pop("receiptSha256", None)
    audit_hash = audit.get("reportSha256")
    audit_without_hash = dict(audit)
    audit_without_hash.pop("reportSha256", None)
    selection_sha256 = hashlib.sha256(selection_bytes).hexdigest()
    if (
        receipt.get("schema") != FORMAL_STAGE_SCHEMA
        or receipt.get("schemaVersion") != 1
        or receipt.get("stage") != "formal-128mib-matrix"
        or receipt.get("passed") is not True
        or not is_sha256(receipt_hash)
        or hashlib.sha256(canonical_json(receipt_without_hash).encode("utf-8")).hexdigest()
        != receipt_hash
        or receipt.get("selectionManifestSha256") != selection_sha256
        or receipt.get("selectionInputTreeSha256") != selection.get("inputTreeSha256")
        or receipt.get("datasetId") != selection.get("datasetId")
        or receipt.get("selectedBytes") != selection.get("selectedBytes")
        or receipt.get("trainBytes") != selection.get("splitBytes", {}).get("train")
        or receipt.get("developmentBytes")
        != selection.get("splitBytes", {}).get("development")
        or receipt.get("languages") != selection.get("languageBytes")
    ):
        raise ValueError("formal selection stage receipt does not bind the selection")
    required_holdouts = {
        "cold-validation-v1",
        "workspace-validation-v1",
        "cold-final-v1",
        "workspace-final-v1",
    }
    checked_holdouts = receipt.get("checkedHoldoutClassifications")
    if not isinstance(checked_holdouts, list) or not required_holdouts.issubset(
        set(checked_holdouts)
    ) or receipt.get("finalFingerprintInventoriesRead") is not True:
        raise ValueError("formal selection receipt is missing holdout fingerprints")
    audit_inventories = audit.get("holdoutInventories")
    audit_holdouts = {
        item.get("classification")
        for item in audit_inventories
        if isinstance(item, dict)
    } if isinstance(audit_inventories, list) else set()
    if (
        audit.get("schema") != FINGERPRINT_AUDIT_SCHEMA
        or audit.get("schemaVersion") != 1
        or audit.get("passed") is not True
        or audit.get("finalContentRead") is not False
        or not is_sha256(audit_hash)
        or hashlib.sha256(canonical_json(audit_without_hash).encode("utf-8")).hexdigest()
        != audit_hash
        or receipt.get("fingerprintAuditSha256") != audit_hash
        or audit.get("selectionManifestSha256") != selection_sha256
        or audit.get("selectionInputTreeSha256") != selection.get("inputTreeSha256")
        or audit.get("exactDuplicatePairs") != 0
        or audit.get("nearDuplicatePairs") != 0
        or audit.get("nearDuplicateDocumentRate") != 0
        or audit.get("exactHoldoutOverlaps") != 0
        or audit.get("nearHoldoutOverlaps") != 0
        or audit.get("longWindowLeakages") != 0
        or not required_holdouts.issubset(audit_holdouts)
        or not isinstance(audit.get("inputNearDuplicateDocumentRate"), (int, float))
        or audit["inputNearDuplicateDocumentRate"] < 0
        or audit["inputNearDuplicateDocumentRate"] > 0.03
    ):
        raise ValueError("formal selection fingerprint audit is invalid")
    return {
        "selectionStageReceiptSha256": sha256_file(receipt_path),
        "fingerprintAuditSha256": sha256_file(audit_path),
        "fingerprintAuditReportSha256": audit_hash,
    }


def train_tokenizer_assets(output_dir: Path, train_paths: Iterable[Path]) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "tokenizer.unigram.model"
    runtime_path = output_dir / "tokenizer.runtime.json"
    corpus = output_dir / "tokenizer-corpus.txt"
    with corpus.open("w", encoding="utf-8", newline="\n") as output:
        for path in train_paths:
            output.write(normalize_text(path.read_text(encoding="utf-8")))
            output.write("\n")
    prefix = output_dir / "tokenizer.unigram"
    try:
        spm.SentencePieceTrainer.train(
            input=str(corpus),
            model_prefix=str(prefix),
            model_type="unigram",
            vocab_size=VOCABULARY_SIZE,
            byte_fallback=True,
            character_coverage=1.0,
            normalization_rule_name="identity",
            pad_id=0,
            unk_id=1,
            bos_id=2,
            eos_id=3,
            shuffle_input_sentence=False,
            num_threads=1,
            hard_vocab_limit=True,
        )
        (output_dir / "tokenizer.unigram.vocab").unlink()
        export_sentencepiece_runtime(model_path, runtime_path)
    finally:
        corpus.unlink(missing_ok=True)
    return model_path, runtime_path


def verify_shared_tokenizer(model_path: Path, runtime_path: Path) -> None:
    UnigramRuntimeTokenizer.from_path(runtime_path)
    with tempfile.TemporaryDirectory(prefix="jotluck-tokenizer-verify-") as directory:
        regenerated = Path(directory) / "tokenizer.runtime.json"
        export_sentencepiece_runtime(model_path, regenerated)
        if regenerated.read_bytes() != runtime_path.read_bytes():
            raise ValueError("shared tokenizer model and runtime assets disagree")


def prepare_tokenizer(config: Config, train_paths: Iterable[Path]) -> tuple[Path, Path]:
    validate_shared_tokenizer_paths(config.tokenizer_model_path, config.tokenizer_runtime_path)
    model_path = config.checkpoint_dir / "tokenizer.unigram.model"
    runtime_path = config.checkpoint_dir / "tokenizer.runtime.json"
    if config.resume is not None:
        if not model_path.is_file() or not runtime_path.is_file():
            raise FileNotFoundError("resume tokenizer artifacts are missing")
        verify_shared_tokenizer(model_path, runtime_path)
        if config.tokenizer_model_path is not None and config.tokenizer_runtime_path is not None:
            if (
                sha256_file(model_path) != sha256_file(config.tokenizer_model_path)
                or sha256_file(runtime_path) != sha256_file(config.tokenizer_runtime_path)
            ):
                raise ValueError("resume tokenizer does not match the frozen shared tokenizer")
        return model_path, runtime_path
    if config.tokenizer_model_path is not None and config.tokenizer_runtime_path is not None:
        verify_shared_tokenizer(config.tokenizer_model_path, config.tokenizer_runtime_path)
        shutil.copyfile(config.tokenizer_model_path, model_path)
        shutil.copyfile(config.tokenizer_runtime_path, runtime_path)
        return model_path, runtime_path
    return train_tokenizer_assets(config.checkpoint_dir, train_paths)


def tokenize_documents(tokenizer_path: Path, paths: Iterable[Path]) -> list[int]:
    tokenizer = UnigramRuntimeTokenizer.from_path(tokenizer_path)
    return encode_documents(
        tokenizer, (path.read_text(encoding="utf-8") for path in paths)
    )


def train_model(
    config: Config,
    train_token_ids: list[int],
    dev_token_ids: list[int],
    selection_sha256: str,
) -> TrainingResult:
    device = resolve_device(config.device)
    initial_batch_size = config.batch_size
    oom_state = load_or_initialize_oom_state(config, selection_sha256)
    batch_size = int(oom_state["activeMicroBatchSize"])
    oom_adjustments = list(oom_state["adjustments"])
    resume_path = resolve_resume_checkpoint(
        config,
        batch_size,
        allow_missing_adjusted=bool(oom_adjustments),
    )
    while True:
        try:
            return train_model_once(
                config,
                train_token_ids,
                dev_token_ids,
                selection_sha256,
                device,
                initial_batch_size,
                batch_size,
                oom_adjustments,
                resume_path,
            )
        except RuntimeError as error:
            if not is_cuda_out_of_memory(error, device):
                raise
            adjustment = next_oom_adjustment(batch_size)
            if adjustment is None:
                raise RuntimeError(
                    "CUDA out of memory at the minimum microbatch 1; global batch 128 was not changed"
                ) from error
            oom_adjustments.append(adjustment)
            batch_size = int(adjustment["toMicroBatchSize"])
            write_oom_state(
                config,
                selection_sha256,
                initial_batch_size,
                batch_size,
                oom_adjustments,
            )
            resume_path = None
            gc.collect()
            torch.cuda.empty_cache()


def train_model_once(
    config: Config,
    train_token_ids: list[int],
    dev_token_ids: list[int],
    selection_sha256: str,
    device: torch.device,
    initial_batch_size: int,
    batch_size: int,
    oom_adjustments: list[dict[str, Any]],
    resume_path: Path | None,
) -> TrainingResult:
    torch.manual_seed(config.seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(config.seed)
    width, layers, heads, feed_forward, _ = MATRIX[config.matrix_id]
    model = DecoderOnlyModel(width, layers, heads, feed_forward).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        betas=(0.9, 0.95),
        weight_decay=0.1,
    )
    use_amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    train_dataset = TokenWindows(train_token_ids, MAX_CONTEXT_TOKENS)
    dev_dataset = TokenWindows(dev_token_ids, MAX_CONTEXT_TOKENS)
    if len(train_dataset) < 1 or len(dev_dataset) < 1:
        raise ValueError("training and development corpora must each contain one context window")
    accumulation_steps = GLOBAL_BATCH_SIZE // batch_size
    batches_per_epoch = math.ceil(len(train_dataset) / batch_size)
    steps_per_epoch = math.ceil(batches_per_epoch / accumulation_steps)
    total_steps = steps_per_epoch * config.epochs
    warmup_steps = max(1, math.ceil(total_steps * WARMUP_RATIO))
    signature = checkpoint_signature(
        config,
        selection_sha256,
        total_steps,
        warmup_steps,
        initial_batch_size,
        batch_size,
        accumulation_steps,
        oom_adjustments,
    )

    start_epoch = 0
    start_batch = 0
    global_step = 0
    epoch_loss_sum = 0.0
    epoch_loss_batches = 0
    train_losses: list[float] = []
    dev_evaluations: list[dict[str, float | int]] = []
    best_dev_loss = math.inf
    best_step = -1
    resumed_from: str | None = None
    if resume_path is not None:
        checkpoint = torch.load(resume_path, map_location=device, weights_only=False)
        if checkpoint.get("schema") != CHECKPOINT_SCHEMA or checkpoint.get("signature") != signature:
            raise ValueError("resume checkpoint does not match the frozen training recipe")
        model.load_state_dict(checkpoint["modelState"])
        optimizer.load_state_dict(checkpoint["optimizerState"])
        scaler.load_state_dict(checkpoint["scalerState"])
        start_epoch = int(checkpoint["epoch"])
        start_batch = int(checkpoint["batchInEpoch"])
        global_step = int(checkpoint["globalStep"])
        epoch_loss_sum = float(checkpoint.get("epochLossSum", 0.0))
        epoch_loss_batches = int(checkpoint.get("epochLossBatches", 0))
        train_losses = [float(value) for value in checkpoint.get("trainLosses", [])]
        dev_evaluations = list(checkpoint.get("devEvaluations", []))
        best_dev_loss = float(checkpoint.get("bestDevLoss", math.inf))
        best_step = int(checkpoint.get("bestStep", -1))
        resumed_from = str(resume_path)

    dev_loader = DataLoader(dev_dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    for epoch in range(start_epoch, config.epochs):
        generator = torch.Generator().manual_seed(config.seed + epoch)
        train_loader = DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=True,
            generator=generator,
            num_workers=0,
        )
        model.train()
        optimizer.zero_grad(set_to_none=True)
        for batch_index, (inputs, targets) in enumerate(train_loader):
            if epoch == start_epoch and batch_index < start_batch:
                continue
            group_start = (batch_index // accumulation_steps) * accumulation_steps
            group_size = min(accumulation_steps, len(train_loader) - group_start)
            inputs = inputs.to(device, non_blocking=use_amp)
            targets = targets.to(device, non_blocking=use_amp)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                logits = model(inputs)
                raw_loss = torch.nn.functional.cross_entropy(
                    logits.reshape(-1, VOCABULARY_SIZE), targets.reshape(-1), ignore_index=0
                )
                loss = raw_loss / group_size
            scaler.scale(loss).backward()
            epoch_loss_sum += float(raw_loss.detach())
            epoch_loss_batches += 1
            group_complete = (batch_index + 1) % accumulation_steps == 0 or (
                batch_index + 1 == len(train_loader)
            )
            if not group_complete:
                continue
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            learning_rate = scheduled_learning_rate(
                config.learning_rate, global_step, total_steps, warmup_steps
            )
            for group in optimizer.param_groups:
                group["lr"] = learning_rate
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            global_step += 1

            if global_step % CHECKPOINT_INTERVAL_STEPS == 0:
                best_dev_loss, best_step = evaluate_and_checkpoint(
                    config=config,
                    model=model,
                    optimizer=optimizer,
                    scaler=scaler,
                    dev_loader=dev_loader,
                    device=device,
                    use_amp=use_amp,
                    signature=signature,
                    epoch=epoch,
                    batch_in_epoch=batch_index + 1,
                    global_step=global_step,
                    epoch_loss_sum=epoch_loss_sum,
                    epoch_loss_batches=epoch_loss_batches,
                    train_losses=train_losses,
                    dev_evaluations=dev_evaluations,
                    best_dev_loss=best_dev_loss,
                    best_step=best_step,
                    checkpoint_dir=training_checkpoint_dir(config, batch_size),
                )

        train_losses.append(epoch_loss_sum / max(1, epoch_loss_batches))
        epoch_loss_sum = 0.0
        epoch_loss_batches = 0
        best_dev_loss, best_step = evaluate_and_checkpoint(
            config=config,
            model=model,
            optimizer=optimizer,
            scaler=scaler,
            dev_loader=dev_loader,
            device=device,
            use_amp=use_amp,
            signature=signature,
            epoch=epoch + 1,
            batch_in_epoch=0,
            global_step=global_step,
            epoch_loss_sum=0.0,
            epoch_loss_batches=0,
            train_losses=train_losses,
            dev_evaluations=dev_evaluations,
            best_dev_loss=best_dev_loss,
            best_step=best_step,
            checkpoint_dir=training_checkpoint_dir(config, batch_size),
        )
        start_batch = 0

    best_checkpoint = training_checkpoint_dir(config, batch_size) / "best.pt"
    if not best_checkpoint.is_file():
        raise RuntimeError("training completed without a best development checkpoint")
    best = torch.load(best_checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(best["modelState"])
    model = model.cpu().eval()
    return TrainingResult(
        model=model,
        train_losses=train_losses,
        dev_evaluations=dev_evaluations,
        best_dev_loss=best_dev_loss,
        best_step=best_step,
        total_steps=total_steps,
        warmup_steps=warmup_steps,
        resumed_from=resumed_from,
        initial_micro_batch_size=initial_batch_size,
        final_micro_batch_size=batch_size,
        gradient_accumulation_steps=accumulation_steps,
        oom_adjustments=list(oom_adjustments),
    )


@torch.no_grad()
def evaluate_dev_loss(
    model: DecoderOnlyModel,
    loader: DataLoader[tuple[Tensor, Tensor]],
    device: torch.device,
    use_amp: bool,
) -> float:
    model.eval()
    total_loss = 0.0
    batches = 0
    for inputs, targets in loader:
        inputs = inputs.to(device, non_blocking=use_amp)
        targets = targets.to(device, non_blocking=use_amp)
        with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
            logits = model(inputs)
            loss = torch.nn.functional.cross_entropy(
                logits.reshape(-1, VOCABULARY_SIZE), targets.reshape(-1), ignore_index=0
            )
        total_loss += float(loss)
        batches += 1
    model.train()
    return total_loss / max(1, batches)


def evaluate_and_checkpoint(
    *,
    config: Config,
    model: DecoderOnlyModel,
    optimizer: torch.optim.Optimizer,
    scaler: torch.amp.GradScaler,
    dev_loader: DataLoader[tuple[Tensor, Tensor]],
    device: torch.device,
    use_amp: bool,
    signature: dict[str, Any],
    epoch: int,
    batch_in_epoch: int,
    global_step: int,
    epoch_loss_sum: float,
    epoch_loss_batches: int,
    train_losses: list[float],
    dev_evaluations: list[dict[str, float | int]],
    best_dev_loss: float,
    best_step: int,
    checkpoint_dir: Path,
) -> tuple[float, int]:
    dev_loss = evaluate_dev_loss(model, dev_loader, device, use_amp)
    dev_evaluations.append({"step": global_step, "loss": dev_loss})
    improved = dev_loss < best_dev_loss
    if improved:
        best_dev_loss = dev_loss
        best_step = global_step
    state = {
        "schema": CHECKPOINT_SCHEMA,
        "signature": signature,
        "epoch": epoch,
        "batchInEpoch": batch_in_epoch,
        "globalStep": global_step,
        "epochLossSum": epoch_loss_sum,
        "epochLossBatches": epoch_loss_batches,
        "trainLosses": train_losses,
        "devEvaluations": dev_evaluations,
        "bestDevLoss": best_dev_loss,
        "bestStep": best_step,
        "modelState": model.state_dict(),
        "optimizerState": optimizer.state_dict(),
        "scalerState": scaler.state_dict(),
    }
    step_path = checkpoint_dir / f"step-{global_step:09d}.pt"
    atomic_torch_save(state, step_path)
    if improved:
        atomic_torch_save(state, checkpoint_dir / "best.pt")
    prune_step_checkpoints(checkpoint_dir)
    return best_dev_loss, best_step


def scheduled_learning_rate(
    base_learning_rate: float, completed_steps: int, total_steps: int, warmup_steps: int
) -> float:
    next_step = completed_steps + 1
    if next_step <= warmup_steps:
        return base_learning_rate * next_step / warmup_steps
    if total_steps <= warmup_steps:
        return base_learning_rate
    progress = min(1.0, (next_step - warmup_steps) / (total_steps - warmup_steps))
    return base_learning_rate * 0.5 * (1.0 + math.cos(math.pi * progress))


def next_oom_adjustment(batch_size: int) -> dict[str, Any] | None:
    if batch_size not in {8, 4, 2, 1}:
        raise ValueError("microbatch is outside the fixed CUDA OOM chains")
    if batch_size == 1:
        return None
    next_batch_size = batch_size // 2
    return {
        "reason": "cudaOutOfMemory",
        "fromMicroBatchSize": batch_size,
        "toMicroBatchSize": next_batch_size,
        "fromGradientAccumulationSteps": GLOBAL_BATCH_SIZE // batch_size,
        "toGradientAccumulationSteps": GLOBAL_BATCH_SIZE // next_batch_size,
        "globalBatchSize": GLOBAL_BATCH_SIZE,
    }


def is_cuda_out_of_memory(error: BaseException, device: torch.device) -> bool:
    if device.type != "cuda":
        return False
    oom_types = tuple(
        candidate
        for candidate in (
            getattr(torch, "OutOfMemoryError", None),
            getattr(torch.cuda, "OutOfMemoryError", None),
        )
        if isinstance(candidate, type)
    )
    if oom_types and isinstance(error, oom_types):
        return True
    message = str(error).lower()
    return isinstance(error, RuntimeError) and "cuda" in message and "out of memory" in message


def oom_recipe_identity(
    config: Config, selection_sha256: str, initial_batch_size: int
) -> dict[str, Any]:
    return {
        "engine": ENGINE_ID,
        "matrixId": config.matrix_id,
        "candidateId": config.candidate_id,
        "selectionSha256": selection_sha256,
        "seed": config.seed,
        "modelInitialization": MODEL_INITIALIZATION,
        "epochs": config.epochs,
        "initialMicroBatchSize": initial_batch_size,
        "globalBatchSize": GLOBAL_BATCH_SIZE,
        "learningRate": config.learning_rate,
        "optimizer": {"name": "adamw", "betas": [0.9, 0.95], "weightDecay": 0.1},
        "schedule": {"name": "warmup-cosine", "warmupRatio": WARMUP_RATIO},
    }


def validate_oom_adjustments(
    matrix_id: str,
    initial_batch_size: int,
    active_batch_size: int,
    adjustments: list[dict[str, Any]],
) -> None:
    validate_micro_batch_size(matrix_id, initial_batch_size)
    current = initial_batch_size
    for adjustment in adjustments:
        expected = next_oom_adjustment(current)
        if expected is None or adjustment != expected:
            raise ValueError("OOM adjustment history does not follow the fixed halving policy")
        current = int(expected["toMicroBatchSize"])
    if active_batch_size != current:
        raise ValueError("active microbatch does not match the recorded OOM adjustment history")


def oom_state_path(config: Config) -> Path:
    return config.checkpoint_dir / "oom-adjustments.json"


def write_oom_state(
    config: Config,
    selection_sha256: str,
    initial_batch_size: int,
    active_batch_size: int,
    adjustments: list[dict[str, Any]],
) -> dict[str, Any]:
    validate_oom_adjustments(
        config.matrix_id, initial_batch_size, active_batch_size, adjustments
    )
    state = {
        "schema": OOM_STATE_SCHEMA,
        "recipe": oom_recipe_identity(config, selection_sha256, initial_batch_size),
        "activeMicroBatchSize": active_batch_size,
        "adjustments": adjustments,
    }
    atomic_json_write(state, oom_state_path(config))
    return state


def load_or_initialize_oom_state(
    config: Config, selection_sha256: str
) -> dict[str, Any]:
    path = oom_state_path(config)
    if config.resume is None:
        if path.exists():
            raise FileExistsError("OOM adjustment state already exists for a fresh training run")
        return write_oom_state(
            config, selection_sha256, config.batch_size, config.batch_size, []
        )
    if not path.is_file():
        raise FileNotFoundError("resume requires the OOM adjustment identity state")
    state = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(state, dict)
        or state.get("schema") != OOM_STATE_SCHEMA
        or state.get("recipe")
        != oom_recipe_identity(config, selection_sha256, config.batch_size)
        or not isinstance(state.get("activeMicroBatchSize"), int)
        or not isinstance(state.get("adjustments"), list)
    ):
        raise ValueError("resume OOM state does not match the frozen training recipe")
    validate_oom_adjustments(
        config.matrix_id,
        config.batch_size,
        state["activeMicroBatchSize"],
        state["adjustments"],
    )
    return state


def checkpoint_signature(
    config: Config,
    selection_sha256: str,
    total_steps: int,
    warmup_steps: int,
    initial_batch_size: int,
    batch_size: int,
    accumulation_steps: int,
    oom_adjustments: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "engine": ENGINE_ID,
        "matrixId": config.matrix_id,
        "candidateId": config.candidate_id,
        "selectionSha256": selection_sha256,
        "seed": config.seed,
        "modelInitialization": MODEL_INITIALIZATION,
        "epochs": config.epochs,
        "initialMicroBatchSize": initial_batch_size,
        "microBatchSize": batch_size,
        "globalBatchSize": GLOBAL_BATCH_SIZE,
        "gradientAccumulationSteps": accumulation_steps,
        "oomAdjustments": oom_adjustments,
        "learningRate": config.learning_rate,
        "optimizer": {"name": "adamw", "betas": [0.9, 0.95], "weightDecay": 0.1},
        "schedule": {"name": "warmup-cosine", "warmupRatio": WARMUP_RATIO},
        "totalSteps": total_steps,
        "warmupSteps": warmup_steps,
    }


def training_checkpoint_dir(config: Config, batch_size: int) -> Path:
    return config.checkpoint_dir / f"microbatch-{batch_size}"


def resolve_resume_checkpoint(
    config: Config, batch_size: int, *, allow_missing_adjusted: bool = False
) -> Path | None:
    if config.resume is None:
        return None
    checkpoint_dir = training_checkpoint_dir(config, batch_size)
    if config.resume == "auto":
        candidates = sorted(checkpoint_dir.glob("step-*.pt"))
        if not candidates:
            if allow_missing_adjusted:
                return None
            raise FileNotFoundError("no step checkpoint is available for automatic resume")
        return candidates[-1]
    path = resolve_inside(config.workspace_root, Path(config.resume))
    if path.parent != checkpoint_dir or not path.is_file():
        raise ValueError(
            "resume checkpoint must match the active microbatch checkpoint directory"
        )
    return path


def atomic_torch_save(value: Any, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            torch.save(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, target)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def atomic_json_write(value: Any, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, target)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def prune_step_checkpoints(checkpoint_dir: Path) -> None:
    checkpoints = sorted(checkpoint_dir.glob("step-*.pt"))
    for stale in checkpoints[:-CHECKPOINTS_TO_KEEP]:
        stale.unlink()


def export_quantized_model(
    model: DecoderOnlyModel,
    config: Config,
    target: Path,
    quantization: str,
    candidate_id: str,
) -> tuple[int, int, dict[str, Any]]:
    if quantization not in {"q4", "q8"}:
        raise ValueError("unsupported decoder quantization")
    payload = bytearray()
    tensors: list[dict[str, Any]] = []
    tensor_diagnostics: dict[str, dict[str, Any]] = {}
    unique_parameters: dict[int, str] = {}
    parameter_count = 0
    state_items = sorted(
        model.state_dict().items(),
        key=lambda item: (0 if item[0] == "token_embedding.weight" else 1, item[0]),
    )
    for name, tensor in state_items:
        storage_id = tensor.untyped_storage().data_ptr()
        if storage_id in unique_parameters:
            tensors.append({"name": name, "aliasOf": unique_parameters[storage_id]})
            continue
        unique_parameters[storage_id] = name
        array = tensor.detach().cpu().float().numpy()
        parameter_count += int(array.size)
        if array.ndim >= 2:
            (
                scale_payload,
                quantized_payload,
                groups,
                diagnostics,
            ) = quantize_grouped_array_with_report(array, quantization)
            tensor_diagnostics[name] = diagnostics
            scale_offset = len(payload)
            payload.extend(scale_payload)
            offset = len(payload)
            payload.extend(quantized_payload)
            tensors.append(
                {
                    "name": name,
                    "shape": list(array.shape),
                    "dtype": quantization,
                    "groupSize": QUANTIZATION_GROUP_SIZE,
                    "groups": groups,
                    "scaleOffset": scale_offset,
                    "scaleBytes": len(scale_payload),
                    "offset": offset,
                    "bytes": len(quantized_payload),
                }
            )
        else:
            encoded = array.astype("<f2").tobytes()
            offset = len(payload)
            payload.extend(encoded)
            tensors.append(
                {
                    "name": name,
                    "shape": list(array.shape),
                    "dtype": "f16",
                    "offset": offset,
                    "bytes": len(encoded),
                }
            )
    quantization_diagnostics = summarize_quantization_diagnostics(
        quantization, tensor_diagnostics
    )
    width, layers, heads, feed_forward, _ = MATRIX[config.matrix_id]
    header = {
        "schema": MODEL_SCHEMA,
        "engine": ENGINE_ID,
        "candidateId": candidate_id,
        "nominalParameterCount": NOMINAL_PARAMETERS[config.matrix_id],
        "actualParameterCount": parameter_count,
        "quantization": quantization,
        "vocabularySize": VOCABULARY_SIZE,
        "maximumContextTokens": MAX_CONTEXT_TOKENS,
        "architecture": {
            "width": width,
            "layers": layers,
            "heads": heads,
            "feedForward": feed_forward,
            "activation": "gelu",
            "tiedEmbedding": True,
            "initialization": MODEL_INITIALIZATION,
            "layerNormEpsilon": LAYER_NORM_EPSILON,
        },
        "quantizationDiagnostics": quantization_diagnostics,
        "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "tensors": tensors,
    }
    header_bytes = canonical_json(header).encode("utf-8")
    with target.open("wb") as output:
        output.write(MODEL_MAGIC)
        output.write(struct.pack("<I", len(header_bytes)))
        output.write(header_bytes)
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
    return parameter_count, len(payload), quantization_diagnostics


def quantize_grouped_array(
    array: np.ndarray[Any, Any], quantization: str
) -> tuple[bytes, bytes, int]:
    scales, encoded, groups, _ = quantize_grouped_array_with_report(array, quantization)
    return scales, encoded, groups


def quantization_integer_range(quantization: str) -> tuple[int, int]:
    if quantization == "q4":
        return -8, 7
    if quantization == "q8":
        return -127, 127
    raise ValueError("unsupported decoder quantization")


def optimized_group_scales(
    values: np.ndarray[Any, Any], quantization: str
) -> np.ndarray[Any, Any]:
    """Return the exact F16 scales consumed by the JLFDQ02 runtime."""

    qmin, qmax = quantization_integer_range(quantization)
    minimum_scale = np.float16(np.finfo(np.float16).tiny)
    if quantization == "q8":
        maximum_absolute = np.max(np.abs(values), axis=1)
        return np.maximum(maximum_absolute / qmax, float(minimum_scale)).astype("<f2")

    # Q4 has an intentionally asymmetric signed code range (-8..7).  The old
    # max(abs(x))/7 formula never used the extra negative level for scale
    # selection.  Start with a no-clipping scale that covers each signed side,
    # then minimize reconstruction MSE while repeatedly rounding the candidate
    # scale to the F16 value that will actually be stored in JLFDQ02.
    positive_scale = np.maximum(np.max(values, axis=1), 0.0) / qmax
    negative_scale = np.maximum(-np.min(values, axis=1), 0.0) / -qmin
    scales = np.maximum(
        np.maximum(positive_scale, negative_scale), float(minimum_scale)
    ).astype("<f2")
    scale_values = scales.astype(np.float32)
    quantized = np.clip(np.rint(values / scale_values[:, None]), qmin, qmax)
    best_error = np.mean(
        np.square(values - quantized * scale_values[:, None]), axis=1
    )

    for _ in range(Q4_SCALE_OPTIMIZATION_ITERATIONS):
        denominator = np.sum(np.square(quantized), axis=1)
        least_squares = np.divide(
            np.sum(values * quantized, axis=1),
            denominator,
            out=scale_values.copy(),
            where=denominator > 0,
        )
        candidate = np.maximum(least_squares, float(minimum_scale)).astype("<f2")
        candidate_variants = (
            candidate,
            np.nextafter(candidate, np.full_like(candidate, np.inf)),
            np.nextafter(candidate, np.zeros_like(candidate)),
        )
        for candidate_f16 in candidate_variants:
            candidate_f16 = np.maximum(candidate_f16, minimum_scale).astype("<f2")
            candidate_values = candidate_f16.astype(np.float32)
            candidate_quantized = np.clip(
                np.rint(values / candidate_values[:, None]), qmin, qmax
            )
            candidate_error = np.mean(
                np.square(values - candidate_quantized * candidate_values[:, None]),
                axis=1,
            )
            improved = candidate_error < best_error
            scales[improved] = candidate_f16[improved]
            best_error[improved] = candidate_error[improved]
        scale_values = scales.astype(np.float32)
        quantized = np.clip(np.rint(values / scale_values[:, None]), qmin, qmax)
    return scales


def quantize_grouped_array_with_report(
    array: np.ndarray[Any, Any], quantization: str
) -> tuple[bytes, bytes, int, dict[str, Any]]:
    flat = np.asarray(array, dtype=np.float32).reshape(-1)
    if flat.size == 0 or not np.all(np.isfinite(flat)):
        raise ValueError("decoder quantization requires a non-empty finite tensor")
    groups = math.ceil(flat.size / QUANTIZATION_GROUP_SIZE)
    scales = np.empty(groups, dtype="<f2")
    bytes_per_group = 32 if quantization == "q4" else 64
    encoded = bytearray(groups * bytes_per_group)
    qmin, qmax = quantization_integer_range(quantization)
    absolute_error_sum = 0.0
    squared_error_sum = 0.0
    maximum_error = 0.0
    saturated_values = 0
    endpoint_values = 0

    for group_start in range(0, groups, QUANTIZATION_CHUNK_GROUPS):
        group_end = min(groups, group_start + QUANTIZATION_CHUNK_GROUPS)
        value_start = group_start * QUANTIZATION_GROUP_SIZE
        value_end = min(flat.size, group_end * QUANTIZATION_GROUP_SIZE)
        valid_values = flat[value_start:value_end]
        padded_values = np.zeros(
            (group_end - group_start) * QUANTIZATION_GROUP_SIZE,
            dtype=np.float32,
        )
        padded_values[: valid_values.size] = valid_values
        grouped_values = padded_values.reshape(-1, QUANTIZATION_GROUP_SIZE)
        chunk_scales = optimized_group_scales(grouped_values, quantization)
        scales[group_start:group_end] = chunk_scales
        scale_values = chunk_scales.astype(np.float32)
        rounded = np.rint(grouped_values / scale_values[:, None])
        quantized = np.clip(rounded, qmin, qmax).astype(np.int8)
        valid_rounded = rounded.reshape(-1)[: valid_values.size]
        valid_quantized = quantized.reshape(-1)[: valid_values.size]
        reconstruction = (
            quantized.astype(np.float32) * scale_values[:, None]
        ).reshape(-1)[: valid_values.size]
        error = valid_values - reconstruction
        absolute_error_sum += float(np.sum(np.abs(error), dtype=np.float64))
        squared_error_sum += float(np.sum(np.square(error), dtype=np.float64))
        maximum_error = max(maximum_error, float(np.max(np.abs(error))))
        saturated_values += int(
            np.count_nonzero((valid_rounded < qmin) | (valid_rounded > qmax))
        )
        endpoint_values += int(
            np.count_nonzero((valid_quantized == qmin) | (valid_quantized == qmax))
        )
        target = group_start * bytes_per_group
        if quantization == "q4":
            nibbles = (quantized.astype(np.int16) + 8).astype(np.uint8).reshape(-1)
            packed = nibbles[0::2] | (nibbles[1::2] << 4)
            encoded[target : target + packed.size] = packed.tobytes()
        elif quantization == "q8":
            flattened = quantized.reshape(-1)
            encoded[target : target + flattened.size] = flattened.tobytes()

    elements = int(flat.size)
    source_mean = float(np.mean(flat, dtype=np.float64))
    source_rms = math.sqrt(float(np.mean(np.square(flat), dtype=np.float64)))
    report = {
        "elements": elements,
        "groups": groups,
        "sourceMean": source_mean,
        "sourceStandardDeviation": float(np.std(flat, dtype=np.float64)),
        "sourceRootMeanSquare": source_rms,
        "sourceMaximumAbsolute": float(np.max(np.abs(flat))),
        "sourceP99Absolute": float(np.percentile(np.abs(flat), 99)),
        "reconstructionMeanAbsoluteError": absolute_error_sum / elements,
        "reconstructionRootMeanSquareError": math.sqrt(squared_error_sum / elements),
        "reconstructionMaximumAbsoluteError": maximum_error,
        "saturatedValues": saturated_values,
        "saturationRate": saturated_values / elements,
        "endpointValues": endpoint_values,
        "endpointRate": endpoint_values / elements,
        "scaleMinimum": float(np.min(scales)),
        "scaleMaximum": float(np.max(scales)),
    }
    return scales.tobytes(), bytes(encoded), groups, report


def summarize_quantization_diagnostics(
    quantization: str, tensor_reports: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    qmin, qmax = quantization_integer_range(quantization)
    elements = sum(int(report["elements"]) for report in tensor_reports.values())
    groups = sum(int(report["groups"]) for report in tensor_reports.values())
    source_sum = sum(
        float(report["sourceMean"]) * int(report["elements"])
        for report in tensor_reports.values()
    )
    source_square_sum = sum(
        float(report["sourceRootMeanSquare"]) ** 2 * int(report["elements"])
        for report in tensor_reports.values()
    )
    absolute_error_sum = sum(
        float(report["reconstructionMeanAbsoluteError"]) * int(report["elements"])
        for report in tensor_reports.values()
    )
    squared_error_sum = sum(
        float(report["reconstructionRootMeanSquareError"]) ** 2
        * int(report["elements"])
        for report in tensor_reports.values()
    )
    saturated_values = sum(
        int(report["saturatedValues"]) for report in tensor_reports.values()
    )
    endpoint_values = sum(int(report["endpointValues"]) for report in tensor_reports.values())
    representative_names = (
        "token_embedding.weight",
        "position_embedding.weight",
        "blocks.layers.0.self_attn.in_proj_weight",
        "blocks.layers.0.linear1.weight",
    )
    aggregate_mean = source_sum / elements
    aggregate = {
        "tensors": len(tensor_reports),
        "elements": elements,
        "groups": groups,
        "sourceMean": aggregate_mean,
        "sourceStandardDeviation": math.sqrt(
            max(0.0, source_square_sum / elements - aggregate_mean**2)
        ),
        "sourceRootMeanSquare": math.sqrt(source_square_sum / elements),
        "sourceMaximumAbsolute": max(
            float(report["sourceMaximumAbsolute"])
            for report in tensor_reports.values()
        ),
        "reconstructionMeanAbsoluteError": absolute_error_sum / elements,
        "reconstructionRootMeanSquareError": math.sqrt(squared_error_sum / elements),
        "reconstructionMaximumAbsoluteError": max(
            float(report["reconstructionMaximumAbsoluteError"])
            for report in tensor_reports.values()
        ),
        "saturatedValues": saturated_values,
        "saturationRate": saturated_values / elements,
        "endpointValues": endpoint_values,
        "endpointRate": endpoint_values / elements,
    }
    largest_errors = sorted(
        (
            {
                "name": name,
                "rootMeanSquareError": report[
                    "reconstructionRootMeanSquareError"
                ],
                "maximumAbsoluteError": report[
                    "reconstructionMaximumAbsoluteError"
                ],
            }
            for name, report in tensor_reports.items()
        ),
        key=lambda item: float(item["rootMeanSquareError"]),
        reverse=True,
    )[:5]
    return {
        "schema": QUANTIZATION_DIAGNOSTICS_SCHEMA,
        "quantization": quantization,
        "scaleAlgorithm": (
            Q4_SCALE_ALGORITHM if quantization == "q4" else Q8_SCALE_ALGORITHM
        ),
        "groupSize": QUANTIZATION_GROUP_SIZE,
        "scaleDtype": "f16",
        "integerRange": {
            "minimum": qmin,
            "maximum": qmax,
            "zeroPoint": 0,
            "storageBias": 8 if quantization == "q4" else 0,
        },
        "aggregate": aggregate,
        "representativeTensors": {
            name: tensor_reports[name]
            for name in representative_names
            if name in tensor_reports
        },
        "largestTensorErrors": largest_errors,
    }


def export_quantizations(config: Config) -> tuple[str, ...]:
    if config.matrix_id == "16m-q4":
        return ("q4", "q8")
    return ("q4",)


def export_candidate_id(config: Config, quantization: str) -> str:
    if quantization not in export_quantizations(config):
        raise ValueError("quantization is not exported by this training recipe")
    return f"{config.candidate_id}.{quantization}"


def main() -> None:
    config = parse_args()
    configure_determinism(config)
    selection, train_paths, dev_paths = load_selection(config)
    formal_governance = (
        validate_formal_selection_governance(
            config, selection, config.selection_path.read_bytes()
        )
        if selection["selectedBytes"] >= FORMAL_MATRIX_MINIMUM_BYTES
        else None
    )
    if (
        selection["selectedBytes"] >= FORMAL_MATRIX_MINIMUM_BYTES
        and config.tokenizer_model_path is None
    ):
        raise ValueError("formal matrix training requires a frozen shared tokenizer")
    config.output_dir.parent.mkdir(parents=True, exist_ok=True)
    if config.output_dir.exists():
        raise FileExistsError("candidate output directory already exists")
    if config.resume is None:
        try:
            config.checkpoint_dir.mkdir(parents=False, exist_ok=False)
        except FileExistsError as error:
            raise FileExistsError(
                "candidate checkpoint directory exists; use --resume or choose a new candidate id"
            ) from error
    elif not config.checkpoint_dir.is_dir():
        raise FileNotFoundError("candidate checkpoint directory does not exist")

    _, tokenizer_runtime_path = prepare_tokenizer(config, train_paths)
    train_token_ids = tokenize_documents(tokenizer_runtime_path, train_paths)
    dev_token_ids = tokenize_documents(tokenizer_runtime_path, dev_paths)
    selection_sha256 = sha256_file(config.selection_path)
    training = train_model(
        config,
        train_token_ids,
        dev_token_ids,
        selection_sha256,
    )

    staging = Path(tempfile.mkdtemp(prefix=f".{config.candidate_id}-", dir=config.output_dir.parent))
    try:
        tokenizer_target = staging / "tokenizer.runtime.json"
        shutil.copyfile(tokenizer_runtime_path, tokenizer_target)
        sentencepiece_target = staging / "tokenizer.unigram.model"
        shutil.copyfile(config.checkpoint_dir / "tokenizer.unigram.model", sentencepiece_target)
        float_checkpoint_path = staging / f"{config.candidate_id}.best.float.pt"
        atomic_torch_save(
            {
                "schema": FLOAT_CHECKPOINT_SCHEMA,
                "engine": ENGINE_ID,
                "candidateId": config.candidate_id,
                "matrixId": config.matrix_id,
                "bestStep": training.best_step,
                "bestDevLoss": training.best_dev_loss,
                "modelInitialization": MODEL_INITIALIZATION,
                "initialMicroBatchSize": training.initial_micro_batch_size,
                "microBatchSize": training.final_micro_batch_size,
                "globalBatchSize": GLOBAL_BATCH_SIZE,
                "gradientAccumulationSteps": training.gradient_accumulation_steps,
                "oomAdjustments": training.oom_adjustments,
                "modelState": training.model.state_dict(),
            },
            float_checkpoint_path,
        )

        exported: dict[str, dict[str, Any]] = {}
        actual_parameters: int | None = None
        for quantization in export_quantizations(config):
            exported_candidate_id = export_candidate_id(config, quantization)
            model_path = staging / f"{config.candidate_id}.{quantization}.decoder.bin"
            current_parameters, payload_bytes, quantization_diagnostics = export_quantized_model(
                training.model,
                config,
                model_path,
                quantization,
                exported_candidate_id,
            )
            if actual_parameters is not None and current_parameters != actual_parameters:
                raise RuntimeError("quantized exports disagree on actual parameter count")
            actual_parameters = current_parameters
            exported[quantization] = {
                "candidateId": exported_candidate_id,
                "model": asset_record(model_path),
                "quantizedPayloadBytes": payload_bytes,
                "quantizationDiagnostics": quantization_diagnostics,
            }

        _, _, _, _, primary_quantization = MATRIX[config.matrix_id]
        tokenizer_asset = asset_record(tokenizer_target)
        for quantization, export in exported.items():
            manifest = build_trained_manifest(
                config,
                export["candidateId"],
                quantization,
                export["model"],
                tokenizer_asset,
                selection["selectedBytes"],
                selection_sha256,
                selection["inputTreeSha256"],
                formal_governance,
            )
            manifest_path = staging / f"candidate.{quantization}.manifest.json"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            export["candidateArtifactSha256"] = manifest["candidateArtifactSha256"]
            export["manifest"] = asset_record(manifest_path)
        primary_export = exported[primary_quantization]
        model_asset = primary_export["model"]
        device = resolve_device(config.device)
        report = {
            "schema": TRAINING_REPORT_SCHEMA,
            "schemaVersion": 1,
            "engine": ENGINE_ID,
            "candidateId": primary_export["candidateId"],
            "trainingRunId": config.candidate_id,
            "candidateArtifactSha256": primary_export["candidateArtifactSha256"],
            "matrixId": config.matrix_id,
            "nominalParameterCount": NOMINAL_PARAMETERS[config.matrix_id],
            "actualParameterCount": actual_parameters,
            "quantization": primary_quantization,
            "modelFormat": {
                "magic": "JLFDQ02\\0",
                "schema": MODEL_SCHEMA,
                "groupSize": QUANTIZATION_GROUP_SIZE,
                "initialization": MODEL_INITIALIZATION,
                "layerNormEpsilon": LAYER_NORM_EPSILON,
            },
            "quantizationDiagnostics": {
                quantization: export["quantizationDiagnostics"]
                for quantization, export in exported.items()
            },
            "tokenizer": {
                "kind": "unigram",
                "vocabularySize": VOCABULARY_SIZE,
                "byteFallback": True,
                "runtimeSchema": "jotluck.autocomplete.unigram-runtime.v1",
                "shared": config.tokenizer_model_path is not None,
                "modelSha256": sha256_file(sentencepiece_target),
                "runtimeSha256": tokenizer_asset["sha256"],
            },
            "maximumContextTokens": MAX_CONTEXT_TOKENS,
            "training": {
                "seed": config.seed,
                "epochs": config.epochs,
                "initialMicroBatchSize": training.initial_micro_batch_size,
                "microBatchSize": training.final_micro_batch_size,
                "globalBatchSize": GLOBAL_BATCH_SIZE,
                "gradientAccumulationSteps": training.gradient_accumulation_steps,
                "oomAdjustments": training.oom_adjustments,
                "learningRate": config.learning_rate,
                "optimizer": {"name": "adamw", "betas": [0.9, 0.95], "weightDecay": 0.1},
                "schedule": {
                    "name": "warmup-cosine",
                    "warmupRatio": WARMUP_RATIO,
                    "warmupSteps": training.warmup_steps,
                    "totalSteps": training.total_steps,
                },
                "device": str(device),
                "fp16GradScaler": device.type == "cuda",
                "trainLosses": training.train_losses,
                "losses": training.train_losses,
                "devEvaluations": training.dev_evaluations,
                "bestDevLoss": training.best_dev_loss,
                "bestStep": training.best_step,
                "resumedFrom": training.resumed_from,
                "selectedBytes": selection["selectedBytes"],
                "selectionSha256": selection_sha256,
                "selectionInputTreeSha256": selection["inputTreeSha256"],
                "formalGovernance": formal_governance,
                "trainDocuments": len(train_paths),
                "developmentDocuments": len(dev_paths),
            },
            "assets": {
                "model": model_asset,
                "tokenizer": tokenizer_asset,
                "sentencepieceModel": asset_record(sentencepiece_target),
                "floatCheckpoint": asset_record(float_checkpoint_path),
                "quantizedPayloadBytes": primary_export["quantizedPayloadBytes"],
                "exports": exported,
            },
            "oraclePrecheckRun": False,
            "finalHoldoutsRead": False,
            "releaseEligible": False,
        }
        report["reportSha256"] = hashlib.sha256(canonical_json(report).encode("utf-8")).hexdigest()
        (staging / "training-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        write_remote_bundle_manifest_from_environment(staging)
        staging.rename(config.output_dir)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def resolve_inside(root: Path, value: Path) -> Path:
    candidate = value if value.is_absolute() else root / value
    resolved = candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"path escapes workspace: {value}")
    return resolved


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def remote_bundle_role(path: Path) -> str:
    name = path.name
    if name.endswith(".decoder.bin"):
        return "model"
    if name in {"tokenizer.runtime.json", "tokenizer.unigram.model"}:
        return "tokenizer"
    if name.endswith(".pt"):
        return "checkpoint"
    if name == "training-report.json":
        return "evidence"
    if name.startswith("candidate.") and name.endswith(".manifest.json"):
        return "metadata"
    raise ValueError(f"remote bundle contains an unclassified file: {path.as_posix()}")


def create_remote_bundle_manifest(
    staging: Path, job_id: str, source_job_sha256: str, created_at: str
) -> dict[str, Any]:
    if REMOTE_JOB_ID_PATTERN.fullmatch(job_id) is None:
        raise ValueError("remote job ID is invalid")
    if not is_sha256(source_job_sha256):
        raise ValueError("remote source job SHA-256 is invalid")
    manifest_path = staging / "manifest.json"
    if manifest_path.exists():
        raise FileExistsError("remote bundle manifest already exists")

    files: list[dict[str, Any]] = []
    for path in sorted(staging.rglob("*"), key=lambda value: value.as_posix()):
        if path.is_dir():
            continue
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"remote bundle contains an invalid file: {path}")
        relative = path.relative_to(staging).as_posix()
        asset = asset_record(path)
        files.append(
            {
                "relativePath": relative,
                "role": remote_bundle_role(path),
                "bytes": asset["bytes"],
                "sha256": asset["sha256"],
            }
        )
    if not files:
        raise ValueError("remote bundle has no files")

    base = {
        "schema": REMOTE_BUNDLE_SCHEMA,
        "jobId": job_id,
        "sourceJobSha256": source_job_sha256,
        "createdAt": created_at,
        "files": files,
        "totalBytes": sum(file["bytes"] for file in files),
    }
    return {
        **base,
        "bundleSha256": hashlib.sha256(canonical_json(base).encode("utf-8")).hexdigest(),
    }


def write_remote_bundle_manifest_from_environment(staging: Path) -> None:
    job_id = os.environ.get("JOTLUCK_REMOTE_JOB_ID")
    source_job_sha256 = os.environ.get("JOTLUCK_REMOTE_JOB_SHA256")
    if job_id is None and source_job_sha256 is None:
        return
    if not job_id or not source_job_sha256:
        raise ValueError("remote bundle identity environment is incomplete")
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
    manifest = create_remote_bundle_manifest(staging, job_id, source_job_sha256, created_at)
    atomic_json_write(manifest, staging / "manifest.json")


def candidate_artifact_identity(
    config: Config,
    candidate_id: str,
    quantization: str,
    model_asset: dict[str, Any],
    tokenizer_asset: dict[str, Any],
) -> dict[str, Any]:
    return {
        "candidateId": candidate_id,
        "engine": ENGINE_ID,
        "model": {"bytes": model_asset["bytes"], "sha256": model_asset["sha256"]},
        "parameterCount": NOMINAL_PARAMETERS[config.matrix_id],
        "quantization": quantization,
        "tokenizer": {
            "bytes": tokenizer_asset["bytes"],
            "sha256": tokenizer_asset["sha256"],
        },
    }


def build_trained_manifest(
    config: Config,
    candidate_id: str,
    quantization: str,
    model_asset: dict[str, Any],
    tokenizer_asset: dict[str, Any],
    cleaned_pool_bytes: int,
    selection_sha256: str,
    selection_input_tree_sha256: str,
    formal_governance: dict[str, str] | None,
) -> dict[str, Any]:
    identity = candidate_artifact_identity(
        config,
        candidate_id,
        quantization,
        model_asset,
        tokenizer_asset,
    )
    return {
        "schema": MANIFEST_SCHEMA,
        "schemaVersion": 1,
        "engine": ENGINE_ID,
        "candidateId": candidate_id,
        "candidateArtifactSha256": hashlib.sha256(
            canonical_json(identity).encode("utf-8")
        ).hexdigest(),
        "lifecycle": "trained",
        "evaluationOnly": True,
        "runtimeEligible": True,
        "releaseEligible": False,
        "parameterCount": NOMINAL_PARAMETERS[config.matrix_id],
        "quantization": quantization,
        "tokenizer": {
            "kind": "unigram",
            "vocabularySize": VOCABULARY_SIZE,
            "byteFallback": True,
            "bilingual": True,
        },
        "context": {"maximumTokens": MAX_CONTEXT_TOKENS},
        "output": {
            "chineseMaximumCodePoints": 8,
            "englishMaximumCodePoints": 12,
            "preserveCompleteEnglishWord": True,
        },
        "training": {
            "cleanedPoolBytes": cleaned_pool_bytes,
            "licenseAuditPassed": True,
            "selectionSha256": selection_sha256,
            "selectionInputTreeSha256": selection_input_tree_sha256,
            "formalGovernance": formal_governance,
        },
        "oraclePrecheck": {
            "checkpoints": 0,
            "oracleAt8": 0,
            "oracleAt32": 0,
            "chineseOracleAt8": 0,
            "englishOracleAt8": 0,
            "passed": False,
        },
        "assets": {"model": model_asset, "tokenizer": tokenizer_asset},
        "runtimeStaticDeltaBytes": 0,
        "measuredPeakMemoryBytes": 0,
        "measurementClaims": {
            "runtimeStaticDeltaBytes": False,
            "measuredPeakMemoryBytes": False,
        },
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def asset_record(path: Path) -> dict[str, Any]:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)}


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        character in "0123456789abcdef" for character in value
    )


if __name__ == "__main__":
    main()
