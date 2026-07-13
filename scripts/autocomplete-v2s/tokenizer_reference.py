"""Small independent Python reference for Public V2S tokenizer parity tests."""

from __future__ import annotations

import json
import sys
import unicodedata
from typing import Any

SPECIAL_TOKEN_COUNT = 4


def segment_text(text: str) -> list[list[str]]:
    normalized = unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    pieces: list[str] = []
    index = 0
    while index < len(normalized):
        point = normalized[index]
        if point == "\n":
            pieces.append(point)
            index += 1
            continue
        if point in " \t":
            end = index + 1
            while end < len(normalized) and normalized[end] in " \t":
                end += 1
            pieces.append(normalized[index:end])
            index = end
            continue
        if is_word_point(point):
            end = index + 1
            while end < len(normalized) and is_word_point(normalized[end]):
                end += 1
            pieces.append(normalized[index:end])
            index = end
            continue
        if not point.isspace():
            pieces.append(point)
        index += 1

    segments: list[list[str]] = []
    has_boundary = False
    for piece in pieces:
        if piece == "\n":
            segments.append(["\n"])
            has_boundary = False
            continue
        if all(point in " \t" for point in piece):
            has_boundary = True
            continue
        points = list(piece)
        if has_boundary:
            points[0] = "▁" + points[0]
        segments.append(points)
        has_boundary = False
    return segments


def is_word_point(point: str) -> bool:
    return unicodedata.category(point)[0] in {"L", "M", "N"} or point in "_'-"


def apply_bpe(segment: list[str], merges: list[list[str]]) -> list[str]:
    output = list(segment)
    for left, right in merges:
        merged: list[str] = []
        index = 0
        while index < len(output):
            if index + 1 < len(output) and output[index] == left and output[index + 1] == right:
                merged.append(left + right)
                index += 2
            else:
                merged.append(output[index])
                index += 1
        output = merged
    return output


def tokenize_unigram(segment: list[str], vocabulary: list[str], scores: list[int]) -> list[str]:
    points = list("".join(segment))
    entries = {vocabulary[index]: scores[index] for index in range(SPECIAL_TOKEN_COUNT, len(vocabulary))}
    best: list[tuple[int, list[str]] | None] = [None] * (len(points) + 1)
    best[0] = (0, [])
    for end in range(1, len(points) + 1):
        winner: tuple[int, list[str]] | None = None
        for start in range(end):
            previous = best[start]
            if previous is None:
                continue
            piece = "".join(points[start:end])
            piece_score = entries.get(piece)
            if piece_score is None:
                continue
            candidate = (previous[0] + piece_score, [*previous[1], piece])
            if winner is None or tokenization_key(candidate) < tokenization_key(winner):
                winner = candidate
        best[end] = winner
    return best[-1][1] if best[-1] is not None else segment


def tokenization_key(value: tuple[int, list[str]]) -> tuple[Any, ...]:
    score, pieces = value
    return (-score, len(pieces), tuple(-len(piece.removeprefix("▁")) for piece in pieces), "\0".join(pieces))


def encode(model: dict[str, Any], text: str) -> list[int]:
    vocabulary = model["vocabulary"]
    token_by_piece = {piece: index for index, piece in enumerate(vocabulary)}
    output: list[int] = []
    for segment in segment_text(text):
        if model["kind"] == "bpe":
            pieces = apply_bpe(segment, model["merges"])
        else:
            pieces = tokenize_unigram(segment, vocabulary, model["scores"])
        output.extend(token_by_piece.get(piece, 0) for piece in pieces)
    return output


def main() -> None:
    request = json.load(sys.stdin)
    print(json.dumps({"tokenIds": encode(request["model"], request["text"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
