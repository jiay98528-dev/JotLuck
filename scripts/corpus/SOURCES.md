# Corpus Sources

This baseline corpus is publishable project material.

## Included Verbatim Sources

- Project-owned synthetic notes and technical examples in this directory.
- Existing JotLuck project documents referenced by `../../doc/` and `../../spec/`.

## Public Web Policy

Public websites may be collected for local autocomplete training experiments without a license gate. Raw pages and cleaned fragments stay under `scripts/corpus/_web-cache/`, which is gitignored.

The release baseline uses repository corpus files by default. The web-local baseline is generated locally from short, privacy-scrubbed fragments and is not committed.

## Web Collection Rules

- No license or authorization check is performed by the collector.
- Pages are split into 20-120 character fragments before training.
- Names, phone numbers, emails, company names, pen names, account handles, addresses, and contact fields are removed or replaced.
- Fragments with multiple privacy entity classes are dropped.
- Clean training fragments do not include source URLs, page titles, bylines, or attribution text.

## Excluded Sources

- Long-form fiction and narrative chapters.
- User private notes.
- Content containing credentials, private names, customer data, or unreleased business information.
