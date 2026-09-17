# Update manifest release procedure

`site/public/updates/v1.json` is the public, machine-readable update index and
the website download page imports this same file as its only release source.
Only an enabled channel with a complete release and platform asset is offered
to the application.

## Generate

Build each platform package from the release commit, then generate the entry.
Local files are hashed by the generator. If an artifact is only available in a
GitHub Release, read its `size` and `digest` from the GitHub Releases API and
pass those values with `--remote-asset`; never estimate them.

```bash
export JOTLUCK_RELEASE_VERSION=0.14.0-preview
export JOTLUCK_RELEASE_CHANNEL=preview
export JOTLUCK_RELEASE_TAG=v0.14.0-preview
node scripts/release/generate-update-manifest.mjs \
  --channel preview \
  --version 0.14.0-preview \
  --tag v0.14.0-preview \
  --published-at 2026-09-08T14:00:11Z \
  --release-url https://github.com/jiay98528-dev/JotLuck/releases/tag/v0.14.0-preview \
  --notes-file RELEASE_NOTES.md \
  --remote-asset windows:x86_64:nsis:JotLuck_0.14.0_x64-setup.exe:22508308:d78a8a0e601154c3f9c79021ffe853c1f4925866fba2f4119cbf64adef08b8f4 \
  --asset macos:aarch64:dmg:release-staging-20260911/JotLuck_0.14.0_aarch64.dmg \
  --remote-asset linux:x86_64:deb:JotLuck_0.14.0_amd64.deb:39678902:3d5f7b709c0eaf9fea2877593696c30cbc15f0a640733d208a040d8fc3a3ed77
```

The command rejects non-SemVer versions, tag mismatches, non-HTTPS GitHub
links, duplicate targets, missing files, and invalid checksums. A candidate
must have every required platform package before it is enabled. To withdraw a
release, publish a manifest with that channel disabled or its release set to
`null`; do not point users at an incomplete candidate.

## Publish and verify

Publish the GitHub Release and all assets first. Then deploy the static website
manifest. This order ensures the public index never advertises an asset that
GitHub cannot serve. Finally run the read-only cross-check:

```bash
node scripts/release/verify-update-manifest.mjs
```

The verifier fetches the fixed `https://jotluck.com/updates/v1.json` URL and
the matching public GitHub Release. It checks the tag, stable/preview status,
release URL, asset URL, byte size, and GitHub-provided SHA-256 digest. It does
not publish, mutate GitHub, or download installers.

Configure the static route with a five-minute maximum cache (`Cache-Control:
public, max-age=300, must-revalidate`). A browser page cache must not be used as
the application's update decision; the application owns its 24-hour check
cache and records the source timestamp.
