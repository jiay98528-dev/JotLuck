# JotLuck v0.1.0-preview Candidate Release Notes

This document describes the current unpublished Windows x64 preview candidate.
It is unsigned and is not a stable release or an RC. No official public
installer is currently available on GitHub Releases.

## Highlights

- JotLuck manages local plain-text notebooks in `.md`, `.markdown`, `.mdx`,
  and `.txt` formats.
- The first launch shows the Open Notebook gate instead of a writable temporary
  draft. Use `Ctrl/Cmd+O` later to switch folders.
- External supported text files open as single-file sessions and never scan the
  parent folder as a notebook without an explicit folder-open action.
- The Windows installer registers all four supported extensions as optional
  Open With choices and does not replace the current default application.
- Markdown rendering, local search, exports, live preview, templates, and
  offline completion remain local-first features of the preview.

## Upgrade And Data Notes

- Notes remain plain text files. The app opens and manages `.md`, `.markdown`,
  `.mdx`, and `.txt` files as notes.
- Windows installer registration covers `.md`, `.markdown`, `.mdx`, and
  `.txt` as optional Open With choices. JotLuck does not replace the default
  application for any extension.
- External supported text files opened from Windows use a single-file
  read-only session by default. Enabling edit mode saves only that file and
  does not add the parent directory as a notebook.
- Existing notebooks do not require migration.
- Local completion/training metadata may be refreshed automatically, but it is
  stored locally.
- Image assets remain in notebook `assets/` folders.
- Note deletion does not automatically remove image assets, to avoid deleting
  shared files.

## Preview Boundaries

This unpublished candidate is unsigned. It does not represent a completed
public preview, RC, or stable-release validation package. Read
[Known Limitations](./KNOWN_LIMITATIONS.md) before local testing. Any future
download must be identified by its own accompanying GitHub Release information.
