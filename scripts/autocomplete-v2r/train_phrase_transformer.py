#!/usr/bin/env python3
"""Deterministic CPU trainer for public-phrase-transformer-v1.

The script consumes only hash-verified V2R JSONL produced by the TypeScript
pipeline. It never reads the legacy corpus or public v4 assets and never writes
production assets. A separate publisher may consume a candidate only after all
blind quality and runtime gates pass.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset

CONTEXT_LENGTH = 192
CONTEXT_PATCH_BYTES = 4
PATCHED_CONTEXT_LENGTH = CONTEXT_LENGTH // CONTEXT_PATCH_BYTES
FEATURE_COUNT = 9
MAX_ACCEPTABLE_LABELS = 32
ABSTAIN_CLASS_WEIGHT = 1.0
ARCHITECTURE_RELEASE_BLOCKED = True
SCHEMA = "jotluck.autocomplete.v2r-training-report.v1"
ARCHITECTURE_MATRIX = {(8192, 96, 2), (12288, 128, 2), (16384, 128, 3)}
SPLITS = ("train", "development", "internalSelection")


@dataclass(frozen=True)
class TrainingConfig:
    workspace_root: Path
    phrase_bank_size: int
    hidden_size: int
    layers: int
    seed: int
    epochs: int
    patience: int
    batch_size: int
    learning_rate: float
    threads: int
    max_train_samples: int | None
    max_eval_samples: int | None
    output_dir: Path


class SampleDataset(Dataset[tuple[Tensor, Tensor, Tensor, Tensor, Tensor, Tensor]]):
    def __init__(
        self,
        tokens: np.ndarray,
        features: np.ndarray,
        labels: np.ndarray,
        acceptable_labels: np.ndarray,
        languages: np.ndarray,
        abstain: np.ndarray,
    ) -> None:
        self.tokens = tokens
        self.features = features
        self.labels = labels
        self.acceptable_labels = acceptable_labels
        self.languages = languages
        self.abstain = abstain

    def __len__(self) -> int:
        return int(self.labels.shape[0])

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor, Tensor, Tensor, Tensor, Tensor]:
        return (
            torch.from_numpy(self.tokens[index].astype(np.int64, copy=False)),
            torch.from_numpy(self.features[index]),
            torch.tensor(int(self.labels[index]), dtype=torch.long),
            torch.from_numpy(self.acceptable_labels[index].astype(np.int64, copy=False)),
            torch.tensor(int(self.languages[index]), dtype=torch.uint8),
            torch.tensor(bool(self.abstain[index]), dtype=torch.bool),
        )

class EncoderBlock(nn.Module):
    def __init__(self, hidden_size: int, heads: int = 4, dropout: float = 0.1) -> None:
        super().__init__()
        if hidden_size % heads != 0:
            raise ValueError("hidden_size must be divisible by heads")
        self.heads = heads
        self.head_dim = hidden_size // heads
        self.scale = self.head_dim**-0.5
        self.norm1 = nn.LayerNorm(hidden_size)
        self.qkv = nn.Linear(hidden_size, hidden_size * 3)
        self.attention_output = nn.Linear(hidden_size, hidden_size)
        self.norm2 = nn.LayerNorm(hidden_size)
        self.feed_forward = nn.Sequential(
            nn.Linear(hidden_size, hidden_size * 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size * 4, hidden_size),
        )
        self.dropout = nn.Dropout(dropout)

    def forward(self, value: Tensor, attention_mask: Tensor) -> Tensor:
        batch, length, hidden = value.shape
        normalized = self.norm1(value)
        qkv = self.qkv(normalized).reshape(batch, length, 3, self.heads, self.head_dim)
        query = qkv[:, :, 0].transpose(1, 2)
        key = qkv[:, :, 1].transpose(1, 2)
        projected_value = qkv[:, :, 2].transpose(1, 2)
        scores = torch.matmul(query, key.transpose(-2, -1)) * self.scale
        key_mask = attention_mask[:, None, None, :] <= 0
        scores = scores.masked_fill(key_mask, -10_000.0)
        weights = torch.softmax(scores, dim=-1)
        attended = torch.matmul(weights, projected_value)
        attended = attended.transpose(1, 2).reshape(batch, length, hidden)
        value = value + self.dropout(self.attention_output(attended))
        value = value + self.dropout(self.feed_forward(self.norm2(value)))
        return value


class PublicPhraseTransformer(nn.Module):
    def __init__(self, phrase_bank_size: int, hidden_size: int, layers: int) -> None:
        super().__init__()
        self.token_embedding = nn.Embedding(257, hidden_size, padding_idx=0)
        self.patch_projection = nn.Linear(hidden_size * CONTEXT_PATCH_BYTES, hidden_size)
        self.position_embedding = nn.Embedding(PATCHED_CONTEXT_LENGTH, hidden_size)
        self.feature_projection = nn.Linear(FEATURE_COUNT, hidden_size)
        self.blocks = nn.ModuleList([EncoderBlock(hidden_size) for _ in range(layers)])
        self.final_norm = nn.LayerNorm(hidden_size)
        self.classifier = nn.Linear(hidden_size, phrase_bank_size + 1)
        self.register_buffer("positions", torch.arange(PATCHED_CONTEXT_LENGTH), persistent=False)

    def forward(self, tokens: Tensor, attention_mask: Tensor, features: Tensor) -> Tensor:
        batch = tokens.shape[0]
        embedded = self.token_embedding(tokens).reshape(
            batch, PATCHED_CONTEXT_LENGTH, self.token_embedding.embedding_dim * CONTEXT_PATCH_BYTES
        )
        value = self.patch_projection(embedded) + self.position_embedding(self.positions)[None, :, :]
        patched_attention_mask = attention_mask.reshape(
            batch, PATCHED_CONTEXT_LENGTH, CONTEXT_PATCH_BYTES
        ).amax(dim=-1)
        for block in self.blocks:
            value = block(value, patched_attention_mask)
        pooled = self.final_norm(value[:, -1, :]) + self.feature_projection(features)
        return self.classifier(pooled)


def parse_arguments() -> TrainingConfig:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--phrase-bank-size", type=int, required=True)
    parser.add_argument("--hidden-size", type=int, required=True)
    parser.add_argument("--layers", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--threads", type=int, default=16)
    parser.add_argument("--max-train-samples", type=int)
    parser.add_argument("--max-eval-samples", type=int)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    signature = (args.phrase_bank_size, args.hidden_size, args.layers)
    if signature not in ARCHITECTURE_MATRIX:
        parser.error(f"architecture {signature} is outside the frozen matrix")
    if not 1 <= args.epochs <= 8:
        parser.error("epochs must be between 1 and 8")
    if not 0 <= args.patience <= 2:
        parser.error("patience must be between 0 and 2")
    if args.threads != 16:
        parser.error("formal V2R training requires exactly 16 CPU threads")
    return TrainingConfig(
        workspace_root=args.workspace_root.resolve(),
        phrase_bank_size=args.phrase_bank_size,
        hidden_size=args.hidden_size,
        layers=args.layers,
        seed=args.seed,
        epochs=args.epochs,
        patience=args.patience,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        threads=args.threads,
        max_train_samples=args.max_train_samples,
        max_eval_samples=args.max_eval_samples,
        output_dir=args.output_dir.resolve(),
    )


def configure_determinism(config: TrainingConfig) -> None:
    os.environ["OMP_NUM_THREADS"] = str(config.threads)
    os.environ["MKL_NUM_THREADS"] = str(config.threads)
    random.seed(config.seed)
    np.random.seed(config.seed)
    torch.manual_seed(config.seed)
    torch.set_num_threads(config.threads)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def repository_path(workspace_root: Path, relative: str) -> Path:
    if "\\" in relative or relative.startswith("/") or ".." in relative.split("/"):
        raise ValueError(f"unsafe repository path: {relative}")
    candidate = (workspace_root / Path(*relative.split("/"))).resolve()
    cache_root = (workspace_root / "scripts/corpus/_web-cache/autocomplete-v2r").resolve()
    if candidate != cache_root and cache_root not in candidate.parents:
        raise ValueError(f"training input escapes V2R cache: {relative}")
    return candidate


def load_training_report(config: TrainingConfig) -> dict[str, Any]:
    report_path = (
        config.workspace_root
        / "scripts/corpus/_web-cache/autocomplete-v2r/training"
        / str(config.phrase_bank_size)
        / "training-data-report.json"
    )
    with report_path.open("r", encoding="utf-8") as stream:
        report = json.load(stream)
    identity = dict(report)
    expected = identity.pop("reportSha256", None)
    if expected != canonical_sha256(identity):
        raise ValueError("training-data report identity is invalid")
    if (
        report.get("schema") != "jotluck.autocomplete.v2r-training-data.v3"
        or report.get("schemaVersion") != 3
    ):
        raise ValueError("training-data report schema is not the silence-safe v3 contract")
    if report.get("phraseBankSize") != config.phrase_bank_size:
        raise ValueError("phrase-bank size does not match training-data report")
    phrase_bank_path = report_path.parent / "phrase-bank.jsonl"
    if sha256_file(phrase_bank_path) != report.get("phraseBankSha256"):
        raise ValueError("phrase-bank SHA-256 does not match training-data report")
    for split in SPLITS:
        binding = report["samples"][split]
        abstain_reasons = binding.get("abstainReasons", {})
        if (
            abstain_reasons.get("bankMiss") != 0
            or abstain_reasons.get("documentEnd") != binding.get("abstain")
        ):
            raise ValueError(f"{split} contains non-silence abstain labels")
        sample_path = repository_path(config.workspace_root, binding["path"])
        if sha256_file(sample_path) != binding["sha256"]:
            raise ValueError(f"{split} sample SHA-256 does not match training-data report")
    return report


def load_samples(
    config: TrainingConfig,
    report: dict[str, Any],
    split: str,
) -> SampleDataset:
    binding = report["samples"][split]
    expected = int(binding["total"])
    limit = config.max_train_samples if split == "train" else config.max_eval_samples
    count = min(expected, limit) if limit is not None else expected
    tokens = np.zeros((count, CONTEXT_LENGTH), dtype=np.uint16)
    features = np.zeros((count, FEATURE_COUNT), dtype=np.float32)
    labels = np.zeros(count, dtype=np.int32)
    acceptable_labels = np.full(
        (count, MAX_ACCEPTABLE_LABELS), -1, dtype=np.int32
    )
    languages = np.zeros(count, dtype=np.uint8)
    abstain = np.zeros(count, dtype=np.bool_)
    path = repository_path(config.workspace_root, binding["path"])
    loaded = 0
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            if loaded >= count:
                break
            value = json.loads(line)
            context = base64.b64decode(value["contextUtf8Base64"], validate=True)
            if len(context) > CONTEXT_LENGTH:
                raise ValueError(f"sample {value['sampleId']} exceeds the context budget")
            offset = CONTEXT_LENGTH - len(context)
            if context:
                tokens[loaded, offset:] = np.frombuffer(context, dtype=np.uint8).astype(np.uint16) + 1
            features[loaded] = feature_vector(
                value["language"], value["blockType"], value["cursorBoundary"]
            )
            label = int(value["label"])
            if not 0 <= label <= config.phrase_bank_size:
                raise ValueError(f"sample {value['sampleId']} has an invalid label")
            legal_labels = value.get("acceptableLabels")
            if (
                not isinstance(legal_labels, list)
                or not 1 <= len(legal_labels) <= MAX_ACCEPTABLE_LABELS
                or len(set(legal_labels)) != len(legal_labels)
                or any(
                    not isinstance(item, int)
                    or not 0 <= item <= config.phrase_bank_size
                    for item in legal_labels
                )
                or label not in legal_labels
            ):
                raise ValueError(
                    f"sample {value['sampleId']} has invalid acceptable labels"
                )
            expected_abstain = bool(value["abstain"])
            if expected_abstain != (label == config.phrase_bank_size):
                raise ValueError(f"sample {value['sampleId']} has an inconsistent abstain label")
            if expected_abstain and legal_labels != [config.phrase_bank_size]:
                raise ValueError(
                    f"sample {value['sampleId']} has an invalid abstain target set"
                )
            if not expected_abstain and config.phrase_bank_size in legal_labels:
                raise ValueError(
                    f"sample {value['sampleId']} mixes phrase and abstain targets"
                )
            labels[loaded] = label
            acceptable_labels[loaded, : len(legal_labels)] = legal_labels
            languages[loaded] = 0 if value["language"] == "zh" else 1
            abstain[loaded] = expected_abstain
            loaded += 1
    if loaded != count:
        raise ValueError(f"{split} expected {count} samples but loaded {loaded}")
    return SampleDataset(
        tokens, features, labels, acceptable_labels, languages, abstain
    )


def feature_vector(language: str, block: str, boundary: str) -> np.ndarray:
    output = np.zeros(FEATURE_COUNT, dtype=np.float32)
    output[0 if language == "zh" else 1] = 1
    output[{"paragraph": 2, "list": 3, "quote": 4}[block]] = 1
    output[{"word": 5, "space": 6, "punctuation": 7, "other": 8}[boundary]] = 1
    return output


def loader(
    dataset: SampleDataset,
    config: TrainingConfig,
    shuffle: bool,
    epoch: int = 0,
) -> DataLoader[tuple[Tensor, Tensor, Tensor, Tensor, Tensor, Tensor]]:
    generator = torch.Generator().manual_seed(config.seed + epoch)
    return DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=shuffle,
        num_workers=0,
        generator=generator,
        drop_last=False,
    )


def class_weights(dataset: SampleDataset, class_count: int, abstain_index: int) -> Tensor:
    counts = np.bincount(dataset.labels, minlength=class_count).astype(np.float64)
    positive = counts[counts > 0]
    median = float(np.median(positive)) if positive.size else 1.0
    weights = np.ones(class_count, dtype=np.float32)
    present = counts > 0
    weights[present] = np.sqrt(median / counts[present]).clip(0.25, 4.0).astype(np.float32)
    # Generic inverse-frequency balancing treated abstain as an unimportant
    # majority label and forced its weight down to 0.25. That directly trains
    # false triggers. Abstention is a safety class, so keep neutral weight.
    weights[abstain_index] = ABSTAIN_CLASS_WEIGHT
    return torch.from_numpy(weights)


def train_model(
    model: PublicPhraseTransformer,
    train: SampleDataset,
    development: SampleDataset,
    config: TrainingConfig,
) -> tuple[dict[str, Tensor], list[dict[str, float]]]:
    weights = class_weights(train, config.phrase_bank_size + 1, config.phrase_bank_size)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=config.learning_rate, weight_decay=0.01
    )
    history: list[dict[str, float]] = []
    best_loss = math.inf
    best_state: dict[str, Tensor] | None = None
    stale_epochs = 0
    for epoch in range(config.epochs):
        model.train()
        total_loss = 0.0
        seen = 0
        started = time.perf_counter()
        for tokens, features, labels, acceptable_labels, _, _ in loader(
            train, config, shuffle=True, epoch=epoch
        ):
            attention_mask = (tokens != 0).to(torch.float32)
            optimizer.zero_grad(set_to_none=True)
            logits = model(tokens, attention_mask, features)
            loss = multi_target_cross_entropy(
                logits, labels, acceptable_labels, weights
            )
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += float(loss.detach()) * labels.shape[0]
            seen += labels.shape[0]
        validation = evaluate_loss(model, development, weights, config)
        duration_seconds = time.perf_counter() - started
        record = {
            "epoch": epoch + 1,
            "trainLoss": total_loss / max(1, seen),
            "developmentLoss": validation,
        }
        history.append(record)
        print(
            json.dumps({**record, "durationSeconds": duration_seconds}, sort_keys=True),
            flush=True,
        )
        if validation < best_loss - 1e-5:
            best_loss = validation
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs > config.patience:
                break
    if best_state is None:
        raise RuntimeError("training did not produce a checkpoint")
    model.load_state_dict(best_state)
    return best_state, history


@torch.inference_mode()
def evaluate_loss(
    model: PublicPhraseTransformer,
    dataset: SampleDataset,
    weights: Tensor,
    config: TrainingConfig,
) -> float:
    model.eval()
    total = 0.0
    seen = 0
    for tokens, features, labels, acceptable_labels, _, _ in loader(
        dataset, config, shuffle=False
    ):
        logits = model(tokens, (tokens != 0).to(torch.float32), features)
        loss = multi_target_cross_entropy(logits, labels, acceptable_labels, weights)
        total += float(loss) * labels.shape[0]
        seen += labels.shape[0]
    return total / max(1, seen)


def multi_target_cross_entropy(
    logits: Tensor,
    primary_labels: Tensor,
    acceptable_labels: Tensor,
    class_weight: Tensor,
) -> Tensor:
    """Maximizes probability mass over every legal phrase prefix at a cursor."""
    valid = acceptable_labels >= 0
    safe_labels = acceptable_labels.clamp_min(0)
    selected = torch.gather(
        torch.log_softmax(logits, dim=-1), 1, safe_labels
    ).masked_fill(~valid, float("-inf"))
    per_sample = -torch.logsumexp(selected, dim=1)
    weights = class_weight[primary_labels]
    return (per_sample * weights).sum() / weights.sum().clamp_min(1e-12)


@dataclass
class Predictions:
    labels: np.ndarray
    languages: np.ndarray
    expected_abstain: np.ndarray
    top1: np.ndarray
    top_score: np.ndarray
    margin_over_abstain: np.ndarray
    usable_top1: np.ndarray
    oracle32: np.ndarray


@torch.inference_mode()
def predict_torch(
    model: PublicPhraseTransformer,
    dataset: SampleDataset,
    config: TrainingConfig,
) -> Predictions:
    model.eval()
    values: dict[str, list[np.ndarray]] = {
        name: []
        for name in (
            "labels",
            "languages",
            "expected_abstain",
            "top1",
            "top_score",
            "margin_over_abstain",
            "usable_top1",
            "oracle32",
        )
    }
    for tokens, features, labels, acceptable_labels, languages, expected_abstain in loader(
        dataset, config, shuffle=False
    ):
        logits = model(tokens, (tokens != 0).to(torch.float32), features)
        probabilities = torch.softmax(logits, dim=-1)
        top_scores, top_indices = torch.topk(probabilities, k=32, dim=-1)
        top1 = top_indices[:, 0]
        raw_top = torch.gather(logits, 1, top1[:, None]).squeeze(1)
        margin = raw_top - logits[:, config.phrase_bank_size]
        usable_top1 = (top1[:, None] == acceptable_labels).any(dim=1) & ~expected_abstain
        oracle = (
            top_indices[:, :, None] == acceptable_labels[:, None, :]
        ).any(dim=2).any(dim=1) & ~expected_abstain
        append_prediction(values, "labels", labels)
        append_prediction(values, "languages", languages)
        append_prediction(values, "expected_abstain", expected_abstain)
        append_prediction(values, "top1", top1)
        append_prediction(values, "top_score", top_scores[:, 0])
        append_prediction(values, "margin_over_abstain", margin)
        append_prediction(values, "usable_top1", usable_top1)
        append_prediction(values, "oracle32", oracle)
    return Predictions(**{key: np.concatenate(value) for key, value in values.items()})


def append_prediction(values: dict[str, list[np.ndarray]], key: str, value: Tensor) -> None:
    values[key].append(value.detach().cpu().numpy())


def calibrate_thresholds(predictions: Predictions, abstain_index: int) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for language, code in (("zh", 0), ("en", 1)):
        mask = predictions.languages == code
        scores = predictions.top_score[mask]
        top1 = predictions.top1[mask]
        usable_top1 = predictions.usable_top1[mask]
        expected_abstain = predictions.expected_abstain[mask]
        margins = predictions.margin_over_abstain[mask]
        candidates = np.unique(np.quantile(scores, np.linspace(0.0, 1.0, 401)))
        best: tuple[tuple[float, float, float], dict[str, float]] | None = None
        for threshold in candidates:
            triggered = (top1 != abstain_index) & (scores >= threshold) & (margins >= 0)
            usable = triggered & usable_top1
            false = triggered & expected_abstain
            trigger_rate = float(triggered.mean())
            usable_rate = float(usable.mean())
            false_rate = float(false.sum() / max(1, expected_abstain.sum()))
            valid = 0.60 <= trigger_rate <= 0.65 and false_rate <= 0.03
            score = (1.0 if valid else 0.0, usable_rate, -abs(trigger_rate - 0.625))
            metrics = {
                "threshold": float(threshold),
                "triggerRate": trigger_rate,
                "usableRate": usable_rate,
                "conditionalPrecision": float(usable.sum() / max(1, triggered.sum())),
                "falseTriggerRate": false_rate,
                "eligible": valid and usable_rate >= 0.55,
            }
            if best is None or score > best[0]:
                best = (score, metrics)
        if best is None:
            raise RuntimeError(f"no threshold candidates for {language}")
        output[language] = best[1]
    return output


def metrics(predictions: Predictions, thresholds: dict[str, Any], abstain_index: int) -> dict[str, Any]:
    slices: dict[str, Any] = {}
    masks = {
        "overall": np.ones(predictions.labels.shape[0], dtype=np.bool_),
        "zh": predictions.languages == 0,
        "en": predictions.languages == 1,
    }
    for name, mask in masks.items():
        per_sample_threshold = np.where(
            predictions.languages[mask] == 0,
            thresholds["zh"]["threshold"],
            thresholds["en"]["threshold"],
        )
        triggered = (
            (predictions.top1[mask] != abstain_index)
            & (predictions.top_score[mask] >= per_sample_threshold)
            & (predictions.margin_over_abstain[mask] >= 0)
        )
        expected_abstain = predictions.expected_abstain[mask]
        usable_top1 = predictions.usable_top1[mask]
        usable = triggered & usable_top1
        false = triggered & expected_abstain
        oracle = predictions.oracle32[mask]
        slices[name] = {
            "opportunities": int(mask.sum()),
            "triggerRate": float(triggered.mean()),
            "usableRate": float(usable.mean()),
            "conditionalPrecision": float(usable.sum() / max(1, triggered.sum())),
            "falseTriggerRate": float(false.sum() / max(1, expected_abstain.sum())),
            "top1Rate": float(usable_top1.mean()),
            "oracleAt32AbsoluteRate": float(oracle.mean()),
            "oracleAt32PositiveRecall": float(oracle.sum() / max(1, (~expected_abstain).sum())),
        }
    slices["candidateCapabilityPassed"] = bool(
        slices["overall"]["oracleAt32AbsoluteRate"] >= 0.70
        and slices["zh"]["oracleAt32AbsoluteRate"] >= 0.65
        and slices["en"]["oracleAt32AbsoluteRate"] >= 0.65
    )
    slices["conditionalOnRepresentablePositiveSamples"] = True
    return slices


def passes_internal_quality_gate(values: dict[str, Any]) -> bool:
    overall = values["overall"]
    return bool(
        0.60 <= overall["triggerRate"] <= 0.65
        and overall["usableRate"] >= 0.60
        and overall["falseTriggerRate"] <= 0.03
        and values["zh"]["usableRate"] >= 0.55
        and values["en"]["usableRate"] >= 0.55
    )


def export_onnx(
    model: PublicPhraseTransformer, config: TrainingConfig, output_path: Path
) -> None:
    model.eval()
    tokens = torch.ones((1, CONTEXT_LENGTH), dtype=torch.long)
    attention_mask = torch.ones((1, CONTEXT_LENGTH), dtype=torch.float32)
    features = torch.zeros((1, FEATURE_COUNT), dtype=torch.float32)
    torch.onnx.export(
        model,
        (tokens, attention_mask, features),
        output_path,
        input_names=["tokens", "attention_mask", "features"],
        output_names=["logits"],
        dynamic_axes={
            "tokens": {0: "batch"},
            "attention_mask": {0: "batch"},
            "features": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(output_path))


def quantize_model(fp32_path: Path, int8_path: Path) -> None:
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        per_channel=True,
        reduce_range=False,
        weight_type=QuantType.QInt8,
        extra_options={"MatMulConstBOnly": True},
    )
    onnx.checker.check_model(onnx.load(int8_path))


def write_reduced_operator_config(model_path: Path, output_path: Path) -> None:
    model = onnx.load(model_path)
    opsets = {
        (item.domain or "ai.onnx"): int(item.version) for item in model.opset_import
    }
    operators: dict[str, set[str]] = {}

    def visit_graph(graph: onnx.GraphProto) -> None:
        for node in graph.node:
            domain = node.domain or "ai.onnx"
            operators.setdefault(domain, set()).add(node.op_type)
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.GRAPH:
                    visit_graph(attribute.g)
                elif attribute.type == onnx.AttributeProto.GRAPHS:
                    for nested in attribute.graphs:
                        visit_graph(nested)

    visit_graph(model.graph)
    lines: list[str] = []
    for domain in sorted(operators):
        version = opsets.get(domain)
        if version is None:
            raise ValueError(f"operator domain {domain} has no opset import")
        lines.append(f"{domain};{version};{','.join(sorted(operators[domain]))}")
    if not lines:
        raise ValueError("quantized model has no operators")
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def predict_onnx(
    model_path: Path,
    dataset: SampleDataset,
    config: TrainingConfig,
) -> Predictions:
    session = ort.InferenceSession(
        str(model_path),
        providers=["CPUExecutionProvider"],
        sess_options=ort_session_options(config.threads),
    )
    values: dict[str, list[np.ndarray]] = {
        name: []
        for name in (
            "labels",
            "languages",
            "expected_abstain",
            "top1",
            "top_score",
            "margin_over_abstain",
            "usable_top1",
            "oracle32",
        )
    }
    for start in range(0, len(dataset), config.batch_size):
        end = min(len(dataset), start + config.batch_size)
        tokens = dataset.tokens[start:end].astype(np.int64)
        features = dataset.features[start:end]
        logits = session.run(
            ["logits"],
            {
                "tokens": tokens,
                "attention_mask": (tokens != 0).astype(np.float32),
                "features": features,
            },
        )[0]
        probabilities = softmax(logits)
        top32 = np.argpartition(-probabilities, kth=31, axis=1)[:, :32]
        top32_scores = np.take_along_axis(probabilities, top32, axis=1)
        order = np.argsort(-top32_scores, axis=1)
        top32 = np.take_along_axis(top32, order, axis=1)
        top1 = top32[:, 0]
        row = np.arange(end - start)
        raw_top = logits[row, top1]
        labels = dataset.labels[start:end]
        acceptable_labels = dataset.acceptable_labels[start:end]
        expected_abstain = dataset.abstain[start:end]
        values["labels"].append(labels)
        values["languages"].append(dataset.languages[start:end])
        values["expected_abstain"].append(expected_abstain)
        values["top1"].append(top1)
        values["top_score"].append(probabilities[row, top1])
        values["margin_over_abstain"].append(raw_top - logits[:, config.phrase_bank_size])
        values["usable_top1"].append(
            (top1[:, None] == acceptable_labels).any(axis=1) & ~expected_abstain
        )
        values["oracle32"].append(
            (top32[:, :, None] == acceptable_labels[:, None, :])
            .any(axis=2)
            .any(axis=1)
            & ~expected_abstain
        )
    return Predictions(**{key: np.concatenate(value) for key, value in values.items()})


def ort_session_options(threads: int) -> ort.SessionOptions:
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return options


def softmax(value: np.ndarray) -> np.ndarray:
    shifted = value - value.max(axis=1, keepdims=True)
    exponent = np.exp(shifted)
    return exponent / exponent.sum(axis=1, keepdims=True)


def quantization_delta(fp32: Predictions, int8: Predictions) -> dict[str, float]:
    return {
        "top1Agreement": float((fp32.top1 == int8.top1).mean()),
        "oracleAt32Agreement": float((fp32.oracle32 == int8.oracle32).mean()),
        "maximumTopScoreDelta": float(np.max(np.abs(fp32.top_score - int8.top_score))),
    }


def runtime_metadata(config: TrainingConfig, thresholds: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": "jotluck.autocomplete.public-runtime-metadata.v1",
        "schemaVersion": 1,
        "runtime": {
            "package": "onnxruntime-web",
            "version": "1.27.0",
            "executionProvider": "wasm",
        },
        "inputNames": {
            "tokens": "tokens",
            "attentionMask": "attention_mask",
            "features": "features",
        },
        "outputName": "logits",
        "abstainIndex": config.phrase_bank_size,
        "thresholds": {
            "zh": thresholds["zh"]["threshold"],
            "en": thresholds["en"]["threshold"],
        },
        "abstainMargin": 0,
        "byteTokenizer": {
            "paddingId": 0,
            "byteOffset": 1,
            "sequenceLength": CONTEXT_LENGTH,
            "patchBytes": CONTEXT_PATCH_BYTES,
            "alignment": "right",
        },
        "featureOrder": [
            "language.zh",
            "language.en",
            "block.paragraph",
            "block.list",
            "block.quote",
            "boundary.word",
            "boundary.space",
            "boundary.punctuation",
            "boundary.other",
        ],
    }


def main() -> int:
    config = parse_arguments()
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError(f"V2R requires Python 3.12, found {sys.version.split()[0]}")
    configure_determinism(config)
    config.output_dir.mkdir(parents=True, exist_ok=True)
    report = load_training_report(config)
    train = load_samples(config, report, "train")
    development = load_samples(config, report, "development")
    internal = load_samples(config, report, "internalSelection")
    model = PublicPhraseTransformer(config.phrase_bank_size, config.hidden_size, config.layers)
    parameter_count = sum(parameter.numel() for parameter in model.parameters())
    _, history = train_model(model, train, development, config)

    development_fp32 = predict_torch(model, development, config)
    thresholds = calibrate_thresholds(development_fp32, config.phrase_bank_size)
    development_metrics = metrics(development_fp32, thresholds, config.phrase_bank_size)

    fp32_path = config.output_dir / "model.fp32.onnx"
    int8_path = config.output_dir / "model.int8.onnx"
    export_onnx(model, config, fp32_path)
    quantize_model(fp32_path, int8_path)
    operator_config_path = config.output_dir / "required-operators.config"
    write_reduced_operator_config(int8_path, operator_config_path)
    development_int8 = predict_onnx(int8_path, development, config)
    internal_int8 = predict_onnx(int8_path, internal, config)
    int8_development_metrics = metrics(
        development_int8, thresholds, config.phrase_bank_size
    )
    internal_metrics = metrics(internal_int8, thresholds, config.phrase_bank_size)
    delta = quantization_delta(development_fp32, development_int8)

    metadata = runtime_metadata(config, thresholds)
    metadata_path = config.output_dir / "runtime-metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    phrase_bank_path = (
        config.workspace_root
        / "scripts/corpus/_web-cache/autocomplete-v2r/training"
        / str(config.phrase_bank_size)
        / "phrase-bank.jsonl"
    )
    model_data_bytes = (
        int8_path.stat().st_size + phrase_bank_path.stat().st_size + metadata_path.stat().st_size
    )
    quantization_passed = bool(
        delta["top1Agreement"] >= 0.98
        and delta["oracleAt32Agreement"] >= 0.99
        and model_data_bytes <= 6 * 1024 * 1024
    )
    quantization_report = {
        "schema": "jotluck.autocomplete.v2r-quantization-report.v1",
        "schemaVersion": 1,
        "modelSha256": sha256_file(int8_path),
        "phraseBankSha256": sha256_file(phrase_bank_path),
        **delta,
        "modelDataBytes": model_data_bytes,
        "passed": quantization_passed,
    }
    quantization_report_path = config.output_dir / "quantization-report.json"
    quantization_report_path.write_text(
        json.dumps(quantization_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    conditional_ranking_oracle_passed = bool(
        internal_metrics["candidateCapabilityPassed"]
    )
    # Training-data JSONL intentionally excludes bank misses from the loss.
    # Its Oracle is therefore conditional on an answer already existing in the
    # fixed bank and cannot prove open-writing candidate capability.
    candidate_capability_passed = bool(
        conditional_ranking_oracle_passed and not ARCHITECTURE_RELEASE_BLOCKED
    )
    threshold_calibration_passed = bool(
        thresholds["zh"]["eligible"] and thresholds["en"]["eligible"]
    )
    internal_quality_gate_passed = passes_internal_quality_gate(internal_metrics)
    output_without_hash = {
        "schema": SCHEMA,
        "schemaVersion": 1,
        "engine": "public-phrase-transformer-v1",
        "architecture": {
            "phraseBankSize": config.phrase_bank_size,
            "hiddenSize": config.hidden_size,
            "layers": config.layers,
            "attentionHeads": 4,
            "contextUtf8Bytes": CONTEXT_LENGTH,
            "contextPatchBytes": CONTEXT_PATCH_BYTES,
            "parameterCount": parameter_count,
        },
        "seed": config.seed,
        "toolchain": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "numpy": np.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "cpuThreads": config.threads,
        },
        "boundedRun": {
            "epochsRequested": config.epochs,
            "epochsCompleted": len(history),
            "patience": config.patience,
            "batchSize": config.batch_size,
            "learningRate": config.learning_rate,
            "maxTrainSamples": config.max_train_samples,
            "maxEvalSamples": config.max_eval_samples,
        },
        "trainingDataReportSha256": report["reportSha256"],
        "labelSemantics": {
            "kind": "multi-target-complete-prefix-v1",
            "maximumAcceptableLabels": MAX_ACCEPTABLE_LABELS,
            "abstainClassWeight": ABSTAIN_CLASS_WEIGHT,
            "abstainReasonPolicy": "document-end-only-v1",
            "bankMissIsCoverageOnly": True,
        },
        "history": history,
        "calibration": thresholds,
        "developmentFp32": development_metrics,
        "developmentInt8": int8_development_metrics,
        "internalSelectionInt8": internal_metrics,
        "quantizationDelta": delta,
        "quantizationReport": {
            "path": quantization_report_path.name,
            "sha256": sha256_file(quantization_report_path),
        },
        "assets": {
            "fp32": {"path": fp32_path.name, "bytes": fp32_path.stat().st_size, "sha256": sha256_file(fp32_path)},
            "int8": {"path": int8_path.name, "bytes": int8_path.stat().st_size, "sha256": sha256_file(int8_path)},
            "phraseBank": {"path": phrase_bank_path.relative_to(config.workspace_root).as_posix(), "bytes": phrase_bank_path.stat().st_size, "sha256": sha256_file(phrase_bank_path)},
            "metadata": {"path": metadata_path.name, "bytes": metadata_path.stat().st_size, "sha256": sha256_file(metadata_path)},
            "operatorConfig": {"path": operator_config_path.name, "bytes": operator_config_path.stat().st_size, "sha256": sha256_file(operator_config_path)},
            "modelDataBytes": model_data_bytes,
        },
        "quantizationPassed": quantization_passed,
        "candidateCapabilityPassed": candidate_capability_passed,
        "conditionalRankingOraclePassed": conditional_ranking_oracle_passed,
        "architectureReleaseBlocked": ARCHITECTURE_RELEASE_BLOCKED,
        "thresholdCalibrationPassed": threshold_calibration_passed,
        "internalQualityGatePassed": internal_quality_gate_passed,
        "candidateEligible": (
            quantization_passed
            and candidate_capability_passed
            and threshold_calibration_passed
            and internal_quality_gate_passed
        ),
        "releaseEligible": False,
        "releaseBlockedReasons": [
            reason
            for condition, reason in (
                (not quantization_passed, "quantization-or-size-gate-failed"),
                (not candidate_capability_passed, "oracle-at-32-gate-failed"),
                (ARCHITECTURE_RELEASE_BLOCKED, "fixed-phrase-architecture-stopped"),
                (not threshold_calibration_passed, "development-calibration-gate-failed"),
                (not internal_quality_gate_passed, "internal-selection-quality-gate-failed"),
                (True, "independent-v3-holdouts-not-evaluated"),
                (True, "custom-ort-wasm-static-budget-not-satisfied"),
            )
            if condition
        ],
    }
    output = {
        **output_without_hash,
        "trainerCanonicalSha256": canonical_sha256(output_without_hash),
    }
    report_path = config.output_dir / "training-report.json"
    report_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"report": str(report_path), "candidateEligible": output["candidateEligible"]}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # fail closed with a useful single-line CI tail
        print(f"V2R training failed: {error}", file=sys.stderr)
        raise
