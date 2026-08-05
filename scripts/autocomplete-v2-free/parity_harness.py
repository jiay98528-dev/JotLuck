#!/usr/bin/env python3
"""Numerical parity harness for trained JotLuck V2 free candidates.

This tool never reads holdouts and never installs an asset. It compares one
float checkpoint with its JLFDQ02 export and the hidden Rust evaluation path.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

MODEL_MAGIC = b"JLFDQ02\0"
MODEL_SCHEMA = "jotluck.autocomplete.quantized-decoder.v2"
FLOAT_SCHEMA = "jotluck.autocomplete.v2-free-float-model.v1"
MANIFEST_SCHEMA = "jotluck.autocomplete.public-free-decoder.v1"
PARITY_SCHEMA = "jotluck.autocomplete.decoder-parity.v1"
REPORT_SCHEMA = "jotluck.autocomplete.decoder-parity-report.v1"
ENGINE_ID = "public-v2-free-decoder-v1"
MAX_FRAME_BYTES = 128 * 1024
MATRIX_ARCHITECTURES = {
    "16m-q4": (384, 8, 4, 1_024),
    "24m-q4": (448, 9, 7, 1_280),
    "32m-q4": (512, 10, 8, 1_536),
}


@dataclass(frozen=True)
class QuantizedAsset:
    header: dict[str, Any]
    payload: bytes
    descriptors: dict[str, dict[str, Any]]

    def tensor(self, name: str) -> np.ndarray[Any, np.dtype[np.float32]]:
        descriptor = self.descriptors.get(name)
        if descriptor is None:
            raise ValueError(f"quantized tensor is missing: {name}")
        alias = descriptor.get("aliasOf")
        if alias is not None:
            if not isinstance(alias, str) or alias == name:
                raise ValueError(f"invalid tensor alias: {name}")
            return self.tensor(alias)
        shape = descriptor.get("shape")
        dtype = descriptor.get("dtype")
        if not isinstance(shape, list) or not shape or not all(
            isinstance(value, int) and value > 0 for value in shape
        ):
            raise ValueError(f"invalid tensor shape: {name}")
        elements = math.prod(shape)
        offset = bounded_integer(descriptor, "offset")
        length = bounded_integer(descriptor, "bytes")
        if dtype == "f16":
            if length != elements * 2:
                raise ValueError(f"invalid f16 tensor length: {name}")
            values = np.frombuffer(self.payload, dtype="<f2", count=elements, offset=offset)
        elif dtype in {"q4", "q8"}:
            values = self._dequantize(name, descriptor, elements, dtype)
        else:
            raise ValueError(f"unsupported tensor dtype: {name}")
        if values.size != elements:
            raise ValueError(f"incomplete tensor payload: {name}")
        return np.asarray(values, dtype=np.float32).reshape(shape).copy()

    def _dequantize(
        self, name: str, descriptor: Mapping[str, Any], elements: int, dtype: str
    ) -> np.ndarray[Any, np.dtype[np.float32]]:
        group_size = bounded_integer(descriptor, "groupSize")
        groups = bounded_integer(descriptor, "groups")
        scale_offset = bounded_integer(descriptor, "scaleOffset")
        scale_bytes = bounded_integer(descriptor, "scaleBytes")
        offset = bounded_integer(descriptor, "offset")
        length = bounded_integer(descriptor, "bytes")
        if group_size != 64 or groups != math.ceil(elements / 64) or scale_bytes != groups * 2:
            raise ValueError(f"invalid quantization groups: {name}")
        scales = np.frombuffer(
            self.payload, dtype="<f2", count=groups, offset=scale_offset
        ).astype(np.float32)
        if scales.size != groups or not np.all(np.isfinite(scales)) or np.any(scales <= 0):
            raise ValueError(f"invalid quantization scales: {name}")
        if dtype == "q4":
            if length != groups * 32:
                raise ValueError(f"invalid q4 tensor length: {name}")
            packed = np.frombuffer(self.payload, dtype=np.uint8, count=length, offset=offset)
            quantized = np.empty(length * 2, dtype=np.int8)
            quantized[0::2] = (packed & 0x0F).astype(np.int8) - 8
            quantized[1::2] = (packed >> 4).astype(np.int8) - 8
        else:
            if length != groups * 64:
                raise ValueError(f"invalid q8 tensor length: {name}")
            quantized = np.frombuffer(self.payload, dtype=np.int8, count=length, offset=offset)
        return quantized.astype(np.float32)[:elements] * np.repeat(scales, 64)[:elements]


def parse_quantized_asset(path: Path) -> QuantizedAsset:
    data = path.read_bytes()
    if len(data) < 12 or data[:8] != MODEL_MAGIC:
        raise ValueError("invalid JLFDQ02 magic")
    header_length = struct.unpack_from("<I", data, 8)[0]
    if header_length == 0 or header_length > 256 * 1024 or 12 + header_length > len(data):
        raise ValueError("invalid JLFDQ02 header length")
    header = json.loads(data[12 : 12 + header_length].decode("utf-8"))
    payload = data[12 + header_length :]
    if (
        header.get("schema") != MODEL_SCHEMA
        or header.get("engine") != ENGINE_ID
        or header.get("payloadSha256") != sha256_bytes(payload)
    ):
        raise ValueError("JLFDQ02 identity or payload hash mismatch")
    tensors = header.get("tensors")
    if not isinstance(tensors, list) or not tensors:
        raise ValueError("JLFDQ02 tensor table is empty")
    descriptors: dict[str, dict[str, Any]] = {}
    for item in tensors:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ValueError("JLFDQ02 tensor descriptor is invalid")
        if item["name"] in descriptors:
            raise ValueError("JLFDQ02 tensor name is duplicated")
        descriptors[item["name"]] = item
    return QuantizedAsset(header=header, payload=payload, descriptors=descriptors)


def bounded_integer(value: Mapping[str, Any], key: str) -> int:
    result = value.get(key)
    if not isinstance(result, int) or result < 0:
        raise ValueError(f"invalid tensor field: {key}")
    return result


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_asset(parent: Path, record: Mapping[str, Any]) -> Path:
    name = record.get("file")
    expected_bytes = record.get("bytes")
    expected_sha = record.get("sha256")
    if not isinstance(name, str) or Path(name).name != name or not isinstance(expected_bytes, int):
        raise ValueError("manifest asset descriptor is invalid")
    path = (parent / name).resolve()
    if path.parent != parent.resolve() or path.stat().st_size != expected_bytes:
        raise ValueError("manifest asset byte identity mismatch")
    if sha256_file(path) != expected_sha:
        raise ValueError("manifest asset hash mismatch")
    return path


def load_trained_inputs(manifest_path: Path, float_checkpoint: Path) -> tuple[dict[str, Any], Path, Path]:
    reject_protected_path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("schema") != MANIFEST_SCHEMA
        or manifest.get("engine") != ENGINE_ID
        or manifest.get("lifecycle") != "trained"
        or manifest.get("evaluationOnly") is not True
        or manifest.get("releaseEligible") is not False
    ):
        raise ValueError("parity requires a trained evaluation manifest")
    assets = manifest.get("assets")
    if not isinstance(assets, dict):
        raise ValueError("trained manifest assets are missing")
    parent = manifest_path.resolve().parent
    model_path = verify_asset(parent, assets.get("model", {}))
    tokenizer_path = verify_asset(parent, assets.get("tokenizer", {}))
    reject_protected_path(float_checkpoint)
    if not float_checkpoint.is_file():
        raise FileNotFoundError("float checkpoint is unavailable")
    return manifest, model_path, tokenizer_path


def reject_protected_path(path: Path) -> None:
    normalized = path.resolve().as_posix().lower()
    if "/final" in normalized or "/resources/autocomplete/" in normalized:
        raise ValueError("parity refuses final or production-public paths")


def import_torch() -> Any:
    try:
        import torch
        from torch import nn
    except ImportError as error:
        raise RuntimeError("locked parity dependency torch==2.8.0 is not installed") from error
    return torch, nn


def build_model(architecture: Mapping[str, Any], vocabulary_size: int, maximum_context: int) -> Any:
    torch, nn = import_torch()
    width = int(architecture["width"])
    layers = int(architecture["layers"])
    heads = int(architecture["heads"])
    feed_forward = int(architecture["feedForward"])
    epsilon = float(architecture["layerNormEpsilon"])

    class ParityModel(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.token_embedding = nn.Embedding(vocabulary_size, width, padding_idx=0)
            self.position_embedding = nn.Embedding(maximum_context, width)
            block = nn.TransformerEncoderLayer(
                d_model=width,
                nhead=heads,
                dim_feedforward=feed_forward,
                dropout=0.0,
                activation="gelu",
                layer_norm_eps=epsilon,
                batch_first=True,
                norm_first=True,
            )
            self.blocks = nn.TransformerEncoder(
                block, num_layers=layers, enable_nested_tensor=False
            )
            self.final_norm = nn.LayerNorm(width, eps=epsilon)
            self.output = nn.Linear(width, vocabulary_size, bias=False)
            self.output.weight = self.token_embedding.weight
            self.register_buffer(
                "positions", torch.arange(maximum_context), persistent=False
            )

    return ParityModel()


def load_float_model(
    path: Path,
    architecture: Mapping[str, Any],
    vocab: int,
    context: int,
    expected_export_candidate_id: str,
) -> Any:
    torch, _ = import_torch()
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("schema") != FLOAT_SCHEMA or checkpoint.get("engine") != ENGINE_ID:
        raise ValueError("float checkpoint identity is invalid")
    training_candidate_id = checkpoint.get("candidateId")
    if (
        not isinstance(training_candidate_id, str)
        or not expected_export_candidate_id.startswith(f"{training_candidate_id}.")
    ):
        raise ValueError("float checkpoint and trained manifest candidate identities disagree")
    expected = MATRIX_ARCHITECTURES.get(checkpoint.get("matrixId"))
    actual = tuple(
        int(architecture[key]) for key in ("width", "layers", "heads", "feedForward")
    )
    if expected is None or actual != expected:
        raise ValueError("float checkpoint and JLFDQ02 architectures disagree")
    model = build_model(architecture, vocab, context)
    model.load_state_dict(checkpoint["modelState"], strict=True)
    return model.eval()


def load_quantized_model(asset: QuantizedAsset) -> Any:
    torch, _ = import_torch()
    header = asset.header
    model = build_model(
        header["architecture"], header["vocabularySize"], header["maximumContextTokens"]
    )
    state = {name: torch.from_numpy(asset.tensor(name)) for name in model.state_dict()}
    model.load_state_dict(state, strict=True)
    return model.eval()


def torch_trace(model: Any, token_ids: Sequence[int]) -> dict[str, np.ndarray[Any, Any]]:
    torch, _ = import_torch()
    tokens = torch.tensor([list(token_ids)], dtype=torch.long)
    if tokens.shape[1] == 0 or tokens.shape[1] > model.position_embedding.num_embeddings:
        raise ValueError("token context length is invalid")
    with torch.no_grad():
        length = tokens.shape[1]
        hidden = model.token_embedding(tokens) + model.position_embedding(model.positions[:length])
        trace: dict[str, np.ndarray[Any, Any]] = {
            "embeddingLast": as_f32(hidden[0, -1])
        }
        causal_mask = torch.triu(torch.full((length, length), float("-inf")), diagonal=1)
        padding_mask = tokens.eq(0)
        for index, block in enumerate(model.blocks.layers):
            hidden = block(hidden, src_mask=causal_mask, src_key_padding_mask=padding_mask)
            trace[f"layer{index}Last"] = as_f32(hidden[0, -1])
        normalized = model.final_norm(hidden)
        trace["finalNormLast"] = as_f32(normalized[0, -1])
        trace["logits"] = as_f32(model.output(normalized)[0, -1])
    return trace


def as_f32(value: Any) -> np.ndarray[Any, np.dtype[np.float32]]:
    return np.asarray(value.detach().cpu().float().numpy(), dtype="<f4").copy()


def invoke_rust(binary: Path, manifest: Path, request: Mapping[str, Any]) -> dict[str, Any]:
    payload = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if not payload or len(payload) > MAX_FRAME_BYTES:
        raise ValueError("parity request exceeds the Rust frame budget")
    framed = struct.pack("<I", len(payload)) + payload
    environment = dict(os.environ)
    environment["JOTLUCK_AUTOCOMPLETE_EVALUATION"] = "1"
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = subprocess.run(
        [str(binary), "--jotluck-completion-parity", str(manifest)],
        input=framed,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
        check=False,
        env=environment,
        creationflags=creation_flags,
    )
    if len(process.stdout) < 4:
        raise RuntimeError(f"Rust parity returned no frame: {process.stderr.decode(errors='replace')}")
    length = struct.unpack_from("<I", process.stdout)[0]
    if length == 0 or length > MAX_FRAME_BYTES or len(process.stdout) != length + 4:
        raise RuntimeError("Rust parity returned an invalid length frame")
    response = json.loads(process.stdout[4:].decode("utf-8"))
    if response.get("error"):
        raise RuntimeError(f"Rust parity failed closed: {response['error']}")
    if process.returncode != 0 or response.get("schema") != PARITY_SCHEMA:
        raise RuntimeError("Rust parity response identity is invalid")
    return response


def decode_vector(record: Mapping[str, Any]) -> np.ndarray[Any, np.dtype[np.float32]]:
    raw = base64.b64decode(record["f32LeBase64"], validate=True)
    count = record.get("count")
    if not isinstance(count, int) or len(raw) != count * 4 or sha256_bytes(raw) != record.get("sha256"):
        raise ValueError("Rust parity vector identity mismatch")
    return np.frombuffer(raw, dtype="<f4").copy()


def vector_summary(values: np.ndarray[Any, Any]) -> dict[str, Any]:
    raw = np.asarray(values, dtype="<f4").tobytes()
    as64 = np.asarray(values, dtype=np.float64)
    return {
        "count": int(as64.size),
        "sha256F32Le": sha256_bytes(raw),
        "minimum": float(as64.min()),
        "maximum": float(as64.max()),
        "mean": float(as64.mean()),
        "l2": float(np.linalg.vector_norm(as64)),
    }


def error_metrics(reference: np.ndarray[Any, Any], candidate: np.ndarray[Any, Any]) -> dict[str, float]:
    if reference.shape != candidate.shape:
        raise ValueError("parity vector shapes disagree")
    difference = np.abs(reference.astype(np.float64) - candidate.astype(np.float64))
    denominator = np.maximum(np.abs(reference.astype(np.float64)), 1e-12)
    return {
        "maximumAbsolute": float(difference.max(initial=0.0)),
        "meanAbsolute": float(difference.mean()),
        "rootMeanSquare": float(np.sqrt(np.mean(np.square(difference)))),
        "maximumRelative": float(np.max(difference / denominator, initial=0.0)),
    }


def stable_top(values: np.ndarray[Any, Any], maximum: int = 32) -> list[int]:
    token_ids = np.arange(values.size, dtype=np.int64)
    return [int(value) for value in np.lexsort((token_ids, -values))[:maximum]]


def decode_single_token(tokenizer: Any, token_id: int) -> str:
    piece = tokenizer.pieces[token_id]
    if piece.type in {"control", "unused"}:
        return ""
    if piece.type == "unknown":
        return "�"
    if piece.type == "byte":
        return bytes([int(piece.piece[3:5], 16)]).decode("utf-8", errors="replace")
    return piece.piece.replace("▁", " ").lstrip()


def compare_traces(
    float_trace: Mapping[str, np.ndarray[Any, Any]],
    quantized_trace: Mapping[str, np.ndarray[Any, Any]],
    rust: Mapping[str, Any],
    tokenizer: Any,
    maximum_absolute: float,
    mean_absolute: float,
) -> tuple[dict[str, Any], bool]:
    rust_trace = {
        "embeddingLast": decode_vector(rust["embeddingLast"]),
        "finalNormLast": decode_vector(rust["finalNormLast"]),
        "logits": decode_vector(rust["logits"]),
    }
    for index, value in enumerate(rust["layerLast"]):
        rust_trace[f"layer{index}Last"] = decode_vector(value)
    if set(rust_trace) != set(quantized_trace):
        raise ValueError("Python and Rust trace stages disagree")
    layer_errors = {
        stage: error_metrics(quantized_trace[stage], rust_trace[stage])
        for stage in quantized_trace
        if stage != "logits"
    }
    final_error = error_metrics(quantized_trace["logits"], rust_trace["logits"])
    float_to_quantized = {
        stage: error_metrics(float_trace[stage], quantized_trace[stage])
        for stage in quantized_trace
    }
    python_top = stable_top(quantized_trace["logits"])
    rust_top = [int(item["tokenId"]) for item in rust["top32"]]
    rust_decoded = {int(item["tokenId"]): item["text"] for item in rust["decodedTop"]}
    decoded_matches = all(
        rust_decoded.get(token_id) == decode_single_token(tokenizer, token_id)
        for token_id in rust_top
    )
    top_order_equal = python_top == rust_top
    top_set_equal = set(python_top) == set(rust_top)
    passed = (
        final_error["maximumAbsolute"] <= maximum_absolute
        and final_error["meanAbsolute"] <= mean_absolute
        and top_order_equal
        and decoded_matches
    )
    return (
        {
            "floatToPythonQuantized": float_to_quantized,
            "pythonQuantizedToRust": {
                "stages": layer_errors,
                "finalLogits": final_error,
                "top32SetEqual": top_set_equal,
                "top32OrderEqual": top_order_equal,
                "pythonTop32": python_top,
                "rustTop32": rust_top,
                "decodedTokensEqual": decoded_matches,
                "thresholds": {
                    "maximumAbsolute": maximum_absolute,
                    "meanAbsolute": mean_absolute,
                },
            },
        },
        passed,
    )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--float-checkpoint", type=Path, required=True)
    parser.add_argument("--rust-binary", type=Path, required=True)
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--context")
    input_group.add_argument("--token-ids", help="comma-separated decimal token IDs")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--maximum-absolute-error", type=float, default=2e-3)
    parser.add_argument("--mean-absolute-error", type=float, default=2e-4)
    return parser.parse_args()


def recorded_command(arguments: Sequence[str]) -> tuple[list[str], bool]:
    result = list(arguments)
    redacted = False
    for index, value in enumerate(result[:-1]):
        if value == "--context":
            raw = result[index + 1].encode("utf-8")
            result[index + 1] = f"<redacted utf8Bytes={len(raw)} sha256={sha256_bytes(raw)}>"
            redacted = True
    return result, redacted


def main() -> int:
    args = parse_arguments()
    manifest_path = args.manifest.resolve()
    checkpoint_path = args.float_checkpoint.resolve()
    binary_path = args.rust_binary.resolve()
    report_path = args.report.resolve()
    reject_protected_path(report_path)
    manifest, model_path, tokenizer_path = load_trained_inputs(
        manifest_path, checkpoint_path
    )
    asset = parse_quantized_asset(model_path)
    if (
        asset.header.get("candidateId") != manifest.get("candidateId")
        or asset.header.get("quantization") != manifest.get("quantization")
    ):
        raise ValueError("manifest and JLFDQ02 candidate identities disagree")
    from tokenizer_runtime import UnigramRuntimeTokenizer

    tokenizer = UnigramRuntimeTokenizer.from_path(tokenizer_path)
    if args.context is not None:
        token_ids = tokenizer.encode(args.context, add_bos=True)[-256:]
        rust_request: dict[str, Any] = {
            "protocolVersion": 1,
            "requestId": 1,
            "context": args.context,
        }
    else:
        try:
            token_ids = [int(value) for value in args.token_ids.split(",")]
        except ValueError as error:
            raise ValueError("token IDs must be comma-separated decimal integers") from error
        rust_request = {
            "protocolVersion": 1,
            "requestId": 1,
            "tokenIds": token_ids,
        }
    if not token_ids or len(token_ids) > 256:
        raise ValueError("parity input must contain 1..256 tokens")
    float_model = load_float_model(
        checkpoint_path,
        asset.header["architecture"],
        int(asset.header["vocabularySize"]),
        int(asset.header["maximumContextTokens"]),
        str(manifest["candidateId"]),
    )
    quantized_model = load_quantized_model(asset)
    float_trace = torch_trace(float_model, token_ids)
    quantized_trace = torch_trace(quantized_model, token_ids)
    rust = invoke_rust(binary_path, manifest_path, rust_request)
    if rust.get("tokenIds") != token_ids:
        raise ValueError("Python and Rust tokenizer token IDs disagree")
    comparisons, passed = compare_traces(
        float_trace,
        quantized_trace,
        rust,
        tokenizer,
        args.maximum_absolute_error,
        args.mean_absolute_error,
    )
    command, command_redacted = recorded_command(sys.argv)
    report = {
        "schema": REPORT_SCHEMA,
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "evaluationOnly": True,
        "finalHoldoutsRead": False,
        "productionAssetsWritten": False,
        "candidateId": manifest["candidateId"],
        "quantization": asset.header["quantization"],
        "command": command,
        "commandRedacted": command_redacted,
        "files": {
            "manifest": {"path": str(manifest_path), "sha256": sha256_file(manifest_path)},
            "floatCheckpoint": {
                "path": str(checkpoint_path),
                "sha256": sha256_file(checkpoint_path),
            },
            "model": {"path": str(model_path), "sha256": sha256_file(model_path)},
            "tokenizer": {
                "path": str(tokenizer_path),
                "sha256": sha256_file(tokenizer_path),
            },
            "rustBinary": {"path": str(binary_path), "sha256": sha256_file(binary_path)},
        },
        "input": {"tokenIds": token_ids, "contextProvided": args.context is not None},
        "summaries": {
            "pythonFloat": {stage: vector_summary(value) for stage, value in float_trace.items()},
            "pythonQuantized": {
                stage: vector_summary(value) for stage, value in quantized_trace.items()
            },
            "rustQuantized": {
                "logits": vector_summary(decode_vector(rust["logits"])),
                "reportedLogitsSha256": rust["logits"]["sha256"],
            },
        },
        "comparisons": comparisons,
        "passed": passed,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=report_path.parent, delete=False
    ) as output:
        json.dump(report, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
        temporary = Path(output.name)
    os.replace(temporary, report_path)
    print(json.dumps({"report": str(report_path), "passed": passed}, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"parity harness failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
