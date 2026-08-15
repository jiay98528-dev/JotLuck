# JotLuck v0.12.1-preview — Preview Release Notes

> Date: 2026-08-15
> This document describes the current public Windows x64 preview source track.
> The latest published installer remains unsigned and is not a stable release.

## Important — Unsigned Preview

JotLuck `v0.12.1-preview` is the current public source version. The latest published Windows NSIS installer remains the **public, unsigned `v0.12.0-preview`** package available only on GitHub Releases; verify SHA-256 `a13ee468e77c17f238d57fd17f9951cd51b95f0a1060ec020f4d3cb513a873be` before installing. Windows code signing is in progress and follows the pipeline in [`CODE_SIGNING.md`](./CODE_SIGNING.md): installed-app evidence capture, submission through an approved signing service, Authenticode verification, and a post-sign SHA-256 check.

## Highlights

- **Remote images now require an explicit choice.** HTTPS images start as in-place controls and make zero requests until the reader chooses to load them for the current note. Permission stays in window memory, is isolated by note, and clears on refresh.
- **Unsafe image sources stay blocked.** HTTP URLs, credential-bearing URLs, unsupported protocols, and forged remote-image controls cannot trigger a request. Raw HTML images follow the same policy and are sanitized again before display.
- **Local images continue to work automatically.** Notebook assets keep their existing local-first rendering path across Live Preview, split view, reading view, and external reading.
- **Image failures stay local.** A failed image or retry replaces only that image in place, without rebuilding or re-requesting already loaded sibling images.
- **Start writing before choosing a folder.** An empty desktop launch now opens a set of in-memory guided notes. They can be read and edited immediately without writing anything to disk. Saving prompts for a notebook folder; the edited current note can then be carried into that folder or discarded.
- **Guidance yields cleanly to real notebooks.** After a workspace is selected, the sample notes disappear from both the sidebar and editor, leaving only the user's own files. A future empty launch starts with a clean guide again.
- **Long bookmark lists remain reachable.** Bookmark lists now scroll independently in Paper, Halo Canvas, and Lumen Field instead of being clipped below the window.
- **Winged bookmarks identify themselves.** In the default wing layout, hovering a colored dot or reaching it by keyboard immediately reveals the note name beside it.
- **Local-first plain-text notebooks.** Folders are notebooks. Notes are regular `.md`, `.markdown`, `.mdx`, or `.txt` files that any text editor can open. Use OneDrive, Git, Syncthing, or your own backup tools.
- **CodeMirror 6 editor with Live Preview.** Block-level rendering, real-time markdown, full keyboard navigation.
- **Wiki-link and backlinks.** `[[note]]` syntax, aliases, dead/live link styling, and an automatic backlinks panel.
- **Local full-text search.** Filter by keywords, regular expressions, tags, date, and folder.
- **Templates and assets.** Built-in and custom templates with `{{date}}` and other placeholders. Image paste and drop into a notebook `assets/` folder with relative Markdown paths.
- **Flexible export.** PDF, DOCX, XLSX, CSV, TXT, HTML.
- **Offline completion.** Single ghost text suggestion, Tab to accept, fully on-device. Per-notebook and per-workspace learning.
- **Hot-pluggable theme system.** Six bundled configurations cover the safe fallback, Paper, Ability Lab, Halo Canvas, Lumen Field, and Super Workbench. Theme API v2 supports local market, `.mltheme` import, preview, install, enable, uninstall, fallback, and persistence.
- **Windows native desktop.** Tauri 2, Microsoft Edge WebView2, system file dialogs, native file watcher (Rust `notify`).
- **Read-only document import.** `.docx`, `.pdf`, `.xlsx`, and `.xls` open in an isolated semantic Markdown preview. The source remains untouched; users can continue in a detected professional editor or save a new Markdown copy for JotLuck editing.
- **Eight optional Windows associations.** `.md`, `.markdown`, `.mdx`, `.txt`, `.docx`, `.pdf`, `.xlsx`, and `.xls` are registered as optional Open With choices. Installation and upgrade never replace the user's Windows default application.
- **Explicit first-run choice.** The Welcome screen suggests only Markdown associations. Text, Word, PDF, and Excel remain unchecked, and the Open Notebook gate remains the entry to folder-based editing.

## Upgrade and Data Notes

- **Notes remain plain text files.** No migration is required. Existing notebooks open as-is.
- **Existing workspaces still restore first.** If JotLuck has a recently opened real notebook, startup restores that notebook instead of showing the guided samples.
- **Guided samples are memory-only.** They are recreated from a clean state on each empty launch and never touch disk until the user explicitly chooses a notebook folder and saves the current note.
- **Windows installer registration covers `.md`, `.markdown`, `.mdx`, `.txt`, `.docx`, `.pdf`, `.xlsx`, and `.xls` as optional Open With choices.** JotLuck does **not** replace the user's current default application for any extension.
- **External file opening** uses a single-file read-only session by default. Editing must be explicitly enabled and saves only the current file; the parent directory is not added as a notebook unless the user explicitly opens it.
- **Imported Office/PDF documents** use a separate read-only session. Their preview is semantic rather than pixel-perfect, PDF OCR is not included, and “Edit Markdown copy” always uses Save As without overwriting the source.
- **Local completion / training metadata** may refresh automatically but stays on the device.
- **Image assets remain in notebook `assets/` folders.** Deleting a note does not automatically delete image assets because they may be shared by multiple notes.

## Known Limitations

See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the complete list. Highlights:

- **Unsigned installer** — the preview is distributed only via GitHub Releases and may trigger Windows SmartScreen; verify the SHA-256 before installing.
- **macOS and Linux packages** have not completed host-specific packaging, signing, or release validation.
- **Local `.mltheme` / `.zip` imports** are a developer experimental feature. `trusted-code` themes may execute theme author code and take over exposed UX slots. Import only themes from trusted sources.
- **Cargo audit** reports allowed unsoundness warnings for `lru 0.12.5` and `memmap2 0.9.10` (transitive via tantivy 0.22.1).
- **Public V2S offline completion** is currently **fail-closed**. The V2R fixed-phrase Transformer was stopped after architecture pre-check, and the V2S Subword MKN architecture pre-check did not reach the 40%/45% Oracle@8/32 threshold. Free V2 (N-gram + per-workspace learning) is fully usable.
- **Notebook indexing** is guarded by a supported-note file-count limit to avoid accidental whole-system scans. Very large notebooks and very large individual files still need final stress validation before broad public distribution.

## Verification

This preview is bound to commit `094d99071d8a2daa74e75045644ef438ab18729a` and installer SHA-256 `a13ee468e77c17f238d57fd17f9951cd51b95f0a1060ec020f4d3cb513a873be`; Authenticode status is `NotSigned`. The package reports FileVersion and ProductVersion `0.12.0` and has a size of 6,166,624 bytes.

## What to Expect Next

- **Code signing.** Windows code signing is in progress.
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
