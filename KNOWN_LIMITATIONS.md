# Known Limitations

This document describes limitations for MarkLuck `0.3.0-rc.1`. These are not
marketing claims; they are the remaining release constraints and expected
behavior boundaries.

## Release Candidate Status

- `0.3.0-rc.1` is a release candidate.
- M-R7 final release-candidate validation has completed and reached the final
  stop point.
- Do not describe this build as the final stable release until the user accepts
  the RC and the remaining environment gates are either run or formally waived.

## Environment-Dependent Gates

- Playwright WebKit is blocked unless the WebKit browser binary is installed.
- Rust dependency audit is blocked unless `cargo-audit` is installed.
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

- The latest verified package is an unsigned Windows NSIS release installer at
  `打包/MarkLuck-0.3.0-rc.1-windows-x64/MarkLuck_0.3.0-rc.1_x64-setup.exe`.
- The latest verified SHA256 is
  `9b3d1f5fcec77996c1f8d5d046fe6724edda9baf425647bd848b68a7abcb8d8b`.
- Windows release packaging and installed desktop GUI risk validation have been
  verified; macOS and Linux packages still need host-specific release
  validation.
- Opening `.md/.markdown/.mdx` from Windows starts a single-file read-only
  session. It intentionally does not scan the parent directory as a notebook.
  Editing must be explicitly enabled and saves only the current file.

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
