# Linux preview pack

JotLuck is one Tauri tree. Windows NSIS and Linux `.deb` / AppImage are the same source. There is no Windows-to-Linux translator.

This script rebuilds the unsigned Linux preview from a commit so a later Windows change can be packed on Linux without repeating the migration.

## Host

Validated on Linux Mint 22.1 (Ubuntu 24.04 family), x86_64, WebKitGTK 4.1.

Dependencies:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf pkg-config build-essential curl
```

Node 20+, pnpm 11.x (repo pin), Rust 1.88+ (`~/.cargo/bin` on PATH; the script sources `~/.cargo/env`), `wmctrl` optional for window smoke.

## Command

From the repository root on a Linux host (this project uses Surface):

```bash
# current HEAD
./scripts/release/linux-preview-pack.sh

# after syncing a newer Windows commit
git fetch origin
git checkout --detach <commit>
./scripts/release/linux-preview-pack.sh --commit <commit>
```

Useful flags: `--skip-appimage`, `--skip-smoke`, `--install` (`sudo dpkg -i` the `.deb`), `--require-clean`.

The script never pushes, tags, or uploads a GitHub Release.

## Outputs

- `packages/app/src-tauri/target/release/bundle/deb/JotLuck_<version>_amd64.deb` (required)
- `packages/app/src-tauri/target/release/bundle/appimage/*.AppImage` (optional)
- `packages/app/src-tauri/target/release/bundle/linux-preview-receipt.json`

The receipt records version, git revision, host WebKitGTK, SHA-256, and smoke status. `published` is always `false` here.

## Linux adapters the script checks

These are the only Linux-specific bits that must not regress when Windows source moves:

- `WEBKIT_DISABLE_DMABUF_RENDERER=1` in `packages/app/src-tauri/src/main.rs` (WebKitGTK 2.42+ can hang on window map)
- `packages/app/src-tauri/installer-assets/linux/jotluck.desktop` (categories + MimeType). The packager does not run `xdg-mime default`. Some desktops still pick a newly registered handler; reset with `xdg-mime default org.x.editor.desktop text/markdown` if needed.
- `tauri.conf.json` `bundle.linux.deb.desktopTemplate` and no `bundle.fileAssociations`

Windows file-association code stays in NSIS hooks. Do not enable Tauri `fileAssociations` to “help Linux”.

## Known packaging traps

- AppImage needs `APPIMAGE_EXTRACT_AND_RUN=1` when FUSE is unavailable. The script sets it.
- `linuxdeploy` lives under `~/.cache/tauri/`. A truncated download fails the AppImage; the `.deb` remains required.
- Do not treat Playwright quality scores on a low-power tablet as a Linux packaging gate.
