# MarkLuck v0.15 Release Notes

Date: 2026-06-25

This release candidate focuses on release hardening, not new product scope. It
collects the Web application, Tauri desktop path fixes, security/dependency
cleanup, user-journey test coverage, and final M-R7 release-candidate gate
evidence into one reviewable candidate.

## Highlights

- Core Markdown notebook workflows are covered by release E2E tests.
- Recent-note/bookmark state is cleaned when notes are deleted.
- Tauri desktop startup and notebook-root path resolution have been fixed.
- Desktop file-open now supports Markdown-family launch arguments as a
  single-file session: external `.md/.markdown/.mdx` opens in a full-window
  read-only preview first, does not scan the parent folder, and only enables
  editing after explicit confirmation.
- The file drawer, index, watcher, training, launch arguments, and installer now
  share the supported note-format contract: `.md`, `.markdown`, `.mdx`, and
  `.txt` inside the app; `.md/.markdown/.mdx` for Windows registration.
- Default desktop sample documents are restored for first-run onboarding.
- Chinese IME + Live Preview, immediate-mode table rendering, and Tab focus
  navigation regressions have been closed.
- Startup update checks no longer contact GitHub when automatic checks are
  disabled.
- High-severity npm audit findings have been removed from the current pnpm
  dependency graph.
- XLSX export no longer depends on SheetJS `xlsx`; it uses
  `write-excel-file`.

## Validation Matrix

| Gate                      | Status              | Evidence                                                      |
| ------------------------- | ------------------- | ------------------------------------------------------------- |
| TypeScript                | Passed              | `pnpm.cmd --filter @markluck/app typecheck`                   |
| ESLint                    | Passed              | `pnpm.cmd exec eslint packages/app/src packages/renderer/src` |
| Stylelint                 | Passed              | `pnpm.cmd --filter @markluck/app lint:style`                  |
| Unit tests                | Passed              | `vitest` 156/156                                              |
| Web build                 | Passed              | Vite build completed                                          |
| High npm audit            | Passed              | Remaining advisories are low/moderate                         |
| Chromium E2E              | Passed              | 167/167 full run; table journey rechecked after final CSS fix |
| Firefox risk suite        | Passed              | `16-user-journeys` 10/10                                      |
| In-app browser manual GUI | Passed              | Core GUI journey closed in tool browser                      |
| Installed desktop GUI     | Passed              | external read-only open, explicit edit/save, table, IME, Tab  |
| Tauri release build       | Passed              | NSIS release installer generated in `打包/`                   |
| WebKit E2E                | Environment blocked | Browser binary missing                                        |
| Rust audit                | Environment blocked | `cargo audit` subcommand missing                              |

## Upgrade And Data Notes

- Notes remain plain text files. The app opens and manages `.md`, `.markdown`,
  `.mdx`, and `.txt` files as notes.
- Windows installer registration covers `.md`, `.markdown`, and `.mdx`.
  MarkLuck intentionally does not hijack the default `.txt` association.
- External Markdown-family files opened from Windows use a single-file
  read-only session by default. Enabling edit mode saves only that file and
  does not add the parent directory as a notebook.
- Existing notebooks do not require migration.
- Local completion/training metadata may be refreshed automatically, but it is
  stored locally.
- Image assets remain in notebook `assets/` folders.
- Note deletion does not automatically remove image assets, to avoid deleting
  shared files.

## Final RC Result

M-R7 reached the final stop point on 2026-06-24. The current RC can proceed to
user final review with two environment blockers recorded:

- WebKit E2E requires installing the Playwright WebKit browser binary.
- Rust dependency audit requires installing `cargo-audit`.

Final evidence is recorded in
`memory/release-candidate-final-report.md`.

## Desktop External File Hotfix Addendum

After the initial RC report, an installed-desktop regression was found where
opening a Markdown file from the OS could scan Desktop/Downloads as a notebook
and pollute tags/recent state. This has been fixed by replacing external
file-open with the single-file read-only/edit session described above.

Current package hash supersedes earlier RC hashes:

- Installer: `打包/MarkLuck-v0.15-windows-x64/MarkLuck_v0.15_x64-setup.exe`
- SHA256: `ace8db6f110eb13f3f7ad159fe25be309d7b8223f1515eb151c0e76fb30cac10`
