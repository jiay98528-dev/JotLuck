# JotLuck v0.10.0-rc.1 — Release Notes

> Date: 2026-07-31
> This document describes the current unpublished Windows x64 release candidate.
> It is unsigned and is not a stable release.

## ⚠️ Important — This Is a Release Candidate

JotLuck `v0.10.0-rc.1` is the **first public release candidate**. It is **not** a stable release. The Windows NSIS installer is **unsigned**.

**On first launch**, Windows SmartScreen will show a warning because the binary is not signed. To proceed:

1. Click "More info"
2. Click "Run anyway"

The unsigned status is a known issue tracked in [`CODE_SIGNING.md`](./CODE_SIGNING.md). Signing is in progress via SignPath Foundation's open-source program. A signed stable build will follow once approval is granted.

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
- **Multi-window file association.** External `.md` / `.markdown` / `.mdx` files open in a single-file read-only preview. `.txt` remains an in-app note format and is not registered as a system launch format.

## Upgrade and Data Notes

- **Notes remain plain text files.** No migration is required. Existing notebooks open as-is.
- **Windows installer registration covers `.md`, `.markdown`, `.mdx` as optional Open With choices.** JotLuck does **not** replace the user's current default application for any extension. `.txt` is not registered.
- **External file opening** uses a single-file read-only session by default. Editing must be explicitly enabled and saves only the current file; the parent directory is not added as a notebook unless the user explicitly opens it.
- **Local completion / training metadata** may refresh automatically but stays on the device.
- **Image assets remain in notebook `assets/` folders.** Deleting a note does not automatically delete image assets because they may be shared by multiple notes.

## Known Limitations

See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the complete list. Highlights:

- **Unsigned installer** — SmartScreen will warn; see top of these notes.
- **macOS and Linux packages** have not completed host-specific packaging, signing, or release validation.
- **Local `.mltheme` / `.zip` imports** are a developer experimental feature. `trusted-code` themes may execute theme author code and take over exposed UX slots. Import only themes from trusted sources.
- **Cargo audit** reports allowed unsoundness warnings for `lru 0.12.5` and `memmap2 0.9.10` (transitive via tantivy 0.22.1).
- **Public V2S offline completion** is currently **fail-closed**. The V2R fixed-phrase Transformer was stopped after architecture pre-check, and the V2S Subword MKN architecture pre-check did not reach the 40%/45% Oracle@8/32 threshold. Free V2 (N-gram + per-workspace learning) is fully usable.
- **Notebook indexing** is guarded by a supported-note file-count limit to avoid accidental whole-system scans. Very large notebooks and very large individual files still need final stress validation before broad public distribution.

## Verification

- `pnpm.cmd --filter @jotluck/app typecheck` — pass
- `pnpm.cmd exec eslint packages/app/src packages/renderer/src` — pass
- `pnpm.cmd --filter @jotluck/app lint:style` — pass
- `pnpm.cmd --filter @jotluck/app test` — pass, 156/156
- `pnpm.cmd --filter @jotluck/app build` — pass
- `pnpm.cmd audit --audit-level high` — pass (low/moderate advisories remain)
- Chromium E2E — pass
- Firefox E2E — pass
- Tauri release build — pass
- `pnpm.cmd release:rc-gate` — pass

## What to Expect Next

- **Code signing** via SignPath Foundation (pending approval). A signed `v0.10.0` stable will follow.
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
