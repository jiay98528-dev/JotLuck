# Changelog

## [0.11.2-preview] - 2026-08-12

### Fixed

- Keep the Lumen Field bottom command-deck handle inside the visible window when editing an
  external single file below its session banner.
- Size application shells from their assigned layout track so external edit chrome cannot hide
  drawer controls or status tools below the viewport.

### Distribution

- Published as an unsigned Windows preview hotfix. It includes the read-mode recovery fixes
  recorded under `v0.11.1-preview`; no separate public installer was released for that
  intermediate candidate, and the existing `v0.11.0-preview` asset remains available.

## [0.11.1-preview] - 2026-08-11

### Fixed

- Keep the read-only mode recovery action in a sticky reader bar across the bundled theme
  configurations.
- Transfer focus to “Return to edit” when entering read-only mode and restore focus to the
  editor when leaving it.
- Preserve the sticky recovery action inside Halo Canvas by making its reader workbench the
  vertical scroll owner.

### Distribution

- Intermediate unsigned Windows preview candidate. These fixes are included in
  `v0.11.2-preview`; no public installer was released under this version.

## [0.10.0-rc.1] - 2026-07-31

### Release Candidate

- First public release candidate. Not a stable release. NSIS installer is unsigned.
- Windows SmartScreen will warn on first launch; click "More info → Run anyway".
- See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for highlights, upgrade notes, and known issues.

### Verification

- `pnpm.cmd --filter @jotluck/app typecheck` — pass
- `pnpm.cmd --filter @jotluck/app test` — pass, 156/156
- `pnpm.cmd --filter @jotluck/app build` — pass
- Chromium E2E — pass
- Firefox E2E — pass
- Tauri release build — pass
- `pnpm.cmd release:rc-gate` — pass

### Known Environment Blockers

- macOS / Linux packaging not yet started
- Code signing pending SignPath Foundation approval
- Cargo audit reports allowed unsoundness warnings for `lru 0.12.5` and `memmap2 0.9.10` (transitive via tantivy 0.22.1)

## [v0.15] - 2026-06-25

### Added

- Release hardening execution log covering M-R0 through M-R7 progress.
- Stable Playwright scripts for single-worker Chromium, Firefox, and WebKit
  release validation.
- Core user-journey E2E coverage for create/edit/save/delete, file drawer,
  search, live preview, context menu operations, export, security, responsive
  dialogs, and accessibility switches.
- Network privacy E2E proving that GitHub update checks are not requested when
  automatic version checks are disabled.
- XLSX export E2E proving downloaded workbooks are non-empty ZIP/XLSX
  containers.
- Release notes and known limitations documents.
- Final RC report at `memory/release-candidate-final-report.md`.
- Windows NSIS release package output under `打包/`, with localized WebView2
  dependency failure text, language selector, and JotLuck icon assets.

### Changed

- Unified Web, app package, Tauri config, and Rust crate versions to
  `0.15.0`.
- Replaced the vulnerable SheetJS `xlsx` runtime dependency with
  `write-excel-file@4.1.1`.
- Updated export documentation to reflect the current XLSX implementation.
- Moved dependency overrides to `pnpm-workspace.yaml`, where pnpm v11 reads
  them.
- Removed the stale npm `package-lock.json`; `pnpm-lock.yaml` is the only
  authoritative package lockfile.
- Updated Vite to `6.4.3`, Vitest to `3.2.6`, and forced `undici@^7.28.0` for
  the current dependency graph.

### Fixed

- Deleted notes no longer leave orphan recent-note/bookmark entries in the left
  wing after refresh.
- Tauri filesystem path resolution now treats frontend paths such as `/note.md`
  as notebook-root-relative paths instead of OS absolute paths.
- Removed obsolete Tauri v2 `plugins.fs.scope` configuration that caused
  desktop startup panic.
- Startup background version checks now respect `jotluck:version:autoCheck`.
- XLSX export without Markdown tables now generates a valid workbook instead of
  an empty `.xlsx` file.
