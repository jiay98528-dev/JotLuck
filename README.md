# MarkLuck

MarkLuck is a lightweight, local-first Markdown notebook. Each note is a plain
text note file (`.md`, `.markdown`, `.mdx`, or `.txt`), and each folder is a
notebook. The app adds editing, search, backlinks, templates, export, image
assets, and offline completion without locking user data into a database.

Current release channel: `v0.15`.

This is a release candidate, not a final stable release. The current hardening
work has reached the M-R7 final stop point plus the desktop RC risk-validation
pass and the follow-up external-file hotfix pass. Chromium full E2E, Firefox
risk journeys, the installed Windows desktop GUI flow, and the Tauri release
package have passed; WebKit and `cargo audit` remain environment-blocked on
this machine.

## Core Principles

- Notes remain local plain text note files.
- Notebook data is not uploaded.
- Images are written into an `assets/` directory in the notebook.
- The Web app can run in a mock/local browser mode; the Desktop app uses Tauri
  and the real filesystem.
- Offline completion uses local models and notebook training data only.

## Features

- Markdown editing with CodeMirror 6.
- Live Preview with block-level editing.
- Wiki-link syntax: `[[note]]`, aliases, dead/live link styling, and backlinks.
- Full-text search with keyword, regex, tag, date, and folder filters.
- File drawer, recent notes, outline, tags, and backlink panels.
- Built-in and custom templates with placeholders such as `{{date}}`.
- Image paste/drop/file upload into notebook `assets/`.
- Export to PDF, DOCX, XLSX, CSV, TXT, and HTML.
- Single-line offline ghost text completion with Tab acceptance.
- Paper layout, responsive dialogs, and keyboard-accessible switches.
- Tauri desktop build with real filesystem IPC and file watching.

## Install And Run

### Requirements

- Node.js 20+
- pnpm 11.x, or at least pnpm 9+
- Rust 1.77.2+ for Tauri development
- Platform dependencies required by Tauri for desktop packaging

### Web Development

```powershell
pnpm.cmd install
pnpm.cmd --filter @markluck/app dev
```

The default Vite dev URL is usually `http://localhost:5173/`.

### Web Build

```powershell
pnpm.cmd --filter @markluck/app build
pnpm.cmd --filter @markluck/app preview
```

### Desktop Development

```powershell
pnpm.cmd --filter @markluck/app tauri:dev
```

### Desktop Release Package

```powershell
pnpm.cmd --filter @markluck/app tauri:build
```

The latest verified Windows NSIS release installer is copied to
`打包/MarkLuck-v0.15-windows-x64/MarkLuck_v0.15_x64-setup.exe`.
The latest verified SHA256 is
`ace8db6f110eb13f3f7ad159fe25be309d7b8223f1515eb151c0e76fb30cac10`.

External `.md/.markdown/.mdx` files opened from Windows start in a single-file
read-only preview. MarkLuck does not scan the parent folder or add it as a
notebook unless the user explicitly opens that folder as a notebook. `.txt`
remains an app-internal note format and is not registered as a system launch
format.

## Release Verification

Useful release-gate commands:

```powershell
pnpm.cmd --filter @markluck/app typecheck
pnpm.cmd exec eslint packages/app/src packages/renderer/src
pnpm.cmd exec prettier --check packages/app/src packages/renderer/src e2e spec memory README.md CHANGELOG.md RELEASE_NOTES.md KNOWN_LIMITATIONS.md
pnpm.cmd --filter @markluck/app lint:style
pnpm.cmd --filter @markluck/app exec vitest run
pnpm.cmd --filter @markluck/app build
pnpm.cmd --filter @markluck/app exec playwright test --project=chromium --workers=1
pnpm.cmd --filter @markluck/app exec playwright test --project=firefox --workers=1
pnpm.cmd audit --audit-level high
pnpm.cmd --filter @markluck/app tauri:build
```

Known environment-dependent gates:

- WebKit Playwright requires the WebKit browser binary to be installed.
- `cargo audit` requires the `cargo-audit` subcommand.
- Final release validation includes manual GUI journeys. The current RC pass
  covered the tool in-app browser journey and an installed Windows desktop GUI
  risk pass for `.mdx` launch, file-drawer filtering, `.txt` opening, default
  documents, Chinese IME + Live Preview, Tab focus navigation, and welcome-page
  default-app guidance.

## Web And Desktop Capability Notes

| Area                | Web app                                                     | Desktop app                               |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Note storage        | Browser/mock or File System Access depending on environment | Real local filesystem through Tauri IPC   |
| File watching       | Limited by browser capability                               | Native file watcher through Rust `notify` |
| Binary image writes | Supported by app abstraction; browser capability may vary   | Supported by Tauri binary IPC             |
| Packaging           | Vite build                                                  | Tauri release bundle                      |
| System dialogs      | Browser-limited                                             | Tauri dialog plugin                       |

## User Data Safety

- Notes are plain text note files in the selected notebook folder.
- The app does not upload notebook content.
- Images pasted into notes are written to `assets/img_*` files.
- Deleting a note removes the note entry and related indexes; image assets are
  not automatically deleted because assets can be shared by multiple notes.
- Exported files are generated from the current Markdown content and downloaded
  or written through the platform export path.

## Documentation

- Release notes: [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- Known limitations: [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)
- Product requirements: [doc/PRD.md](./doc/PRD.md)
- Technical architecture: [doc/TAD.md](./doc/TAD.md)
- Release hardening log:
  [memory/release-hardening-execution-log.md](./memory/release-hardening-execution-log.md)
- Final RC report:
  [memory/release-candidate-final-report.md](./memory/release-candidate-final-report.md)

## License

MIT
