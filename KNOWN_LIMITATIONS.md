# Known Limitations

This document describes limitations for JotLuck `v0.1.0-preview`. These are not
marketing claims; they are the remaining release constraints and expected
behavior boundaries.

## Internal Preview Status

- `v0.1.0-preview` is an internal preview candidate, not a formal RC or stable release.
- L1/L2, coverage, production build, Rust fmt/check/test/audit, Chromium and
  Firefox E2E, and a standalone Tauri WebView2 smoke have passed locally.
  The latest full WebKit run did not produce final counters before the outer
  timeout, so it is not recorded as PASS.
- Preview publication still requires exact-candidate installed-app evidence v2,
  including the Windows installer artifact, four file associations, uninstall
  cleanup, multi-window journeys, and performance samples.

## Environment-Dependent Gates

- Rust dependency audit requires the `cargo-audit` subcommand locally, or a
  green CI Rust audit job with commit, URL, time, and status recorded.
- Tauri release signing/notarization is not covered by the current unsigned
  Windows NSIS release package.
- WebView2 installation uses Tauri's embedded bootstrapper. If a Windows device
  lacks WebView2 and has no network, the installer shows localized guidance but
  cannot complete dependency installation without an offline WebView2 package.

## Web App Limits

- Real local filesystem access depends on browser capability and permissions.
- Browser downloads and clipboard behavior can vary by browser security policy.
- The Web app should not be treated as equivalent to the Tauri desktop app for
  native file watching.

## Desktop App Limits

- The local preview installer path is
  `packages/app/src-tauri/target/release/bundle/nsis/JotLuck_0.1.0-preview_x64-setup.exe`.
- Tauri shell access is limited to the scoped `shell:default` capability.
  Unscoped `shell:allow-open`, `process:*`, and `fs:*` capabilities are not
  granted in the default desktop capability file.
- Notebook root, native watcher, search index, and completion retrieval state
  are isolated by window. Closing one window removes only that window's state.
- Each published installer must have its exact SHA256 recorded in the
  installed-app L4 report.
- Windows release packaging and installed desktop GUI risk validation have been
  verified for Windows x64; macOS and Linux packages still need host-specific
  release validation.
- Opening `.md/.markdown/.mdx/.txt` from Windows starts a single-file read-only
  session. It intentionally does not scan the parent directory as a notebook.
  Editing must be explicitly enabled and saves only the current file.

## Theme Import Limits

- Local `.mltheme` and `.zip` imports are a developer experimental feature.
- `trusted-code` themes may execute theme author code and may take over exposed
  UX slots. Import only themes from trusted sources.
- Current public RC behavior requires explicit user confirmation before opening
  the theme-package picker. This is disclosure and confirmation, not a sandbox
  or community-market review.

## Data And Asset Behavior

- Notes are plain text note files. The app opens `.md`, `.markdown`, `.mdx`,
  and `.txt`; the Windows installer registers JotLuck as an optional handler
  for all four extensions and does not replace the user's current default app.
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
