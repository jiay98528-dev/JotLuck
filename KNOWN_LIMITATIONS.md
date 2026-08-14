# Known Limitations

This document describes limitations for JotLuck `v0.12.0-preview`. These are not
marketing claims; they are the remaining release constraints and expected
behavior boundaries.

## Preview Status

- `v0.12.0-preview` is a public, unsigned preview. It is not a stable release;
  the official installer is available only on GitHub Releases and may trigger a
  Windows SmartScreen warning.
- This preview does not claim complete installed-app release evidence, final
  Rust audit evidence, signing, notarization, or host-specific validation for
  every supported platform.
- Any future RC or stable release must bind its own exact installer,
  verification evidence, and release notes.

## Environment-Dependent Gates

- Rust dependency audit requires the `cargo-audit` subcommand locally, or a
  green CI Rust audit job with commit, URL, time, and status recorded.
- Tauri release signing/notarization is not covered by the current local,
  unsigned Windows NSIS candidate.
- WebView2 installation uses Tauri's embedded bootstrapper. If a Windows device
  lacks WebView2 and has no network, the installer shows localized guidance but
  cannot complete dependency installation without an offline WebView2 package.

## Web App Limits

- Real local filesystem access depends on browser capability and permissions.
- Browser downloads and clipboard behavior can vary by browser security policy.
- The Web app should not be treated as equivalent to the Tauri desktop app for
  native file watching.

## Desktop App Limits

- The current Windows preview is unsigned. Its only official public download is
  the `v0.12.0-preview` GitHub Release; verify the SHA-256 published on that page
  before installation.
- Tauri shell access is limited to the scoped `shell:default` capability.
  Unscoped `shell:allow-open`, `process:*`, and `fs:*` capabilities are not
  granted in the default desktop capability file.
- Notebook root, native watcher, search index, and completion retrieval state
  are isolated by window. Closing one window removes only that window's state.
- macOS and Linux packages still need host-specific packaging, signing, and
  release validation.

## Rust Dependency Audit Warnings

- `cargo audit` currently reports allowed unsoundness warnings for `lru 0.12.5`
  (`RUSTSEC-2026-0002`) and `memmap2 0.9.10` (`RUSTSEC-2026-0186`). Both enter
  the desktop dependency graph transitively through `tantivy 0.22.1`.
- This preview records that upstream risk instead of attempting a high-risk
  Tantivy upgrade during release hardening. A successful audit process exit
  must therefore not be described as a zero-warning dependency result.
- Opening `.md` / `.markdown` / `.mdx` / `.txt` from Windows starts a single-file read-only
  session. It intentionally does not scan the parent directory as a notebook.
  Editing must be explicitly enabled and saves only the current file.
- Opening `.docx` / `.pdf` / `.xlsx` / `.xls` starts an isolated read-only import
  session. The preview maps recoverable document semantics to Markdown; it does
  not reproduce Office or PDF layout pixel-for-pixel, perform PDF OCR, or edit
  the source document in place. Scanned, encrypted, or textless PDFs cannot be
  previewed as text. Unsupported document structures produce explicit warnings.
- Saving an imported document creates a new `.md` file and, when needed, a new
  assets directory. JotLuck never overwrites the source document. A stale source
  revision disables saving until the document is converted again.

## Theme Import Limits

- Local `.mltheme` and `.zip` imports are a developer experimental feature.
- `trusted-code` themes may execute theme author code and may take over exposed
  UX slots. Import only themes from trusted sources.
- Current candidate behavior requires explicit user confirmation before opening
  the theme-package picker. This is disclosure and confirmation, not a sandbox
  or community-market review.

## Data And Asset Behavior

- Notes are plain text note files. The app edits `.md`, `.markdown`, `.mdx`, and
  `.txt`, and imports `.docx`, `.pdf`, `.xlsx`, and `.xls` read-only. The Windows
  installer registers JotLuck as an optional Open With handler for all eight
  extensions and does not replace the user's current default app.
- Images are written into `assets/` and referenced by relative Markdown paths.
- Deleting a note does not automatically delete assets because assets may be
  shared by multiple notes.
- Users should keep their own backups or version control for notebooks before
  bulk rename/delete operations.

## Offline Completion Limits

- Completion remains a single ghost text suggestion, not a menu.
- Quality depends on local notebook content and baseline training data.
- IME composition is guarded and covered by E2E, but target-environment manual
  checks remain useful for uncommon IME/browser combinations.

## Performance Limits

- The previous `NotebookHome` chunk warning has been cleared by lazy modal
  loading and manual vendor chunks.
- Notebook indexing is guarded by a supported-note file-count limit to avoid
  accidental whole-system scans. Very large notebooks and very large individual
  files still need final stress validation before broad public distribution.
