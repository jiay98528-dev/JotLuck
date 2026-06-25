# Theme Pack v1 Architecture

> Status: Draft for implementation
> Scope: controlled deep theming, local packs, future market compatibility

## Goal

MarkLuck ships with the default `paper` theme ID displayed as “羽翼布局”, plus light/dark color schemes. Theme Pack v1 adds a controlled package model that can materially change the product appearance while keeping editing, saving, file access, search, export, focus handling, and safety prompts intact.

The first release has two permission levels:

- Official bundled themes can use controlled workflow profiles: layout preset, default view mode, action placement, UI density, local flat texture assets, role, performance level, and built-in ambient effects.
- Local `.markluck-theme` imports remain CSS skin themes. They can override public tokens and safe CSS hooks, but cannot receive official UI profiles, performance badges, app layout authority, or JavaScript execution.

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

Current official built-in themes:

- `paper` / 羽翼布局: baseline three-zone writing desk, `winged`, performance 1.
- `markluck.ink-study` / 墨线书房: collectible daytime writing room with flat ink-paper texture, `focus`, performance 3.
- `markluck.archive` / 档案馆: research workflow theme with heavier file/index surfaces, `archive`, performance 2.
- `markluck.reader-nocturne` / 夜读星幕: collectible dark reading theme with flat star-dust texture, `reader`, performance 4.
- `markluck.studio` / 工坊轨道: production workflow theme with compact tool rails, `studio`, performance 2.

### Official Theme Profile

Official themes may attach an internal `OfficialThemeProfile`. Imported themes never persist or load this field.

```typescript
interface OfficialThemeProfile {
  role: 'baseline' | 'workflow' | 'collectible';
  headline: string;
  story: string;
  bestFor: string[];
  visualFeatures: string[];
  uiProfile: {
    toolbarDensity: 'calm' | 'compact' | 'productive';
    sidebarMode: 'balanced' | 'research' | 'quiet' | 'rail';
    drawerEmphasis: 'low' | 'medium' | 'high';
    readingWidth: 'standard' | 'wide' | 'immersive' | 'compact';
    motionIntensity: 'none' | 'low' | 'medium' | 'high';
  };
  performanceLevel: 1 | 2 | 3 | 4 | 5;
  effectProfile: 'none' | 'subtle' | 'ambient' | 'immersive';
  previewImage?: string;
  backgroundAsset?: string;
}
```

### Theme Workflow Chrome

Official profiles are mapped by `useThemeStore` to `ThemeChromeState`. The workflow portion is first-party only:

```typescript
interface ThemeChromeState {
  workspaceIntent: 'baseline' | 'writing' | 'archive' | 'reader' | 'studio';
  defaultViewMode: 'live' | 'split' | 'read';
  topBarLayout: 'classic' | 'title-first' | 'search-first' | 'reader' | 'compact';
  leftWingLayout: 'bookmarks' | 'quiet-bookmarks' | 'research-stack' | 'studio-rail';
  editorControlLayout: 'toolbar' | 'writing-strip' | 'hidden' | 'studio-rail';
  statusLayout: 'full' | 'quiet' | 'save-only' | 'compact';
  rightWingPolicy: 'outline' | 'research' | 'collapsed' | 'production';
  actionPlacements: Record<
    | 'new-note'
    | 'file-drawer'
    | 'search'
    | 'template'
    | 'export'
    | 'share'
    | 'settings'
    | 'theme-toggle'
    | 'view-toggle',
    | 'topbar-left'
    | 'topbar-center'
    | 'topbar-right'
    | 'left-wing'
    | 'editor-control'
    | 'studio-rail'
    | 'reader-bar'
    | 'hidden'
  >;
}
```

`NotebookHome` owns the action handlers and exposes a `ShellAction[]` to `AppShell`. `TopBar`, `LeftWing`, `EditorControlStrip`, `StudioRail`, and the reader bar render the same actions according to `actionPlacements`, so moving controls between regions does not fork event logic.

Official workflow presets:

| Theme    | Intent     | Default View | Main UX changes                                                                                                       |
| -------- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 羽翼布局 | `baseline` | `live`       | classic TopBar, bookmark LeftWing, editor toolbar, outline-first RightWing                                            |
| 墨线书房 | `writing`  | `live`       | title-first TopBar, quiet bookmarks, centered writing canvas, collapsed RightWing, narrow writing strip               |
| 档案馆   | `archive`  | `split`      | search-first TopBar, research LeftWing, backlinks/tags first, wider RightWing                                         |
| 夜读星幕 | `reader`   | `read`       | rendered read mode, no editor toolbar, collapsed RightWing, save-only status                                          |
| 工坊轨道 | `studio`   | `split`      | vertical StudioRail owns template/export/share/view actions and format controls, compact TopBar, production RightWing |

Performance levels are user-facing:

