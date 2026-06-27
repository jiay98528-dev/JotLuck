# Changelog

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
  dependency failure text, language selector, and MarkLuck icon assets.

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
- Startup background version checks now respect `markluck:version:autoCheck`.
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

- `pnpm.cmd --filter @markluck/app typecheck`: pass.
- `pnpm.cmd exec eslint packages/app/src packages/renderer/src`: pass.
- `pnpm.cmd --filter @markluck/app lint:style`: pass.
- `pnpm.cmd --filter @markluck/app exec vitest run`: pass, 156/156.
- `pnpm.cmd --filter @markluck/app build`: pass.
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
  `打包/MarkLuck-v0.15-windows-x64/MarkLuck_v0.15_x64-setup.exe`.

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
