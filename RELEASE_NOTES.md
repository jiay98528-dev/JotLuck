# JotLuck v0.11.0 — Signing Candidate Notes

> Date: 2026-08-05
> This document describes the current unpublished Windows x64 signing candidate.
> It is unsigned and is not a stable release.

## Important — This Is Not Yet a Public Release

JotLuck `v0.11.0` is an **unsigned signing candidate**. It must not be published or redistributed as a release. The exact Windows NSIS installer must first pass installed-app evidence capture, be submitted through the approved signing service, and have its Authenticode signature and post-sign SHA-256 verified. See [`CODE_SIGNING.md`](./CODE_SIGNING.md).

## Highlights

- **Local-first plain-text notebooks.** Folders are notebooks. Notes are regular `.md`, `.markdown`, `.mdx`, or `.txt` files that any text editor can open. Use OneDrive, Git, Syncthing, or your own backup tools.
- **CodeMirror 6 editor with Live Preview.** Block-level rendering, real-time markdown, full keyboard navigation.
- **Wiki-link and backlinks.** `[[note]]` syntax, aliases, dead/live link styling, and an automatic backlinks panel.
- **Local full-text search.** Filter by keywords, regular expressions, tags, date, and folder.
- **Templates and assets.** Built-in and custom templates with `{{date}}` and other placeholders. Image paste and drop into a notebook `assets/` folder with relative Markdown paths.
- **Flexible export.** PDF, DOCX, XLSX, CSV, TXT, HTML.
- **Offline completion.** Single ghost text suggestion, Tab to accept, fully on-device. Per-notebook and per-workspace learning.
- **Hot-pluggable theme system.** Default `paper` (warm paper OKLCH layout), capability demo `super-workbench`, plus 8 more built-in themes. Theme API v2 supports local market, `.mltheme` import, preview, install, enable, uninstall, fallback, and persistence.
- **Windows native desktop.** Tauri 2, Microsoft Edge WebView2, system file dialogs, native file watcher (Rust `notify`).
- **Read-only document import.** `.docx`, `.pdf`, `.xlsx`, and `.xls` open in an isolated semantic Markdown preview. The source remains untouched; users can continue in a detected professional editor or save a new Markdown copy for JotLuck editing.
- **Eight optional Windows associations.** `.md`, `.markdown`, `.mdx`, `.txt`, `.docx`, `.pdf`, `.xlsx`, and `.xls` are registered as optional Open With choices. Installation and upgrade never replace the user's Windows default application.
- **Explicit first-run choice.** The Welcome screen suggests only Markdown associations. Text, Word, PDF, and Excel remain unchecked, and the Open Notebook gate remains the entry to folder-based editing.

## Upgrade and Data Notes

- **Notes remain plain text files.** No migration is required. Existing notebooks open as-is.
- **Windows installer registration covers `.md`, `.markdown`, `.mdx`, `.txt`, `.docx`, `.pdf`, `.xlsx`, and `.xls` as optional Open With choices.** JotLuck does **not** replace the user's current default application for any extension.
- **External file opening** uses a single-file read-only session by default. Editing must be explicitly enabled and saves only the current file; the parent directory is not added as a notebook unless the user explicitly opens it.
- **Imported Office/PDF documents** use a separate read-only session. Their preview is semantic rather than pixel-perfect, PDF OCR is not included, and “Edit Markdown copy” always uses Save As without overwriting the source.
- **Local completion / training metadata** may refresh automatically but stays on the device.
- **Image assets remain in notebook `assets/` folders.** Deleting a note does not automatically delete image assets because they may be shared by multiple notes.

## Known Limitations

See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the complete list. Highlights:

- **Unsigned installer** — the signing candidate is not a public download and must not be redistributed.
- **macOS and Linux packages** have not completed host-specific packaging, signing, or release validation.
- **Local `.mltheme` / `.zip` imports** are a developer experimental feature. `trusted-code` themes may execute theme author code and take over exposed UX slots. Import only themes from trusted sources.
- **Cargo audit** reports allowed unsoundness warnings for `lru 0.12.5` and `memmap2 0.9.10` (transitive via tantivy 0.22.1).
- **Public V2S offline completion** is currently **fail-closed**. The V2R fixed-phrase Transformer was stopped after architecture pre-check, and the V2S Subword MKN architecture pre-check did not reach the 40%/45% Oracle@8/32 threshold. Free V2 (N-gram + per-workspace learning) is fully usable.
- **Notebook indexing** is guarded by a supported-note file-count limit to avoid accidental whole-system scans. Very large notebooks and very large individual files still need final stress validation before broad public distribution.

## Verification

Release verification is bound to the exact candidate commit and installer artifact, not copied into this document as mutable counters. The signing request requires green source checks, Windows installed-app evidence, an installer hash, an Authenticode verification result, and a post-sign hash.

## What to Expect Next

- **Code signing application** for the exact `v0.11.0` candidate, followed by Authenticode and post-sign hash verification.
- **macOS / Linux packaging** (TBD).
- **Public V2S offline completion** (currently fail-closed; will unlock only after passing the cold/workspace-conditioned final gate).
- **Optional V3** offline semantic short completion (48M–80M dedicated SLM, model + host delta ≤ 96 MiB). This is a research charter only.

## Reporting Issues

- Bug report: <https://github.com/jiay98528-dev/JotLuck/issues/new?template=bug_report.yml>
- Feature request: <https://github.com/jiay98528-dev/JotLuck/issues/new?template=feature_request.yml>
- Private security report: <https://github.com/jiay98528-dev/JotLuck/security/advisories/new>
- Support and known issues: [SUPPORT.md](./SUPPORT.md), [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)

Do **not** attach private notes, real folder paths, usernames, or any sensitive data to public issues. Use a minimal synthetic Markdown file or redacted reproduction whenever possible.

## License

JotLuck source code is available under the [MIT License](./LICENSE).

Copyright © 2026 鸰湖科技（深圳）有限公司<br>
Linghu Technology (Shenzhen) Co., Ltd.
