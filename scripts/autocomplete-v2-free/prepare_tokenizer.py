#!/usr/bin/env python3
"""Freeze the one tokenizer shared by every V2.2 formal matrix candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import train_decoder as trainer

TOKENIZER_BUNDLE_SCHEMA = "jotluck.autocomplete.v2-free-tokenizer-bundle.v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--selection-stage-receipt", type=Path, required=True)
    parser.add_argument("--fingerprint-audit", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260805)
    return parser.parse_args()


def build_bundle(
    workspace_root: Path,
    selection_path: Path,
    selection_stage_receipt_path: Path,
    fingerprint_audit_path: Path,
    output_dir: Path,
    seed: int,
) -> dict[str, Any]:
    root = workspace_root.resolve()
    selection = trainer.resolve_inside(root, selection_path)
    output = output_dir.resolve()
    allowed = (root / "scripts/corpus/_web-cache/autocomplete-v2-free/tokenizers").resolve()
    if output == allowed or allowed not in output.parents:
        raise ValueError("output-dir must be a child of the isolated tokenizer root")
    if output.exists():
        raise FileExistsError("tokenizer output directory already exists")
    config = type(
        "SelectionConfig",
        (),
        {
            "workspace_root": root,
            "selection_path": selection,
            "selection_stage_receipt_path": trainer.resolve_inside(
                root, selection_stage_receipt_path
            ),
            "fingerprint_audit_path": trainer.resolve_inside(root, fingerprint_audit_path),
        },
    )()
    selection_value, train_paths, _ = trainer.load_selection(config)
    if selection_value["selectedBytes"] < trainer.FORMAL_MATRIX_MINIMUM_BYTES:
        raise ValueError("formal shared tokenizer requires a 128 MiB selection")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        model_path, runtime_path = trainer.train_tokenizer_assets(staging, train_paths)
        manifest: dict[str, Any] = {
            "schema": TOKENIZER_BUNDLE_SCHEMA,
            "schemaVersion": 1,
            "engine": trainer.ENGINE_ID,
            "seed": seed,
            "selectionSha256": trainer.sha256_file(selection),
            "inputTreeSha256": selection_value["inputTreeSha256"],
            "selectionStageReceiptSha256": trainer.sha256_file(
                config.selection_stage_receipt_path
            ),
            "fingerprintAuditSha256": trainer.sha256_file(config.fingerprint_audit_path),
            "trainDocuments": len(train_paths),
            "vocabularySize": trainer.VOCABULARY_SIZE,
            "byteFallback": True,
            "trainingRecipe": trainer.tokenizer_training_recipe(),
            "assets": {
                "model": trainer.asset_record(model_path),
                "runtime": trainer.asset_record(runtime_path),
            },
        }
        manifest["manifestSha256"] = hashlib.sha256(
            trainer.canonical_json(manifest).encode("utf-8")
        ).hexdigest()
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        staging.rename(output)
        return manifest
    except BaseException:
        import shutil

        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    args = parse_args()
    manifest = build_bundle(
        args.workspace_root,
        args.selection,
        args.selection_stage_receipt,
        args.fingerprint_audit,
        args.output_dir,
        args.seed,
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