| Level | Label | Intended cost                                  |
| ----- | ----- | ---------------------------------------------- |
| 1     | 轻盈  | token/layout only, no extra rendering pressure |
| 2     | 标准  | small layout and shadow differences            |
| 3     | 增强  | local flat background texture and light motion |
| 4     | 沉浸  | richer local effect layer, reduced-motion safe |
| 5     | 重载  | reserved for future advanced official themes   |

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
   - official-only deep chrome selectors or layout control variables such as `--wing-*`, `--drawer-width`, `--topbar-height`, `--statusbar-height`, `--editor-max-width`, `data-effect-profile`, and `data-chrome-*`.
7. Enforce size limits:
   - CSS: 256 KB
   - single asset: 2 MB
   - total unpacked package: 8 MB
8. Store the installed pack.

If activation fails, the runtime rolls back to the default `paper` theme and reports a visible error in settings.

## Theme Store State

`useThemeStore` expands from a color-scheme toggle to:

- `activeThemeId`
- `colorScheme`
- `installedThemes`
- `activeLayoutPreset`
- `activeChromeState`
- official view models derived from `ThemeRegistry`

The runtime writes:

```html
<html
  data-theme-id="paper"
  data-color-scheme="light"
  data-layout-preset="winged"
  data-theme-role="baseline"
  data-effect-profile="none"
  data-theme-performance="1"
  data-chrome-topbar="balanced"
  data-chrome-left-wing="default"
  data-chrome-right-wing="balanced"
  data-chrome-toolbar="calm"
  data-chrome-drawer="medium"
  data-chrome-reading="standard"
  data-workspace-intent="baseline"
  data-default-view-mode="live"
  data-topbar-layout="classic"
  data-left-wing-layout="bookmarks"
  data-editor-control-layout="toolbar"
  data-status-layout="full"
  data-right-wing-policy="outline"
></html>
```

For imported/local themes, `data-theme-role`, `data-effect-profile`, and `data-theme-performance` are removed, and `activeChromeState` falls back to the safe `winged` app shell with baseline workflow chrome. Local manifests may keep `layoutPreset` for compatibility metadata, but imported themes do not receive official workflow layout or action placement authority at runtime.

The legacy `markluck-theme` localStorage key remains a light/dark compatibility mirror. The v2 state is stored separately and migrates old string and old `{ "c": "dark" }` JSON values.

## Layout Presets

Official Theme Pack v1 profiles select an app-shell workflow preset but cannot replace components. Imported `.markluck-theme` packages do not select runtime presets; they use the safe `winged` shell.

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
- shape/elevation: radius and shadows
- Markdown: code, table, links, blockquote, highlights
- CodeMirror: editor bg, cursor, selection, gutter, line highlight
- theme hooks: `--theme-bg-image`, `--theme-bg-opacity`, `--theme-crest-image`, `--theme-crest-opacity`

Theme CSS may target stable public hooks such as `.app-shell`, `.editor-area`, `.markdown-body`, `.cm-editor`, `.left-wing`, `.right-wing`, `.topbar`, and `.modal-card`. It must not hide safety-critical controls or remove focus visibility.

Deep chrome is implemented by first-party Vue components through `ThemeChromeState`, not by imported CSS. Official themes may change default view mode, TopBar layout, LeftWing layout, editor control layout, StatusBar layout, RightWing section order/default expansion/policy, action placement, toolbar density, reading width, file drawer emphasis, and `ThemeEffectLayer`. Imported CSS skins cannot set those controls.

## Theme Entry Points and Preview UI

Theme discovery is intentionally visible before the settings dialog:

- Welcome page: a theme selection step lets first-time users preview and enable official themes.
- Home empty state: a theme showcase introduces the five official themes when no note is open.
- Settings: a first-level "主题" entry remains the management surface for default restore, local imports, and uninstall.

Theme rows/cards do not enable themes directly. They open `ThemePreviewDrawer`, which shows:

- preview image or generated fallback surface
- role, headline, story, best-use cases, and workflow changes
- performance level and rendering-cost explanation
- enable button and restore-default action

Imported local themes may appear in development/internal builds for testing the pack lifecycle. The commercial first-release surface should present official deep themes as the primary product feature, while local imports stay clearly labelled as CSS skin-level capability.

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
- five official themes map to complete workflow chrome
- local themes cannot inject workflow chrome, official effect profile, performance badge, or action placement

Required E2E coverage:

- welcome theme step preview and enable
- home empty-state theme showcase preview and enable
- settings theme row opens preview drawer instead of direct activation
- each official theme produces observable workflow differences: action regions, default view mode, RightWing policy, toolbar shape, and reduced-motion-safe effects
- import pack
- enable pack
- refresh persistence
- restore default theme
- uninstall active pack and auto-fallback

Required GUI acceptance:

- 羽翼布局 (`paper`) remains default and stable.
- Five official themes are selectable and visually distinct beyond color tokens.
- Editor, search, file drawer, settings, export, live preview, and external readonly/edit mode remain usable under a non-Paper theme.
- Theme switching never scans notebooks, rebuilds indexes, or loses unsaved editor content.
- Flat local texture assets are used for collectible backgrounds; photorealistic generated art is not used as theme-page background material.
