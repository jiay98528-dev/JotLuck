#!/usr/bin/env python3
"""Deterministic Unigram tokenizer runtime shared by training and Rust export.

The runtime format intentionally contains only the information needed for
encoding. It does not depend on SentencePiece's C++ runtime after export.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

RUNTIME_SCHEMA = "jotluck.autocomplete.unigram-runtime.v1"
WHITESPACE_MARKER = "▁"
EXPECTED_VOCABULARY_SIZE = 8_000


@dataclass(frozen=True)
class RuntimePiece:
    id: int
    piece: str
    score: float
    type: str


class UnigramRuntimeTokenizer:
    """Small deterministic Unigram Viterbi encoder with byte fallback."""

    def __init__(self, payload: dict[str, Any]) -> None:
        if payload.get("schema") != RUNTIME_SCHEMA:
            raise ValueError("unsupported tokenizer runtime schema")
        pieces_value = payload.get("pieces")
        vocabulary_size = payload.get("vocabularySize")
        special_ids = payload.get("specialIds")
        if (
            not isinstance(pieces_value, list)
            or not isinstance(vocabulary_size, int)
            or vocabulary_size != len(pieces_value)
            or not isinstance(special_ids, dict)
            or payload.get("normalization") != "nfkc"
            or payload.get("dummyPrefix") is not True
            or payload.get("collapseWhitespace") is not True
        ):
            raise ValueError("tokenizer runtime contract is invalid")

        pieces: list[RuntimePiece] = []
        for expected_id, item in enumerate(pieces_value):
            if not isinstance(item, dict):
                raise ValueError("tokenizer runtime piece is invalid")
            piece = RuntimePiece(
                id=item.get("id"),
                piece=item.get("piece"),
                score=item.get("score"),
                type=item.get("type"),
            )
            if (
                piece.id != expected_id
                or not isinstance(piece.piece, str)
                or not isinstance(piece.score, (int, float))
                or not math.isfinite(float(piece.score))
                or piece.type
                not in {"normal", "unknown", "control", "userDefined", "unused", "byte"}
            ):
                raise ValueError("tokenizer runtime piece fields are invalid")
            pieces.append(piece)

        self.pieces = tuple(pieces)
        self.pad_id = _special_id(special_ids, "pad", vocabulary_size, allow_missing=True)
        self.unk_id = _special_id(special_ids, "unk", vocabulary_size)
        self.bos_id = _special_id(special_ids, "bos", vocabulary_size, allow_missing=True)
        self.eos_id = _special_id(special_ids, "eos", vocabulary_size, allow_missing=True)
        self._trie: dict[str, Any] = {}
        self._byte_ids: dict[int, int] = {}
        for piece in self.pieces:
            if piece.type in {"normal", "userDefined"} and piece.piece:
                node = self._trie
                for character in piece.piece:
                    node = node.setdefault(character, {})
                node.setdefault("", []).append(piece.id)
            elif piece.type == "byte":
                byte_value = _parse_byte_piece(piece.piece)
                if byte_value in self._byte_ids:
                    raise ValueError("duplicate byte fallback piece")
                self._byte_ids[byte_value] = piece.id
        if self._byte_ids and set(self._byte_ids) != set(range(256)):
            raise ValueError("tokenizer runtime byte fallback table is incomplete")

    @classmethod
    def from_path(cls, path: Path) -> "UnigramRuntimeTokenizer":
        return cls(json.loads(path.read_text(encoding="utf-8")))

    def encode(self, text: str, *, add_bos: bool = False, add_eos: bool = False) -> list[int]:
        normalized = normalize_text(text)
        transformed = (
            f"{WHITESPACE_MARKER}{normalized.replace(' ', WHITESPACE_MARKER)}"
            if normalized
            else ""
        )
        encoded = self._encode_transformed(transformed)
        if add_bos and self.bos_id >= 0:
            encoded.insert(0, self.bos_id)
        if add_eos and self.eos_id >= 0:
            encoded.append(self.eos_id)
        return encoded

    def _encode_transformed(self, text: str) -> list[int]:
        if not text:
            return []
        length = len(text)
        best_scores = [-math.inf] * (length + 1)
        previous: list[tuple[int, tuple[int, ...]] | None] = [None] * (length + 1)
        tie_breakers: list[tuple[int, int, tuple[int, ...]] | None] = [None] * (length + 1)
        best_scores[0] = 0.0

        for start in range(length):
            if not math.isfinite(best_scores[start]):
                continue
            matched = False
            node = self._trie
            for end in range(start, length):
                child = node.get(text[end])
                if not isinstance(child, dict):
                    break
                node = child
                terminal_ids = node.get("")
                if isinstance(terminal_ids, list):
                    matched = True
                    for piece_id in terminal_ids:
                        self._relax(
                            start,
                            end + 1,
                            (piece_id,),
                            float(self.pieces[piece_id].score),
                            best_scores,
                            previous,
                            tie_breakers,
                        )
            if not matched:
                ids = self._fallback_ids(text[start])
                score = sum(float(self.pieces[piece_id].score) for piece_id in ids)
                self._relax(
                    start,
                    start + 1,
                    ids,
                    score,
                    best_scores,
                    previous,
                    tie_breakers,
                )

        if previous[length] is None:
            raise ValueError("tokenizer runtime could not encode input")
        segments: list[tuple[int, ...]] = []
        cursor = length
        while cursor > 0:
            item = previous[cursor]
            if item is None:
                raise ValueError("tokenizer runtime backtrace is incomplete")
            cursor, ids = item
            segments.append(ids)
        output: list[int] = []
        for ids in reversed(segments):
            output.extend(ids)
        return output

    def _fallback_ids(self, character: str) -> tuple[int, ...]:
        if self._byte_ids:
            ids = tuple(self._byte_ids[value] for value in character.encode("utf-8"))
            if ids:
                return ids
        return (self.unk_id,)

    @staticmethod
    def _relax(
        start: int,
        end: int,
        ids: tuple[int, ...],
        added_score: float,
        best_scores: list[float],
        previous: list[tuple[int, tuple[int, ...]] | None],
        tie_breakers: list[tuple[int, int, tuple[int, ...]] | None],
    ) -> None:
        score = best_scores[start] + added_score
        tie_breaker = (-(end - start), len(ids), ids)
        if score > best_scores[end] + 1e-12 or (
            abs(score - best_scores[end]) <= 1e-12
            and (tie_breakers[end] is None or tie_breaker < tie_breakers[end])
        ):
            best_scores[end] = score
            previous[end] = (start, ids)
            tie_breakers[end] = tie_breaker


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).replace("\x00", "")
    return re.sub(r"\s+", " ", normalized, flags=re.UNICODE).strip()


def export_sentencepiece_runtime(model_path: Path, target: Path) -> dict[str, Any]:
    import sentencepiece as spm

    processor = spm.SentencePieceProcessor(model_file=str(model_path))
    if processor.get_piece_size() != EXPECTED_VOCABULARY_SIZE:
        raise ValueError("SentencePiece model does not contain exactly 8,000 pieces")
    pieces = []
    for piece_id in range(processor.get_piece_size()):
        pieces.append(
            {
                "id": piece_id,
                "piece": processor.id_to_piece(piece_id),
                "score": float(processor.get_score(piece_id)),
                "type": _sentencepiece_type(processor, piece_id),
            }
        )
    payload = {
        "schema": RUNTIME_SCHEMA,
        "vocabularySize": processor.get_piece_size(),
        "pieces": pieces,
        "specialIds": {
            "pad": processor.pad_id(),
            "unk": processor.unk_id(),
            "bos": processor.bos_id(),
            "eos": processor.eos_id(),
        },
        "normalization": "nfkc",
        "dummyPrefix": True,
        "collapseWhitespace": True,
    }
    # Parse our own artifact before making it visible to the trainer.
    UnigramRuntimeTokenizer(payload)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return payload


def encode_documents(tokenizer: UnigramRuntimeTokenizer, texts: Iterable[str]) -> list[int]:
    ids: list[int] = []
    for text in texts:
        ids.extend(tokenizer.encode(text, add_bos=True, add_eos=True))
    return ids


def _sentencepiece_type(processor: Any, piece_id: int) -> str:
    checks = (
        ("is_unknown", "unknown"),
        ("is_control", "control"),
        ("is_unused", "unused"),
        ("is_byte", "byte"),
        ("is_user_defined", "userDefined"),
    )
    for method_name, label in checks:
        method = getattr(processor, method_name, None)
        if callable(method) and method(piece_id):
            return label
    return "normal"


def _parse_byte_piece(piece: str) -> int:
    if not re.fullmatch(r"<0x[0-9A-Fa-f]{2}>", piece):
        raise ValueError("invalid byte fallback piece")
    return int(piece[3:5], 16)


def _special_id(
    values: dict[str, Any], name: str, vocabulary_size: int, *, allow_missing: bool = False
) -> int:
    value = values.get(name)
    if not isinstance(value, int) or value < (-1 if allow_missing else 0) or value >= vocabulary_size:
        raise ValueError(f"invalid tokenizer special id: {name}")
    return value
