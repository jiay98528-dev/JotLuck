# JotLuck v0.14.0-preview — Preview Release Notes

> Date: 2026-09-08
> Minor version advance from `v0.13.1-preview`. Source-level release notes;
> the Windows x64 installer for this version is not yet published.

## What's new in 0.14.0

- **Personalized completion for the V2.5 engine.** When you write, the
  engine now blends your own retained phrasing into decoding: completions
  you kept before (and your personal n-gram history) bias the model's beam
  search toward your habitual wording. This runs entirely on your machine —
  the prior never leaves the process, never touches the network, and
  sensitive content (passwords, keys, tokens) is filtered before use.
- **A settings toggle for personalization** (Settings → Text completion),
  on by default, localized in five languages. Turning it off — or clearing
  local learning data — restores byte-identical baseline decoding.
- **Quality stays gated.** Personalization only reorders candidates;
  reported model scores remain pure, so suggestions the model does not
  actually support stay hidden behind the existing visibility gates.
- **Version bumped to `0.14.0-preview`.** Minor advance over
  `0.13.1-preview`.

## Important — Unsigned Preview

The official Windows installer for `v0.14.0-preview` is published on GitHub
Releases. Verify the SHA-256 before installing:
`d78a8a0e601154c3f9c79021ffe853c1f4925866fba2f4119cbf64adef08b8f4`.
Code signing follows the pipeline documented in
[`CODE_SIGNING.md`](./CODE_SIGNING.md).

## Linux x86_64 preview pack

The same `v0.14.0-preview` source is packaged as an unsigned `.deb` on the
GitHub Release. Rebuild with
[`scripts/release/linux-preview-pack.sh`](./scripts/release/README-linux-preview.md).
AppImage is not included.

Linux-only adapters kept in tree:

- WebKitGTK DMABUF workaround (`WEBKIT_DISABLE_DMABUF_RENDERER=1` when unset)
- custom `.desktop` with Office/TextEditor categories and optional MIME types
  for `.md`, `.markdown`, `.mdx`, `.txt`, `.docx`, `.pdf`, `.xlsx`, and `.xls`.
  Installation does not replace the user's default application.

Host check: Linux Mint 22.1, Surface Go, window mapped after pack smoke.
Public `.deb`: `JotLuck_0.14.0_amd64.deb`, 23 307 002 bytes, SHA-256
`3d5f7b709c0eaf9fea2877593696c30cbc15f0a640733d208a040d8fc3a3ed77`.
AppImage was not produced (`linuxdeploy` failed).

## What's next

- Collect real-world personalization feedback (visible top-1 flips in daily
  writing) and recalibrate the fusion weight from real usage.

---

# JotLuck v0.13.1-preview — Preview Release Notes

> Date: 2026-09-08
> Patch advance from `v0.13.0-preview`. Source-level release notes; the
> Windows x64 installer for this version is not yet published.

## What's new in 0.13.1

- **The completion engine loader no longer fails silently or permanently.**
  The first load failure of the public completion engine (manifest fetch
  failure, warmup rejection, or a declined install) used to be cached for the
  lifetime of the workspace page, disabling the V2.5 engine for the whole
  session with no visible signal. Loading now leaves no failure cache,
  retries automatically with bounded backoff (up to 3 attempts, 2s/5s), and
  logs a console warning on every failure path.
- **Settings shows live completion-engine health.** Settings → Autocomplete
  now surfaces the public engine's status, last error, generated
  requests/candidates, and visible inference p90, with a manual retry action
  — in Simplified Chinese, English, French, Japanese, and Korean.
- **Version bumped to `0.13.1-preview`.** Patch advance over `0.13.0-preview`.

## Important — Unsigned Preview

The official Windows installer for `v0.13.1-preview` is not yet published.
Installers appear only on GitHub Releases and must be verified by SHA-256.
Code signing follows the pipeline documented in
[`CODE_SIGNING.md`](./CODE_SIGNING.md).

## What's next

- Publish the unsigned Windows x64 installer for `v0.13.1-preview` on GitHub
  Releases, with SHA-256 and Authenticode status recorded here.

---

# JotLuck v0.13.0-preview — Preview Release Notes

> Date: 2026-09-06
> Minor version advance from `v0.12.3-preview`. Source-level release notes; the
> Windows x64 installer for this version is not yet published.

## What's new in 0.13.0

- **V2.5 completion engine integrated.** The bilingual one-unit writing
  engine is wired in through the canonical manifest and is enabled by
  default. When the model artifact is missing on the host, completion
  silently falls back to the built-in engine so existing behavior is
  preserved.
- **Single-character Chinese completions are accepted.** Validator v5 now
  treats a single Chinese character as a valid token, fixing inline
  completions for short Chinese inputs that the previous validator
  rejected.
- **Version bumped to `0.13.0-preview`.** Minor version advance over
  `0.12.3-preview`.

## Important — Unsigned Preview

The official Windows installer for `v0.13.0-preview` is not yet published.
Until a build is uploaded, this section mirrors the 0.12.3-preview process:
installers appear only on GitHub Releases and must be verified by SHA-256.
Code signing follows the pipeline documented in
[`CODE_SIGNING.md`](./CODE_SIGNING.md).

## What's next

- Publish the unsigned Windows x64 installer for `v0.13.0-preview` on
  GitHub Releases, with SHA-256 and Authenticode status recorded here.
- Continue macOS / Linux packaging work.

---

# JotLuck v0.12.3-preview — Preview Release Notes

> Date: 2026-09-02
> This document describes the current public Windows x64 preview source track.
> The latest published installer remains unsigned and is not a stable release.

## Important — Unsigned Preview

JotLuck `v0.12.3-preview` is the current public source and Windows NSIS preview available only on GitHub Releases; verify SHA-256 `17681727cdefb993a8c5604907cff25cbaba50b72363ebbec247328d50873a37` before installing. Windows code signing is in progress and follows the pipeline in [`CODE_SIGNING.md`](./CODE_SIGNING.md): installed-app evidence capture, submission through an approved signing service, Authenticode verification, and a post-sign SHA-256 check.

## What's new in 0.12.3

- **Failed link opens are no longer silent.** When the system browser cannot be opened from a note, JotLuck now logs the failure and shows a localized notice instead of doing nothing. The update-notification release link and share-via-email now use the same system opener, and `mailto:` links without a recipient are explicitly allowed by a narrowed shell-open allowlist (`mailto:`/`tel:`/`https?:` only).
- **No more dead right-click menu.** The WebView default context menu (back/refresh/save-as items that do nothing in a desktop app) is suppressed outside editable surfaces. Right-click copy/paste in inputs and the editor keeps working, and custom menus such as the file-tree context menu are unchanged.
- **Cold start is several times faster.** The workspace module graph is preloaded at document start, the startup bootstrap IPC is shared instead of issued twice, and search indexing plus custom-template loading run after the first frame instead of blocking it. On the reference machine the production build reaches the editable shell in roughly 0.2s, previously 1–2s.

## Highlights

- **Web links open in the default browser.** Markdown links leave the desktop WebView through the system shell in read mode, split preview, external read-only documents, and Live Preview. The web build keeps its normal new-tab behavior.
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

This preview installer has SHA-256 `efeba410d5747358a286468720f9c4fc448ac0c9286fdff1dcc0fa63a77c9494`; Authenticode status is `NotSigned`. The package reports FileVersion and ProductVersion `0.12.2` and has a size of 6,170,645 bytes.

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
