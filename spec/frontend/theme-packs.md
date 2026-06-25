# Theme Pack v1 Architecture

> Status: Draft for implementation
> Scope: controlled deep theming, local packs, future market compatibility

## Goal

MarkLuck currently ships as a single Paper visual system with light/dark color schemes. Theme Pack v1 adds a controlled package model that can materially change the product appearance while keeping editing, saving, file access, search, export, focus handling, and safety prompts intact.

The first release is deliberately CSS-only. It supports official bundled themes and local `.markluck-theme` imports. It does not execute third-party JavaScript and does not allow themes to replace Vue components directly.

## Pack Format

A `.markluck-theme` file is a zip archive with this structure:

```text
manifest.json
theme.css
assets/
preview/
```

`manifest.json` is required:

```json
{
  "id": "markluck.theme.archive",
  "version": "1.0.0",
  "themeApi": 1,
  "runtime": "css-v1",
  "minAppVersion": "0.15.0",
  "name": "Archive",
  "author": "MarkLuck",
  "description": "A quiet archive desk theme.",
  "capabilities": ["tokens", "assets", "animations", "layout-preset", "markdown", "codemirror"],
  "layoutPreset": "archive",
  "checksums": {
    "theme.css": "sha256-..."
  }
}
```

Required fields:

- `id`: globally unique, lowercase reverse-domain or slug form.
- `version`: semantic version.
- `themeApi`: `1`.
- `runtime`: only `css-v1` is accepted in Theme Pack v1.
- `minAppVersion`: minimum compatible MarkLuck version.
- `name`: display name.
- `author`: display author.
- `capabilities`: declared surface area.
- `layoutPreset`: one of `winged`, `focus`, `archive`, `reader`, `studio`.
- `checksums`: map for package integrity. v1 validates declared files when present and rejects malformed checksum strings.

Optional fields:

- `description`
- `homepage`
- `license`
- `previewImages`
- `price`, `category`, `tags` for future market catalog display.

## Runtime Model

### Theme Registry

`ThemeRegistry` owns three sources:

- Built-in themes bundled with the app.
- Imported local themes stored in browser/WebView persistence.
- Future market themes backed by the same manifest surface.

It exposes a single list of installable/installed themes. The app does not need to know whether a theme came from a bundled package, local import, or future online catalog.

### Theme Pack Installer

`ThemePackInstaller` validates and installs a `.markluck-theme` zip:

1. Parse zip and reject path traversal, absolute paths, Windows drive paths, or backslash-normalized traversal.
2. Parse `manifest.json`.
3. Require `runtime: "css-v1"` and `themeApi: 1`.
4. Require an allowed `layoutPreset`.
5. Read `theme.css`.
6. Reject unsafe CSS:
   - `@import`
   - remote URLs (`http:`, `https:`, protocol-relative)
   - `javascript:`
   - script-like HTML payloads
   - browser legacy executable CSS such as `expression()` or `behavior:`
   - selectors that hide or disable critical controls by class name.
7. Enforce size limits:
   - CSS: 256 KB
   - single asset: 2 MB
   - total unpacked package: 8 MB
8. Store the installed pack.

If activation fails, the runtime rolls back to Paper and reports a visible error in settings.

## Theme Store State

`useThemeStore` expands from a color-scheme toggle to:

- `activeThemeId`
- `colorScheme`
- `installedThemes`
- `activeLayoutPreset`

The runtime writes:

```html
<html data-theme-id="paper" data-color-scheme="light" data-layout-preset="winged"></html>
```

The legacy `markluck-theme` localStorage key remains a light/dark compatibility mirror. The v2 state is stored separately and migrates old string and old `{ "c": "dark" }` JSON values.

## Layout Presets

Theme Pack v1 can select an app-shell preset but cannot replace components:

- `winged`: default three-zone writing desk.
- `focus`: reduced side density for long-form writing.
- `archive`: heavier file and index surfaces, suitable for document collections.
- `reader`: wider reading surface and calmer side panels.
- `studio`: denser controls for template-heavy or production workflows.

Preset CSS must preserve:

- TopBar controls.
- left bookmark/folder/settings entry points.
- right outline/backlink/tag panels when the app shows them.
- modal/dialog focus rings.
- editor content, status bar, save indicators, and destructive confirmations.

## CSS Contract

Theme CSS may override public variables:

- surfaces: `--paper-bg`, `--paper-left`, `--paper-surface`, `--paper-right`, `--paper-raised`
- ink: `--ink-primary`, `--ink-secondary`, `--ink-muted`
- accent/state: `--accent`, `--accent-hover`, `--accent-soft`, signals
- typography: `--ff-body`, `--ff-mono`, text scale, line height
- layout: wing widths, editor width, drawer width
- shape/elevation: radius and shadows
- Markdown: code, table, links, blockquote, highlights
- CodeMirror: editor bg, cursor, selection, gutter, line highlight
- theme hooks: `--theme-bg-image`, `--theme-bg-opacity`, `--theme-crest-image`, `--theme-crest-opacity`

Theme CSS may target stable public hooks such as `.app-shell`, `.editor-area`, `.markdown-body`, `.cm-editor`, `.left-wing`, `.right-wing`, `.topbar`, and `.modal-card`. It must not hide safety-critical controls or remove focus visibility.

## Settings UI

Settings gains a first-level "主题" entry:

- current theme
- built-in themes
- installed themes
- import `.markluck-theme`
- enable / uninstall / restore default
- compatibility and security errors
- future market placeholders: category, author, price/status, update status

The UI is a task surface, not a store landing page. It should show concrete state and actions without card clutter or marketing copy.

## Future Market and Plugin Path

The manifest reserves:

```json
{ "runtime": "sandboxed-plugin-v2" }
```

This runtime is rejected by v1. A future v2 may use a sandboxed iframe/WebView host or controlled plugin API to render third-party components. It must not retroactively expand `css-v1` into arbitrary JS execution.

Template packs and export theme packs should reuse the same manifest, installer, checksum, version compatibility, install/uninstall, rollback, and market catalog infrastructure.

## Tests

Required unit coverage:

- manifest parsing
- version/API compatibility
- unsafe CSS rejection
- remote URL rejection
- traversal rejection
- unsupported runtime rejection
- size limits
- legacy theme-state migration
- activation rollback

Required E2E coverage:

- import pack
- enable pack
- refresh persistence
- restore Paper
- uninstall active pack and auto-fallback

Required GUI acceptance:

- Paper remains default and stable.
- At least three official themes are selectable.
- Editor, search, file drawer, settings, export, live preview, and external readonly/edit mode remain usable under a non-Paper theme.
- Theme switching never scans notebooks, rebuilds indexes, or loses unsaved editor content.
