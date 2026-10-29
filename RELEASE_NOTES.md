# JotLuck v0.3.3 — Preview Release Notes

> Date: 2026-10-29
> Quality release on the 0.3 editor generation. v0.3.3 ships the outcome of
> a full audit-and-repair campaign: two comprehensive audit rounds (77
> findings, every one independently re-verified), a 43-defect repair batch,
> a rendering-matrix repair wave, dependency-audit cleanup, and a repaired
> CI evidence pipeline. This is also the first release resolvable via
> GitHub `releases/latest`, so the in-app update check now works end to end.
> Windows x64 round; Linux packages are unchanged from v0.14.0-preview.

## What's new in 0.3.3 — trust, correctness, cross-platform groundwork

### Review mode (改稿) made trustworthy

- The diff anchor system was rebuilt. Word-level insertions now adopt at the
  exact spot you typed (previously they landed at the start of the
  paragraph), "approve all" keeps your paragraph order when several new
  blocks share one anchor, and discarding a deleted-block note restores
  proper blank-line separation. Every decision recomputes against a fresh
  diff first — a 400 ms stale-coordinates window that could silently corrupt
  the working text is closed. Mixed regions (edit one paragraph, add
  another) adopt in working order, and annotations converge to zero instead
  of oscillating forever.

### Images, links, and external files — end to end

- Double-clicked Markdown files render their images in every session and
  view combination. The original "images show as the word 图片" report is
  fixed across read-only, editing, external-file, review-mode, and
  large-document paths.
- External editing sessions resolve local images; DOCX imports render their
  bundled images through a new zero-copy binary pipeline (no JSON byte
  arrays over IPC).
- Remote images load only after an explicit per-note choice; a single
  failed retry stays per-image.
- Native HTML headings pasted from the web no longer steal heading anchor
  ids; same-page `[[#anchor]]` links work in all three views;
  large-document progressive preview resolves in-note anchor links; a wiki
  link whose anchor cannot be found now tells you instead of doing nothing.

### DOCX import at scale

- "Save as Markdown copy" no longer intermittently corrupts documents with
  ten or more images (an asset-id prefix collision combined with unordered
  iteration; both fixed, with a regression test that exercises both
  orderings).

### Settings that take effect

- The six editor & autosave controls — font size, line height, tab width,
  word wrap, autosave on/off, autosave delay — are now wired, persisted
  across restarts, and honored by the editor and the save pipeline.

### Update check works again

- The security policy now allows the GitHub release lookup, and the settings
  page and the background check share one semver comparison (preview
  suffixes compare correctly). v0.3.3 is the first release reachable
  through `releases/latest`.

### Cross-platform groundwork

- macOS: the file-open chain consumes Open events (Finder/`open -a` file
  handoff was silently dropped); window geometry self-healing covers
  external-file windows; a vanished cold-start file degrades gracefully
  instead of aborting launch. Declared minimum system version is now 13.3,
  matching the WebKit feature baseline the UI actually uses.
- Linux: the `.desktop` launcher carries a `%f` field code so JotLuck
  appears in "Open With"; the deb now requires WebKitGTK ≥ 2.40 (the
  color-mix baseline); an unused tray dependency was dropped from the
  package.
- Durability: Unix saves fsync the parent directory after the atomic
  rename, closing a power-loss gap versus the Windows WRITE_THROUGH path.

### Editor, search, and export polish

- Ordered task items (`1. [x]`) keep their number and checkbox in live
  preview.
- The command palette is IME-safe: composition-period Enter/Escape no
  longer misfire.
- Switching notes in reading and split views resets scroll to the top.
- Template placeholders use one timezone (local) everywhere — no more
  off-by-one-day dates between midnight and 8 a.m. (UTC+8).
- Filenames are sanitized at every create/rename/template entry; `/` no
  longer silently creates subfolders.
- Index failures surface in the palette instead of masquerading as "no
  results"; clearing the search box clears the results.
- The share dialog no longer produces broken pseudo-PDFs through system
  share channels; CSV exports carry a BOM so Excel opens Chinese text
  correctly.
- IPC errors carry semantic codes (expired external-file grants, stale
  document conversions) with dedicated five-language messages.

### Completion engine

- A one-unit writing engine no longer wastes a decoder inference on every
  keystroke inside code fences (an invalid visibility threshold now skips
  candidates instead of discarding the whole response).
- Learning signals persist in batches instead of rewriting a ~230 KB
  localStorage blob on every keystroke.

### Touch reliability

- Touch suppression state survives live-preview refreshes (a plugin rebuild
  dropped the flag; real touch devices could mis-open links). Found and
  fixed through CI instrumentation.

## Fixed since v0.3.0-preview

Beyond the highlights above, this line (0.3.1–0.3.3) closed roughly 130
defects across five audit-and-repair waves: the rendering/interaction
matrix (images, external links, backlinks across every view and session),
two review batches of static and Flash audits, a six-dimension
maintainability/robustness pass (global error handling, 2× faster search,
save-floor semantics, editor chunk −37%), dependency-audit cleanup
(zip 9.1.1, calamine 0.37, vite 6.4.4 with documented transitive pins),
and an evidence-pipeline repair that ended a six-week CI red streak.

