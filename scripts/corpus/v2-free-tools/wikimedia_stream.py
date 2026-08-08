#!/usr/bin/env python3
"""Deterministically materialize a bounded prose sample from a pinned Wikimedia bz2 dump."""

from __future__ import annotations

import argparse
import bz2
import hashlib
import heapq
import html
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


# ECMAScript's `\s` is Unicode White_Space plus U+FEFF. Keep the Python
# materializer on the same explicit set so normalized document identities are
# stable when the TypeScript selection builder verifies them.
CANONICAL_WHITESPACE_RE = re.compile(
    "[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+"
)

MIN_SEGMENT_BYTES = 256
MAX_SEGMENT_BYTES = 2048
MAX_SELECTED_BYTES = 24 * 1024 * 1024
SELECTION_SEED = "20260805"


@dataclass(frozen=True)
class Candidate:
    priority: int
    key: str
    page_id: str
    title_sha256: str
    revision_id: str
    segment_index: int
    byte_count: int
    sha256: str
    normalized_sha256: str


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def file_hashes(path: Path) -> tuple[int, str, str]:
    sha1 = hashlib.sha1()
    sha256 = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            sha1.update(chunk)
            sha256.update(chunk)
    return size, sha1.hexdigest(), sha256.hexdigest()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element: ET.Element, name: str) -> str:
    for child in element:
        if local_name(child.tag) == name:
            return child.text or ""
    return ""


def page_fields(page: ET.Element) -> tuple[str, str, str, str, str, bool]:
    title = child_text(page, "title").strip()
    namespace = child_text(page, "ns").strip()
    page_id = child_text(page, "id").strip()
    redirect = any(local_name(child.tag) == "redirect" for child in page)
    revision_id = ""
    raw_text = ""
    for child in page:
        if local_name(child.tag) != "revision":
            continue
        revision_id = child_text(child, "id").strip()
        for revision_child in child:
            if local_name(revision_child.tag) == "text":
                raw_text = revision_child.text or ""
                break
        break
    return title, namespace, page_id, revision_id, raw_text, redirect


class _SuffixingRawReader(io.RawIOBase):
    """Append a bounded suffix without materializing the decompressed input."""

    def __init__(self, source: bz2.BZ2File, suffix: bytes) -> None:
        super().__init__()
        self._source = source
        self._suffix = suffix
        self._suffix_offset = 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: bytearray) -> int | None:
        source_bytes = self._source.read(len(buffer))
        if source_bytes:
            buffer[: len(source_bytes)] = source_bytes
            return len(source_bytes)
        remaining = self._suffix[self._suffix_offset :]
        if not remaining:
            return 0
        count = min(len(buffer), len(remaining))
        buffer[:count] = remaining[:count]
        self._suffix_offset += count
        return count


def _iter_page_elements(source: object) -> Iterator[ET.Element]:
    for _, element in ET.iterparse(source, events=("end",)):
        if local_name(element.tag) != "page":
            continue
        yield element
        element.clear()


def iter_pages(path: Path, *, close_truncated_root: bool = False) -> Iterator[ET.Element]:
    with bz2.open(path, "rb") as source:
        if close_truncated_root:
            with io.BufferedReader(
                _SuffixingRawReader(source, b"\n</mediawiki>"), buffer_size=64 * 1024
            ) as repaired:
                yield from _iter_page_elements(repaired)
        else:
            yield from _iter_page_elements(source)


