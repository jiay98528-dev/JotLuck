#!/usr/bin/env python3
"""Deterministically clean the pinned Tatoeba English CC0 export."""

from __future__ import annotations

import argparse
import bz2
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path


CLEANER_VERSION = "jotluck-tatoeba-cc0-cleaner-v1"
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE = re.compile(r"(?:\+?\d[\s-]*){8,}")
URL = re.compile(r"(?:https?://|www\.)", re.IGNORECASE)
BOILERPLATE = re.compile(
    r"\b(?:click here|subscribe|sign in|log in|navigation menu|user:|assistant:|system:)\b",
    re.IGNORECASE,
)
WORD = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
CAPITALIZED = re.compile(r"\b[A-Z][a-z]{2,}\b")
ALLOWED_INTERNAL_CAPITALIZED = {
    "I",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_sentence(value: str) -> str | None:
    text = unicodedata.normalize("NFKC", value).strip()
    text = re.sub(r"[ \t]+", " ", text)
    if not 20 <= len(text.encode("utf-8")) <= 320:
        return None
    if "\n" in text or "\r" in text or "<" in text or ">" in text:
        return None
    if EMAIL.search(text) or PHONE.search(text) or URL.search(text) or BOILERPLATE.search(text):
        return None
    if re.search(r"[\u3400-\u9fff]", text):
        return None
    words = WORD.findall(text)
    if not 4 <= len(words) <= 40 or sum(len(word) for word in words) < 18:
        return None
    # A conservative privacy gate rejects likely named entities in the body.
    # Sentence-initial capitalization is grammatical and is ignored.
    for match in CAPITALIZED.finditer(text):
        if match.start() != 0 and match.group(0) not in ALLOWED_INTERNAL_CAPITALIZED:
            return None
    return text


def main() -> None:
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError(f"Python 3.12 is required, got {sys.version.split()[0]}")
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--expected-sha256", required=True)
    arguments = parser.parse_args()
    actual_sha256 = sha256_file(arguments.input)
    if actual_sha256 != arguments.expected_sha256:
        raise ValueError(f"Tatoeba raw SHA-256 mismatch: {actual_sha256}")

    rows: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    rejected = 0
    with bz2.open(arguments.input, "rt", encoding="utf-8", errors="strict") as stream:
        for line_number, raw_line in enumerate(stream, start=1):
            fields = raw_line.rstrip("\n").split("\t")
            if len(fields) != 4 or fields[1] != "eng" or not fields[0].isdigit():
                raise ValueError(f"Invalid Tatoeba CC0 row at line {line_number}")
            cleaned = clean_sentence(fields[2])
            identity = cleaned.casefold() if cleaned else ""
            if not cleaned or identity in seen:
                rejected += 1
                continue
            seen.add(identity)
            rows.append((int(fields[0]), cleaned, fields[3]))
    rows.sort(key=lambda item: item[0])

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("w", encoding="utf-8", newline="\n") as output:
        for sentence_id, text, source_date in rows:
            output.write(
                json.dumps(
                    {"id": sentence_id, "text": text, "sourceDate": source_date},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "\n"
            )
    report_without_identity = {
        "schema": "jotluck.autocomplete.v2r-tatoeba-cleaning.v1",
        "schemaVersion": 1,
        "cleanerVersion": CLEANER_VERSION,
        "rawSha256": actual_sha256,
        "rawBytes": arguments.input.stat().st_size,
        "accepted": len(rows),
        "rejected": rejected,
        "outputSha256": sha256_file(arguments.output),
        "outputBytes": arguments.output.stat().st_size,
    }
    canonical = json.dumps(
        report_without_identity,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    report = {
        **report_without_identity,
        "reportSha256": hashlib.sha256(canonical).hexdigest(),
    }
    arguments.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
