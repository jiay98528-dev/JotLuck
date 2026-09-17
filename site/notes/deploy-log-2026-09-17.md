# V0.15 Preview Mac-only publication

- Date: 2026-09-17 (Asia/Hong_Kong).
- GitHub Release: https://github.com/jiay98528-dev/JotLuck/releases/tag/v0.15.0-preview
- Published at: 2026-09-17T03:07:01Z; prerelease, not the stable channel.
- Application build source: `f0b354d3c5ed4706d2a83a8ce6c2ae44a6423527`.
- Release tag commit: `ed156e9794ff59b3b2cb51e41a349d8e18124f87`; application source is unchanged from the build commit, with final package checksums added to documentation.
- Package: `JotLuck_0.15.0-preview_aarch64.dmg`, 41,897,879 bytes.
- SHA-256: `66f17129390ce7ce398ca20a520e1c3d59a6ca110fed896e4f507e5ab04d6561`.
- Signing: complete ad-hoc signature; no Apple Developer identity or notarization.
- Website directory: `/var/www/jotluck/releases/20260917-v015-preview`.
- Previous directory preserved for rollback: `/var/www/jotluck/releases/20260911-57df358`.
- Website archive SHA-256: `5aaf4ba8be9b968b0e87d77beddaebfaf7b98776921fb8772af10a77a86977c5`.
- Direct mirror: https://jotluck.com/downloads/JotLuck_0.15.0-preview_aarch64.dmg
- Version manifest: https://jotluck.com/updates/v1.json; HTTP 200 with `Cache-Control: public, max-age=300, must-revalidate`.
- The GitHub asset digest and website mirror checksum match the local package. Disk-image and full app signature verification passed.
- Native smoke used isolated identity `com.jotluck.validation.v015` on macOS 26.6.2 arm64; the installed v0.14 app was not replaced or terminated. Welcome opt-in persistence and Finder Markdown cold-start read-only preview were verified.
- Website build verification: 1000/1000 assertions passed. The published website's five-language download and changelog data identify Mac v0.15 separately from archived Windows/Linux v0.14.
- Existing unrelated repository-wide environment/path/i18n failures were not treated as passing release tests.
- Nginx configuration backup: `/etc/nginx/sites-available/jotluck.conf.pre-v015-20260917`. The exact update-manifest location adds five-minute caching while preserving security headers.

Rollback keeps the uploaded GitHub Release intact: atomically point the website
`current` symlink back to `releases/20260911-57df358`. If restoring the Nginx
configuration too, restore the backup, run `nginx -t`, then reload Nginx.