def clean_wikitext(value: str) -> str:
    text = html.unescape(value)
    text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    text = re.sub(
        r"<(?:syntaxhighlight|source|code|pre)\b[^>]*>[\s\S]*?</(?:syntaxhighlight|source|code|pre)>",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"<ref\b[^>]*/>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<ref\b[^>]*>[\s\S]*?</ref>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\{\|[\s\S]*?\|\}", " ", text)
    for _ in range(6):
        reduced = re.sub(r"\{\{[^{}]*\}\}", " ", text)
        if reduced == text:
            break
        text = reduced
    text = re.sub(
        r"\[\[(?:Category|分类|File|Image|文件|图像):[^\]]+\]\]",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[(?:https?://\S+)(?:\s+([^\]]+))?\]", lambda m: m.group(1) or "", text)
    text = re.sub(r"'{2,5}", "", text)
    text = re.sub(r"^={2,6}\s*(.*?)\s*={2,6}$", r"\1", text, flags=re.MULTILINE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"(?:^|\n)\s*[*#;:]+\s*", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize(value: str) -> str:
    return CANONICAL_WHITESPACE_RE.sub(
        " ", unicodedata.normalize("NFKC", value)
    ).strip().lower()


def reject_reason(
    title: str,
    namespace: str,
    page_id: str,
    revision_id: str,
    raw_text: str,
    redirect: bool,
    language: str,
) -> str | None:
    if not title or not page_id or not revision_id or not raw_text:
        return "missing-fields"
    if namespace != "0":
        return "non-article-namespace"
    if redirect or re.match(r"^#(?:REDIRECT|重定向)", raw_text.strip(), flags=re.IGNORECASE):
        return "redirect"
    if re.search(r"(?:消歧义|disambiguation)", raw_text[:500], flags=re.IGNORECASE):
        return "disambiguation"
    if language == "zh" and not re.search(r"[\u3400-\u9fff]", raw_text):
        return "language-mismatch"
    if language == "en" and not re.search(r"[A-Za-z]", raw_text):
        return "language-mismatch"
    return None


SAFETY_CHECKS = (
    ("frontmatter", re.compile(r"^---\s*$", re.MULTILINE)),
    ("fenced-code", re.compile(r"(?:^|\n)\s*(?:```|~~~)")),
    ("email", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)),
    ("phone", re.compile(r"(?:\+?\d[\s().-]*){8,}")),
    (
        "secret",
        re.compile(
            r"(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer)\s*[:=]\s*\S+",
            re.IGNORECASE,
        ),
    ),
    ("conversation-prompt", re.compile(r"(?:^|\n)\s*(?:user|assistant|system)\s*:", re.IGNORECASE)),
    (
        "navigation-boilerplate",
        re.compile(r"(?:privacy policy|terms of use|cookie settings|登录|注册|隐私政策)", re.IGNORECASE),
    ),
)


def safety_reason(value: str) -> str | None:
    for reason, pattern in SAFETY_CHECKS:
        if pattern.search(value):
            return reason
    return None


def split_oversized_unit(value: str) -> list[str]:
    result: list[str] = []
    current = ""
    for character in value:
        proposed = current + character
        if len(proposed.encode("utf-8")) > MAX_SEGMENT_BYTES:
            if current:
                result.append(current.strip())
            current = character
            continue
        current = proposed
        if len(current.encode("utf-8")) >= MIN_SEGMENT_BYTES and re.match(r"[。！？.!?;；\s]", character):
            result.append(current.strip())
            current = ""
    if current.strip():
        if result and len((result[-1] + " " + current.strip()).encode("utf-8")) <= MAX_SEGMENT_BYTES:
            result[-1] = f"{result[-1]} {current.strip()}"
        else:
            result.append(current.strip())
    return result


def segment_text(value: str) -> list[str]:
    units: list[str] = []
    for paragraph in re.split(r"\n\s*\n", value):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph.encode("utf-8")) <= MAX_SEGMENT_BYTES:
            units.append(paragraph)
        else:
            units.extend(split_oversized_unit(paragraph))
    segments: list[str] = []
    current = ""
    for unit in units:
        separator = "\n\n" if current else ""
        proposed = f"{current}{separator}{unit}"
        if len(proposed.encode("utf-8")) <= MAX_SEGMENT_BYTES:
            current = proposed
            continue
        if len(current.encode("utf-8")) >= MIN_SEGMENT_BYTES:
            segments.append(current)
            current = unit
        else:
            combined = split_oversized_unit(proposed)
            segments.extend(combined[:-1])
            current = combined[-1] if combined else ""
    if current:
        if len(current.encode("utf-8")) >= MIN_SEGMENT_BYTES:
            segments.append(current)
        elif segments and len((segments[-1] + "\n\n" + current).encode("utf-8")) <= MAX_SEGMENT_BYTES:
            segments[-1] = f"{segments[-1]}\n\n{current}"
    return [
        segment
        for segment in segments
        if MIN_SEGMENT_BYTES <= len((segment + "\n").encode("utf-8")) <= MAX_SEGMENT_BYTES
    ]


def classify_page_segments(
    page: ET.Element,
    language: str,
    source_id: str,
) -> tuple[list[tuple[Candidate, str]], str | None]:
    title, namespace, page_id, revision_id, raw_text, redirect = page_fields(page)
    reason = reject_reason(title, namespace, page_id, revision_id, raw_text, redirect, language)
    if reason:
        return [], reason
    text = clean_wikitext(raw_text)
    reason = safety_reason(text)
    if reason:
        return [], reason
    segments = segment_text(text)
    if not segments:
        return [], "no-eligible-segment"
    title_sha256 = hashlib.sha256(unicodedata.normalize("NFKC", title).encode("utf-8")).hexdigest()
    result: list[tuple[Candidate, str]] = []
    for segment_index, segment in enumerate(segments):
        encoded = (segment + "\n").encode("utf-8")
        normalized_sha256 = hashlib.sha256(normalize(segment).encode("utf-8")).hexdigest()
        key = hashlib.sha256(
            f"{source_id}|{page_id}|{segment_index}|{SELECTION_SEED}".encode("utf-8")
        ).hexdigest()
        result.append(
            (
                Candidate(
                    priority=int(key, 16),
                    key=key,
                    page_id=page_id,
                    title_sha256=title_sha256,
                    revision_id=revision_id,
                    segment_index=segment_index,
                    byte_count=len(encoded),
                    sha256=hashlib.sha256(encoded).hexdigest(),
                    normalized_sha256=normalized_sha256,
                ),
                segment,
            )
        )
    return result, None


def select_candidates(
    raw_path: Path,
    language: str,
    source_id: str,
    byte_budget: int,
    *,
    close_truncated_root: bool = False,
) -> tuple[dict[str, Candidate], dict[str, int]]:
    selected: dict[str, Candidate] = {}
    normalized: dict[str, str] = {}
    heap: list[tuple[int, str]] = []
    selected_bytes = 0
    rejected: dict[str, int] = {}
    for page in iter_pages(raw_path, close_truncated_root=close_truncated_root):
        candidates, outcome = classify_page_segments(page, language, source_id)
        if outcome is not None:
            rejected[outcome] = rejected.get(outcome, 0) + 1
            continue
        for candidate, _ in candidates:
            existing_key = normalized.get(candidate.normalized_sha256)
            if existing_key is not None:
                existing = selected[existing_key]
                rejected["exact-duplicate-segment"] = rejected.get("exact-duplicate-segment", 0) + 1
                if candidate.priority >= existing.priority:
                    continue
                selected.pop(existing_key)
                selected_bytes -= existing.byte_count
            selected[candidate.key] = candidate
            normalized[candidate.normalized_sha256] = candidate.key
            heapq.heappush(heap, (-candidate.priority, candidate.key))
            selected_bytes += candidate.byte_count
            while selected_bytes > byte_budget and heap:
                _, removed_key = heapq.heappop(heap)
                removed = selected.pop(removed_key, None)
                if removed is None:
                    continue
                normalized.pop(removed.normalized_sha256, None)
                selected_bytes -= removed.byte_count
    return selected, rejected


def load_json(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def validate_plan(plan: dict[str, object], workspace_root: Path) -> tuple[dict[str, object], Path, Path]:
    if plan.get("schema") != "jotluck.autocomplete.v2-free-wikimedia-stream-plan.v1" or plan.get("schemaVersion") != 1:
        raise ValueError("Wikimedia stream plan contract is invalid")
    registration_path = (workspace_root / str(plan["registrationPath"])).resolve(strict=True)
    if workspace_root not in registration_path.parents:
        raise ValueError("Registration path escaped the workspace")
    registration = load_json(registration_path)
    registration_hash = registration.pop("registrationSha256", None)
    if registration_hash != canonical_sha256(registration):
        raise ValueError("Wikimedia registration hash mismatch")
    registration["registrationSha256"] = registration_hash
    raw_path = (workspace_root / str(registration["rawPath"])).resolve(strict=True)
    if workspace_root not in raw_path.parents:
        raise ValueError("Raw path escaped the workspace")
    output_root = (workspace_root / str(plan["outputRoot"])).resolve()
    corpus_root = (workspace_root / "scripts" / "corpus").resolve()
    if corpus_root != output_root and corpus_root not in output_root.parents:
        raise ValueError("Wikimedia output must remain under scripts/corpus")
    source = registration["source"]
    if not isinstance(source, dict) or raw_path.name != source.get("filename"):
        raise ValueError("Wikimedia raw filename is not bound to registration")
    if int(plan["maximumSelectedBytes"]) < 1 or int(plan["maximumSelectedBytes"]) > MAX_SELECTED_BYTES:
        raise ValueError("Wikimedia sample budget is invalid")
    if plan.get("licenseSpdx") != "CC-BY-SA-4.0":
        raise ValueError("Wikimedia license must be CC-BY-SA-4.0")
    evidence_path = (workspace_root / str(plan["licenseEvidencePath"])).resolve(strict=True)
    if workspace_root not in evidence_path.parents:
        raise ValueError("License evidence path escaped the workspace")
    evidence_size, _, evidence_sha256 = file_hashes(evidence_path)
    if evidence_size != plan.get("licenseEvidenceBytes") or evidence_sha256 != plan.get("licenseEvidenceSha256"):
        raise ValueError("Wikimedia license evidence identity mismatch")
    if not str(plan.get("attributionUrl", "")).startswith("https://"):
        raise ValueError("Wikimedia attribution URL must use HTTPS")
    if not str(plan.get("upstreamDumpUrl", "")).startswith("https://"):
        raise ValueError("Wikimedia dump URL must use HTTPS")
    return registration, raw_path, output_root


def materialize(plan_path: Path, workspace_root: Path) -> dict[str, object]:
    plan = load_json(plan_path)
    registration, raw_path, output_root = validate_plan(plan, workspace_root)
    if output_root.exists():
        raise FileExistsError(f"Output already exists: {output_root}")
    source = registration["source"]
    assert isinstance(source, dict)
    size, sha1, sha256 = file_hashes(raw_path)
    if size != source["bytes"] or sha1 != source["sha1"] or sha256 != source["sha256"]:
        raise ValueError("Wikimedia raw changed after registration")
    selected, rejected = select_candidates(
        raw_path,
        str(source["language"]),
        str(source["sourceId"]),
        int(plan["maximumSelectedBytes"]),
        close_truncated_root="byteRange" in source,
    )
    if not selected:
        raise ValueError("Wikimedia stream produced no approved prose")
    output_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".staging-{output_root.name}-", dir=output_root.parent))
    try:
        documents: list[dict[str, object]] = []
        remaining = set(selected)
        for page in iter_pages(raw_path, close_truncated_root="byteRange" in source):
            candidates, _ = classify_page_segments(
                page,
                str(source["language"]),
                str(source["sourceId"]),
            )
            for candidate, text in candidates:
                if candidate.key not in remaining:
                    continue
                document_id = f"{source['sourceId']}-{candidate.key[:16]}"
                filename = f"{document_id}.txt"
                encoded = (text + "\n").encode("utf-8")
                if hashlib.sha256(encoded).hexdigest() != candidate.sha256:
                    raise ValueError("Wikimedia second-pass content identity changed")
                target = staging / filename
                with target.open("xb") as stream:
                    stream.write(encoded)
                    stream.flush()
                    os.fsync(stream.fileno())
                page_url = f"https://{source['language']}.{source['project']}.org/?curid={candidate.page_id}"
                documents.append(
                    {
                        "documentId": document_id,
                        "sourceId": source["sourceId"],
                        "language": source["language"],
                        "category": plan["category"],
                        "relativePath": f"{plan['outputRoot']}/{filename}",
                        "titleSha256": candidate.title_sha256,
                        "pageId": candidate.page_id,
                        "revisionId": candidate.revision_id,
                        "segmentIndex": candidate.segment_index,
                        "pageUrl": page_url,
                        "revisionUrl": f"{page_url}&oldid={candidate.revision_id}",
                        "selectionKeySha256": candidate.key,
                        "selectionSeed": SELECTION_SEED,
                        "snapshotSha256": source["sha256"],
                        "bytes": candidate.byte_count,
                        "sha256": candidate.sha256,
                        "normalizedSha256": candidate.normalized_sha256,
                    }
                )
                remaining.remove(candidate.key)
            if not remaining:
                break
        if remaining:
            raise ValueError('Wikimedia second pass did not reproduce every selected page')
        documents.sort(key=lambda item: str(item["documentId"]))
        source_record = {
            "id": source["sourceId"],
            "kind": "wikimedia-cc-by-sa",
            "language": source["language"],
            "category": plan["category"],
            "contentRoot": plan["outputRoot"],
            "licenseSpdx": plan["licenseSpdx"],
            "licenseEvidencePath": plan["licenseEvidencePath"],
            "licenseEvidenceBytes": plan["licenseEvidenceBytes"],
            "licenseEvidenceSha256": plan["licenseEvidenceSha256"],
            "cleanerVersion": plan["cleanerVersion"],
            "attributionUrl": plan["attributionUrl"],
            "upstreamDumpUrl": plan["upstreamDumpUrl"],
            "upstreamDumpDate": source["dumpDate"],
            "snapshotBytes": source["bytes"],
            "snapshotSha256": source["sha256"],
        }
        for optional_identity in ("upstreamObjectBytes", "upstreamObjectSha1", "byteRange"):
            if optional_identity in source:
                source_record[optional_identity] = source[optional_identity]
        selected_bytes = sum(int(item["bytes"]) for item in documents)
        input_tree_records = [
            {
                "documentId": item["documentId"],
                "sourceId": item["sourceId"],
                "language": item["language"],
                "category": item["category"],
                "relativePath": item["relativePath"],
                "bytes": item["bytes"],
                "sha256": item["sha256"],
                "normalizedSha256": item["normalizedSha256"],
            }
            for item in documents
        ]
        manifest_without_hash = {
            "schema": "jotluck.autocomplete.v2-free-supplement.v1",
            "schemaVersion": 1,
            "datasetId": plan["datasetId"],
            "sources": [source_record],
            "documents": documents,
            "selectedBytes": selected_bytes,
            "sourceBytes": {source["sourceId"]: selected_bytes},
            "languageBytes": {
                "zh": selected_bytes if source["language"] == "zh" else 0,
                "en": selected_bytes if source["language"] == "en" else 0,
            },
            "categoryBytes": {plan["category"]: selected_bytes},
            "inputTreeSha256": canonical_sha256(input_tree_records),
            "materialization": {
                "registrationSha256": registration["registrationSha256"],
                "selectionAlgorithm": "lowest-sha256-source-page-segment-seed-byte-budget-v1",
                "selectionSeed": SELECTION_SEED,
                "maximumSelectedBytes": plan["maximumSelectedBytes"],
                "rejected": dict(sorted(rejected.items())),
            },
        }
        manifest = manifest_without_hash
        manifest_path = staging / "manifest.json"
        with manifest_path.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(manifest, stream, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        staging.replace(output_root)
        return manifest
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-root", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    args = parser.parse_args()
    workspace_root = args.workspace_root.resolve(strict=True)
    plan_path = args.plan.resolve(strict=True)
    manifest = materialize(plan_path, workspace_root)
    json.dump(
        {
            "manifestSha256": canonical_sha256(manifest),
            "selectedBytes": manifest["selectedBytes"],
        },
        sys.stdout,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
