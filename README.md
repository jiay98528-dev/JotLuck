<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh.md">简体中文</a>
</p>

<p align="center">
  <img src="./packages/app/src-tauri/icons/128x128@2x.png" width="112" alt="JotLuck app icon">
</p>

<h1 align="center">JotLuck</h1>

<p align="center">
  <strong>Files are notes. Folders are notebooks.</strong><br>
  A lightweight, local-first Markdown notebook for Windows that works offline.
</p>

<p align="center">
  <a href="https://github.com/jiay98528-dev/JotLuck/releases"><img src="https://img.shields.io/badge/Windows-x64-2f6f5e?style=flat-square&logo=windows&logoColor=white" alt="Windows x64"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-b06f35?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/jiay98528-dev/JotLuck/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jiay98528-dev/JotLuck/ci.yml?branch=main&style=flat-square&label=build" alt="Build status"></a>
  <img src="https://img.shields.io/badge/data-local%20files-60675f?style=flat-square" alt="Data stays in local files">
</p>

<p align="center">
  <a href="https://github.com/jiay98528-dev/JotLuck/releases"><strong>View release status</strong></a>
  · <a href="#get-started-in-three-steps">Get started</a>
  · <a href="./SUPPORT.md">Support</a>
  · <a href="./PRIVACY.md">Privacy</a>
  · <a href="./CODE_SIGNING.md">Code signing</a>
  · <a href="https://github.com/jiay98528-dev/JotLuck/issues/new/choose">Send feedback</a>
</p>

> **Download notice:** GitHub Releases is the only future source for official public installers. There is no public installer there today; `v0.10.0-rc.1` is the current release candidate and is unsigned. Do not download it from third-party sources.

<p align="center">
  <img src="./packages/app/src/assets/theme-assets/halo-canvas-preview.png" width="100%" alt="JotLuck workspace with recent notes, a Markdown editor, outline, and backlinks">
  <br>
  <sub>The JotLuck workspace using the built-in Halo Canvas theme</sub>
</p>

## Your notes remain yours

JotLuck does not put your notes in a proprietary database. Every note is a regular `.md`, `.markdown`, `.mdx`, or `.txt` file that any text editor can open. Use OneDrive, Git, Syncthing, or your own backup tools. Leaving JotLuck never requires a data export.

| What matters     | How JotLuck handles it                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| File ownership   | Reads and writes the local folder you choose, without a note database           |
| Privacy          | Core editing and search work offline; notebook content is not uploaded          |
| Longevity        | Uses open plain-text formats that other tools can take over at any time         |
| Writing workflow | Adds Live Preview, links, backlinks, local search, and offline completion       |
| Release trust    | Official public builds will only use Releases; no public installer exists today |

## Get started in three steps