- Responsive modal and command palette constraints now avoid small-viewport
  overflow.
- Export option toggles now expose switch semantics and keyboard operation.
- Final build chunk warning was resolved by async modal loading and manual
  vendor chunks.
- Windows Playwright web-server startup now uses `pnpm.cmd` and a longer
  timeout.
- Tracked Playwright HTML report output was removed and ignored.
- Desktop external file-open now uses a single-file session for
  `.md/.markdown/.mdx`: it opens in read-only preview, skips WelcomePage,
  avoids parent-folder scans, and only edits the current file after explicit
  confirmation.
- Default desktop sample notebook documents are restored on first launch.
- Chinese IME input no longer destabilizes Live Preview block mapping.
- Immediate-mode Markdown table rendering no longer collapses columns or lets
  numeric alignment make Chinese headers/body text stick together.
- Tab only accepts visible ghost text while the CodeMirror editor owns focus;
  dialogs and controls keep native focus navigation.
- Welcome-page default-app guidance no longer claims Windows can be changed
  silently; it opens system settings or shows manual instructions.
- Supported note formats are unified across the drawer, index, watcher,
  training, launch arguments, and installer registration. The app edits
  `.md`, `.markdown`, `.mdx`, and `.txt`; Windows registration covers the
  Markdown family `.md/.markdown/.mdx` without hijacking `.txt`.
- Windows icon assets were regenerated from enlarged masters so desktop
  shortcuts use the expected visual footprint.

### Verification Snapshot

- `pnpm.cmd --filter @jotluck/app typecheck`: pass.
- `pnpm.cmd exec eslint packages/app/src packages/renderer/src`: pass.
- `pnpm.cmd --filter @jotluck/app lint:style`: pass.
- `pnpm.cmd --filter @jotluck/app exec vitest run`: pass, 156/156.
- `pnpm.cmd --filter @jotluck/app build`: pass.
- `pnpm.cmd audit --audit-level high`: pass; low/moderate advisories remain.
- Chromium full E2E: pass, 167/167 before the final table padding tweak; the
  table journey was rechecked after that tweak.
- Firefox risk suite `e2e/tests/16-user-journeys.spec.ts`: pass, 10/10.
- In-app browser GUI journey: pass for create/edit/save/refresh/delete, file
  drawer, search, Live Preview, settings, theme persistence, and export success.
- Installed Windows desktop GUI risk validation: pass for external Markdown
  read-only launch, explicit edit/save, no parent scan, immediate table
  rendering, default documents, Chinese IME + Live Preview, Tab focus
  navigation, and welcome-page default-app guidance.
- Tauri release build: pass, Windows NSIS installer generated at
  `打包/JotLuck-v0.10.0-rc.1-windows-x64/JotLuck_0.10.0-rc.1_x64-setup.exe`.

### Known Environment Blockers

- WebKit validation requires the Playwright WebKit browser binary.
- Rust dependency audit requires `cargo-audit`.

## [0.2.0] - 2026-06-09

### Added

- Offline text completion with single ghost text suggestions.
- N-gram prediction engine.
- CodeMirror ghost text plugin.
- Baseline completion training corpus and training script.
- Settings entry for text completion.

### Changed

- Tab prioritizes accepting visible ghost text before falling back to normal
  editor behavior.
- Live Preview block pinning moved to `Ctrl+Click`.

## [0.1.0] - 2026-06-04

### Added

- Markdown editor based on CodeMirror 6.
- Wiki-link parsing, backlinks, tags, outline, and file tree.
- Full-text search with MiniSearch.
- Export support for PDF, DOCX, XLSX, CSV, TXT, and HTML.
- Template system with built-in and custom templates.
- Formatting toolbar and common keyboard shortcuts.
- Paper layout.
- Tauri v2 desktop backend with filesystem, search, watcher, and path safety
  foundations.
- DOMPurify-based Markdown rendering safety.
- Initial Playwright E2E coverage.