## 中文摘要

v0.3.3 是 0.3 编辑器代际的质量收口版本：改稿模式的 diff 锚点体系重建（词级精确采纳、
批量批准保序、丢弃恢复段落分隔、裁决前冲刷防陈旧坐标）；图片/外链/反链在全部视图与会话
组合下端到端可用（含 DOCX 资产零拷贝与 ≥10 图另存损坏修复）；设置页编辑器/自动保存六控件
真正接线生效；更新检查修复并首次可经 releases/latest 解析；跨平台地基补齐（macOS 文件打开
链、Linux 打开方式注册、引擎基线声明、掉电耐久）；另有时区统一、文件名消毒、IME 守卫、
索引错误出口、CSV BOM、语义化错误码等一批修复。本轮代码经两轮全面审计（77 项发现全部独立
复核）与全量 E2E 门禁验证。

## Important — Unsigned Preview

The official Windows installer for v0.3.3 is published on GitHub Releases.
Verify the SHA-256 before installing:
fd2c8c85ea4a0d3c650de73bc8054bc2720bfb51460e4206e617a35898816ac9
Code signing follows the pipeline documented in
[CODE_SIGNING.md](./CODE_SIGNING.md).

Linux x86_64 packages are unchanged in this round and remain available at
v0.14.0-preview.

---

# JotLuck v0.3.0-preview — Preview Release Notes

> Date: 2026-10-07
> Current source version: `v0.3.2` (0.3.1 and 0.3.2 are repair-line patches
> on this generation). The complete V0.2 editor generation. Version numbering
> now tracks the app generation (0.14.0 → 0.2.0 → 0.3.0), not the old
> preview counter.
> Windows x64 round; Linux packages are unchanged from v0.14.0-preview.

## What's new in 0.3.0 — the editor generation

- **Smart format continuation.** Enter continues lists, ordered lists,
  tasks, quotes, and table rows with the correct marker — Chinese
  numbering included (一、（一）① up to 九十九), plus letters, roman
  numerals, and full-width ＃－ forms. Empty items exit cleanly with
  Enter / Backspace / Esc; every continuation is a single Ctrl+Z.
- **Focused-line ghost syntax.** Markers (\*\*, #, | …) on the cursor's
  line stay visible but dimmed and fully editable, with precise click
  positioning; they fade back to clean rendering when the cursor leaves.
- **Find & replace inside the editor.** Ctrl+F opens a five-language
  search panel (regex / case / whole-word). Read-only notes stay
  searchable while editing stays blocked.
- **Slash commands.** Typing / on an empty line opens a ten-item block
  menu — headings, lists, task list, quote, code block, table template,
  divider — filterable in Chinese or ASCII (h1, table), keyboard and
  mouse driven, with full IME guards.
- **Tables that behave like a spreadsheet.** A floating toolbar appears
  when the cursor enters a table: insert/delete rows and columns, column
  alignment, delete table. Tab and Shift+Tab move between cells; Tab at
  the last cell appends a new row. Escaped pipes (\\|) and full-width ｜
  are preserved everywhere.
- **Million-character notebooks stay fluid.** 1M–3M character notes are
  editable the moment they open, render progressively while scrolling,
  and copy & print the complete text — never just the visible part.
- **Navigate by structure.** The outline follows the current chapter;
  the backlinks panel groups every reference and jumps to the exact spot
  in all three view modes, including deep jumps into unrendered regions
  of large documents.
- **Open as read-only.** Right-click a note in the drawer → “Open
  read-only”. A badge marks the state, find still works, editing is
  blocked, and one click exits.
- **Touch editing on Windows.** Precise tap positioning, swipe that only
  scrolls, native selection handles, and a finger-draggable split divider
  (30–70%).
- **New official theme: Constellation** — a frosted star-field deck.

## Fixed since 0.14.0

- DOCX export no longer loses content: blockquote text, task items (now
  ☑ / ☐), and nested list items are preserved; tables and code fences
  inside quotes keep their structure.
- Wiki-links with aliases ([[note#section|alias]]) and Markdown anchor
  links no longer export as broken literal text.
- Ordered task items (1. [x] …) are recognized end-to-end; TXT export
  keeps [x] / [ ] markers.
- Parser quirks: # comments inside code fences no longer pollute the
  outline; wiki-links and tags inside fences stay out of the index; a#b
  is no longer misread as a tag; ~~~ fences and setext headings follow
  CommonMark.
- Cancelled touch gestures no longer toggle checkboxes by accident.
- Dependency security upgrades across the workspace.

## Important — Unsigned Preview

The official Windows installer for v0.3.0-preview is published on GitHub
Releases. Verify the SHA-256 before installing:
342df185d2024b3c5bdd119f382ce0cb19b880d8dabe3423bdcc67369251ba18
Code signing follows the pipeline documented in
[CODE_SIGNING.md](./CODE_SIGNING.md).

Linux x86_64 packages are unchanged in this round and remain available at
v0.14.0-preview.

---

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