1. No public installer is available today. Developers can run the project from source using the instructions below; other users should wait for an explicit official asset on [GitHub Releases](https://github.com/jiay98528-dev/JotLuck/releases).
2. The first launch opens the Open Notebook gate. Choose an existing folder, or create a notebook folder in the system picker. Later, press `Ctrl/Cmd+O` to switch folders.
3. Start writing. Notes are saved directly into that folder, with no account required.

The Windows installer registers `.md`, `.markdown`, `.mdx`, and `.txt` as optional Open With choices. It never replaces the Windows default application for any of them.

## Built for local writing

- **Plain-text notebooks**: folders are notebooks; `.md`, `.markdown`, `.mdx`, and `.txt` are notes.
- **Focused editing**: CodeMirror 6, Live Preview, block editing, and keyboard navigation.
- **Connected knowledge**: `[[Wiki-links]]`, aliases, backlinks, tags, and document outlines.
- **Local search**: filter by keywords, regular expressions, tags, dates, and folders.
- **Templates and assets**: custom templates, date placeholders, image paste, and relative paths.
- **Flexible export**: PDF, DOCX, XLSX, CSV, TXT, and HTML.
- **Offline completion**: completion models and notebook training data stay on the device.
- **Native desktop behavior**: Windows file watching, system dialogs, and optional file associations.

## Privacy and data safety

- Notebook content stays in the folder you select.
- JotLuck does not upload notebook content or require a cloud account.
- When automatic update checks are disabled, the app does not request GitHub version data on startup.
- An enabled or manual update check only queries public GitHub release information.
- Deleting a note does not automatically delete images that may be shared by several notes.
- Keep an independent backup or version history before bulk operations or first use of a preview build.

Report vulnerabilities through a [private GitHub security report](https://github.com/jiay98528-dev/JotLuck/security/advisories/new). Do not attach private notes or real folder information to a public issue. See the [Security Policy](./SECURITY.md).

See the full [Privacy Policy](./PRIVACY.md) and the identity and integrity process for official Windows artifacts in the [Code Signing Policy](./CODE_SIGNING.md).

## Current release scope

| Item              | Current scope                                                                      |
| ----------------- | ---------------------------------------------------------------------------------- |
| Current version   | `v0.10.0-rc.1`                                                                     |
| Release stage     | Release candidate; not a stable release                                            |
| Verified platform | Windows x64                                                                        |
| Desktop runtime   | Tauri 2 and Microsoft Edge WebView2                                                |
| Note formats      | `.md`, `.markdown`, `.mdx`, `.txt`                                                 |
| File associations | All four extensions are optional Open With choices; no Windows default is replaced |
| License           | MIT                                                                                |

macOS and Linux packages have not completed host-specific packaging, signing, and release validation. Read [Known Limitations](./KNOWN_LIMITATIONS.md) and the notes attached to each release before installing.

## Frequently asked questions

<details>
<summary><strong>Is JotLuck free?</strong></summary>

The JotLuck core source code is available under the MIT License. It can be used, inspected, modified, and distributed at no charge. The license does not require the official project to provide unlimited free support, signing, or other value-added services.

</details>

<details>
<summary><strong>Does JotLuck upload my notes?</strong></summary>

No. Notes, indexes, and offline completion data stay on the device. Network access only occurs when you enable or trigger a version check, or explicitly open an external link.

</details>

<details>
<summary><strong>How do I sync between devices?</strong></summary>

JotLuck does not bind you to a sync provider. Put the notebook folder in OneDrive, Syncthing, Git, or another file synchronization tool you trust.

</details>

<details>
<summary><strong>Can I open an existing Markdown folder?</strong></summary>

Yes. JotLuck reads supported plain-text files from the folder you select. Keep a backup before the first operation on important material.

</details>

## Support and feedback

- Troubleshooting and support: [SUPPORT.md](./SUPPORT.md)
- Product boundaries: [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)
- Report a bug: [Bug report](https://github.com/jiay98528-dev/JotLuck/issues/new?template=bug_report.yml)
- Suggest an improvement: [Feature request](https://github.com/jiay98528-dev/JotLuck/issues/new?template=feature_request.yml)
- Report a vulnerability privately: [Security advisory](https://github.com/jiay98528-dev/JotLuck/security/advisories/new)

<details>
<summary><strong>Developers: local setup and project documentation</strong></summary>

### Requirements

- Node.js 20+
- pnpm 9+; the repository currently pins pnpm 11.x
- Rust 1.77.2+ for desktop development and packaging
- Tauri and WebView2 build dependencies on Windows

### Start the web development build

```powershell
pnpm.cmd install
pnpm.cmd --filter @jotluck/app dev
```

### Start the desktop development build

```powershell
pnpm.cmd --filter @jotluck/app tauri:dev
```

### Common checks

```powershell
pnpm.cmd --filter @jotluck/app typecheck
pnpm.cmd --filter @jotluck/app test
pnpm.cmd --filter @jotluck/app build
pnpm.cmd audit --prod --audit-level high
```

A public release also requires installed-app validation, a Rust dependency audit, and manual GUI journeys. See the [release gate](./doc/release-rc-gate.md).

Project documentation:

- [Product requirements](./doc/PRD.md)
- [Technical architecture](./doc/TAD.md)
- [Changelog](./CHANGELOG.md)
- [Release notes](./RELEASE_NOTES.md)
- [Security policy](./SECURITY.md)
- [Privacy policy](./PRIVACY.md)
- [Code signing policy](./CODE_SIGNING.md)
- [Contribution guide](./CONTRIBUTING.md)

</details>

## Copyright and license

JotLuck source code is available under the [MIT License](./LICENSE).

Copyright © 2026 鸰湖科技（深圳）有限公司<br>
Linghu Technology (Shenzhen) Co., Ltd.
