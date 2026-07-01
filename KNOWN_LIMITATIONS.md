# Known Limitations

This document describes limitations for MarkLuck `v0.15.0-rc.1`. These are not
marketing claims; they are the remaining release constraints and expected
behavior boundaries.

## Release Candidate Status

- `v0.15.0-rc.1` is a release candidate, not a final stable release.
- L1/L2, coverage, build, Rust fmt/check/test, Tauri packaging,
  Chromium/Firefox/WebKit E2E, and GUI smoke have passed in the final external
  audit.
- Final publication still requires a completed real-installer L4 report and
  Rust audit evidence from CI or a local `cargo-audit` run.

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

- The RC installer path is
  `packages/app/src-tauri/target/release/bundle/nsis/MarkLuck_0.15.0_x64-setup.exe`.
- Each published installer must have its exact SHA256 recorded in the
  installed-app L4 report.
- Windows release packaging and installed desktop GUI risk validation have been
  verified for Windows x64; macOS and Linux packages still need host-specific
  release validation.
- Opening `.md/.markdown/.mdx` from Windows starts a single-file read-only
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
  and `.txt`; Windows default-app registration covers `.md/.markdown/.mdx` and
  intentionally does not take over `.txt`.
- `.txt` is an app-internal note format only. It is not accepted as a
  system-level external launch format and is not registered by the installer.
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
