# V2.2 public corpus source review

> Frozen: 2026-08-08 (Asia/Shanghai)
> Scope: `public-v2-free-decoder-v1` DEVELOPMENT training and validation research only
> Decision: admit three exact Wikimedia 2026-08-01 dump objects plus one fixed, member-aligned range of the Chinese Wikisource dump as bounded natural-prose sources; this does not approve redistribution of a trained model

This record binds engineering provenance and the source-selection decision. It is not legal
advice and does not claim rights beyond the upstream terms. The mutable `latest` aliases are
discovery endpoints only. Training must use the exact filenames and hashes below and must fail
closed if any byte identity changes.

## Approved frozen raw objects

| Source ID                         | Exact upstream object                                                                                                                                                                    |       Bytes | Official SHA-1                                               | Controller SHA-256                                                 | Language/category             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------: | ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------- |
| `enwiki-partition-1`              | [enwiki 2026-08-01 partition 1](https://dumps.wikimedia.org/enwiki/20260801/enwiki-20260801-pages-articles-multistream1.xml-p1p41242.bz2)                                                | 299,138,062 | `c70c36ca1b892ed97b0dbce2bc889468f7abe858`                   | `856411e9a99bdc38f809ee36960ae05249a41815d56e08f015b138feaad8fe9f` | English / encyclopedic prose  |
| `zhwiki-partition-1`              | [zhwiki 2026-08-01 partition 1](https://dumps.wikimedia.org/zhwiki/20260801/zhwiki-20260801-pages-articles-multistream1.xml-p1p187712.bz2)                                               | 255,349,033 | `18f50054deb180b806ac45bf15894b409c3bc3e1`                   | `6277a5bc5a833a8ec7e9a3d90a81d2eaa9400b52732223094e4bf2f5c595b4f2` | Chinese / encyclopedic prose  |
| `enwikibooks-full`                | [enwikibooks 2026-08-01 pages/articles](https://dumps.wikimedia.org/enwikibooks/20260801/enwikibooks-20260801-pages-articles-multistream.xml.bz2)                                        | 207,199,592 | `726667a53896e6d43b692f916441086ae6382384`                   | `424f5b63febed2f3bc5979841ca4fb8bf3dbd57de959004c46d221611ff5c4dd` | English / instructional prose |
| `zhwikisource-prefix-0-300313200` | [zhwikisource 2026-08-01 pages/articles](https://dumps.wikimedia.org/zhwikisource/20260801/zhwikisource-20260801-pages-articles-multistream.xml.bz2), inclusive byte range `0-300313200` | 300,313,201 | local range SHA-1 `56519f980146aa598b544598cb1276bb1a5d2130` | `ce51188c0b2d89e1386de81677f22df01dbabf174b3dc32f476d21d1a366c559` | Chinese / instructional prose |

The controller also retained the four official `dumpstatus.json` observations used to resolve
the dated objects. Their local SHA-256 values are:

- enwiki: `b6af0963c1376a54f96ddc2731fac76da614b2551e9751741ac8a3ab512925f4`
- zhwiki: `c1d8ddc8c1aea6ae518237f019884e4c115b253ecf1ee1cff29a17da5fda9ea2`
- enwikibooks: `74ba30923d33ac446ad318c2a6656e049661da6f336b04af26f1ce1c1acea4ee`
- zhwikisource: the official parent object is 7,168,395,497 bytes with SHA-1
  `61011491bf408e8e647eefc4560e531965df7e52`. Its dated multistream index is 53,342,750
  bytes with official SHA-1 `02b44c4da1bc65dfa98ad65806eac4b421d04543` and controller
  SHA-256 `9ddbea1e3f3f7c8072b74dbfab5f1205990780d0684368977c9fcc4b3de4f97b`.
  The range ends immediately before the next indexed bzip2 member at offset 300,313,201,
  so the retained prefix remains a complete concatenation of bzip2 members.

The exact `zhwikibooks-full` object was also reviewed and attempted: 19,924,402 bytes,
official SHA-1 `3575564cc9c1fd11ae6c97330fa3d519d691a9e0`, controller SHA-256
`0494eee9136ada51499af78d923477a629b04627d4af1e2ac49d24bcbb721aeb`.
It yielded only 19,566,329 cleaned bytes, below the fixed 24 MiB allocation, so the plan's
same-language Wikisource fallback was activated. The insufficient result is not part of the
formal selection.

## License and use boundary

Wikimedia's [Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use/en)
describe text contributions as available under CC BY-SA 4.0, with some projects or content also
subject to additional terms such as GFDL. The selection records `CC-BY-SA-4.0`, the exact dump
URL/date, attribution URL, raw identity and cleaner identity. It does not erase page-level or
project-level obligations.

These sources are approved only for the current `packageMode=DEVELOPMENT` research candidate.
Before any model or derived corpus is distributed, a separate license review must decide the
required attribution and Share-Alike treatment. This record therefore does not make the
candidate `releaseEligible` and does not authorize publisher execution, production installation,
final access or a default-engine switch.

## Bounded cleaning and selection contract

Each source may contribute at most 24 MiB of cleaned UTF-8 prose. Only namespace-0,
non-redirect natural text is eligible. The cleaner removes templates, tables, references,
navigation, categories, HTML, code/frontmatter, contact details and secret-shaped strings, then
segments by article boundaries into 256–2,048-byte documents.

Selection order is `SHA256(sourceId|pageId|segmentIndex|20260805)`. Every retained document binds
source ID, page/revision identity, segment index, language, category, byte count, content SHA-256,
normalized SHA-256 and cleaner version. Archive bytes, XML, indexes, license text and manifest
bytes never count as training bytes.

The combined formal selection must additionally pass exact deduplication, 128-value MinHash with
32×4 LSH candidate recall followed by exact shingle Jaccard threshold 0.80, source/category budgets, Chinese/English byte balance,
and validation/final fingerprint leakage checks. User notes, Personal/Notebook data, feedback,
local metrics, code, frontmatter, secrets and every holdout remain permanently excluded.

The Chinese Wikibooks shortfall is resolved only by the fixed Chinese Wikisource range recorded
above. No mutable URL, unreviewed source or further range may be substituted silently.
