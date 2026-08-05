# V2.2 public corpus source review

> Observed: 2026-08-05 (Asia/Shanghai)
> Scope: `public-v2-free-decoder-v1` DEVELOPMENT corpus supplementation only
> Decision: use the remaining eligible content from the already pinned Tatoeba English CC0 snapshot together with project-owned v1 deterministic generation; target at least 9MiB of additional cleaned document text

This record captures engineering provenance and source-selection facts. It is not legal advice and does not claim rights beyond what the linked source declarations state. HTTP metadata below is an observation of the named upstream object, not a content identity: any adopted bytes still require a downloaded-byte SHA-256 and a versioned cleaning report.

## Official observations

| Source/artifact                                     | Official URL                                                                                                                                                                                                                                                   | Observed HTTP metadata                                                           | Decision and reason                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tatoeba English CC0 sentences                       | [Tatoeba downloads](https://tatoeba.org/en/downloads); [English CC0 export](https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_CC0.tsv.bz2); [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)                                   | `Content-Length: 1,288,524`; `Last-Modified: Sat, 01 Aug 2026 06:30:21 GMT`      | Source remains available under the upstream CC0-specific export. Do not silently ingest this weekly object: it differs in bytes from the project-pinned 2026-07-12 object (`1,288,366` bytes, SHA-256 `14f975533e2f15257f674d6099b95cf6b2c3458a8baf7496935081ad862f4b91`). Adopt only remaining eligible documents derived from that pinned object and its existing cleaning report. |
| Tatoeba Mandarin Chinese (`cmn`) CC0 sentences      | [Tatoeba downloads](https://tatoeba.org/en/downloads); [Mandarin CC0 export](https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences_CC0.tsv.bz2)                                                                                                 | `Content-Length: 102`; `Last-Modified: Sat, 01 Aug 2026 06:30:21 GMT`            | Rejected for supplementation. The compressed object is only 102 bytes and supplies no material Chinese corpus capacity. Its bytes must not be extrapolated into an assumed text volume.                                                                                                                                                                                              |
| Tatoeba global links table                          | [Tatoeba downloads](https://tatoeba.org/en/downloads); [links export](https://downloads.tatoeba.org/exports/links.tar.bz2)                                                                                                                                     | `Content-Length: 149,039,032`; `Last-Modified: Sat, 01 Aug 2026 06:15:11 GMT`    | Rejected. The export records sentence relations/IDs, not training prose. Its compressed file size is not corpus-text capacity. The general-download licensing/attribution path also differs from the already pinned CC0 sentence artifact and would require a separate review.                                                                                                       |
| English Wikipedia/Wikimedia pages-and-articles dump | [Wikimedia dumps](https://dumps.wikimedia.org/); [English latest artifact](https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles-multistream.xml.bz2); [Wikimedia licensing terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | `Content-Length: 26,564,488,717`; `Last-Modified: Tue, 07 Jul 2026 20:59:03 GMT` | Rejected for this bounded supplementation. The 24.7GiB compressed artifact is disproportionate to a 9MiB target, and downstream attribution, CC BY-SA share-alike and GFDL handling would require a separate design and review.                                                                                                                                                      |
| Chinese Wikipedia/Wikimedia pages-and-articles dump | [Wikimedia dumps](https://dumps.wikimedia.org/); [Chinese latest artifact](https://dumps.wikimedia.org/zhwiki/latest/zhwiki-latest-pages-articles-multistream.xml.bz2); [Wikimedia licensing terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | `Content-Length: 3,559,343,816`; `Last-Modified: Tue, 04 Aug 2026 10:20:28 GMT`  | Rejected for the same bounded-scope reasons. The 3.3GiB compressed artifact and its downstream obligations are unnecessary for this smoke-stage gap.                                                                                                                                                                                                                                 |

The Wikipedia/Wikimedia rejection is a scope and risk decision, not a conclusion that those sources cannot be used by another project or a later separately reviewed pipeline.

## Approved supplementation identity

The V2.2 supplementation builder may combine only:

1. Remaining eligible documents from the already pinned Tatoeba English CC0 raw object and its committed cleaning evidence in `scripts/corpus/tatoeba-cc0-cleaning-report.json` and `scripts/corpus/licenses/tatoeba-cc0.md`.
2. Project-owned v1 deterministic generated prose, rematerialized under a V2.2-specific generator identity. Reuse of an old generated sentence is allowed only when the new manifest binds the exact generator version, recipe, seed and document content SHA-256.

The combined cleaned text addition must be at least 9MiB. Downloaded bytes, compressed bytes, archive headers, link/ID tables, license text and manifest JSON do not count toward that threshold.

This approval does not change the V2R or V2S selections and does not modify either architecture-stop record. It also does not authorize final access, public asset installation, publisher execution or a default-engine switch.

## Required provenance-bundle obligations

以下字段由已跟踪的补量计划、materializer 输出 manifest 和最终 selection manifest 共同绑定；不要求把上游下载元数据重复写入每一条文档记录：

Every adopted document must bind:

- source ID and the official source URL;
- SPDX identifier or the exact upstream license declaration URL, without converting an ambiguous declaration into an asserted legal conclusion;
- observation timestamp plus upstream `Content-Length` and `Last-Modified` when supplied;
- downloaded raw bytes and SHA-256 for external material;
- generator/cleaner name and version, recipe SHA and seed as applicable;
- language, category, cleaned UTF-8 byte count and document content SHA-256;
- selection split and proof that downloaded/archive/manifest/link-table bytes were excluded from corpus-size accounting;
- deduplication, privacy and train-to-validation/final overlap results.

If an upstream weekly object changes, the builder must fail closed until a new raw SHA, cleaning report and source review are explicitly recorded. A URL or HTTP header alone cannot stand in for frozen content identity.
