# Security Policy

## Supported Versions

JotLuck `v0.15.0-preview` is the Mac-only preview source line for this release
cycle. The macOS Apple Silicon package is ad-hoc signed and not notarized; it
is not a stable release or an RC support line. Windows x64 and Linux x86_64
remain on the archived `v0.14.0-preview` line. Security reports for the source
tree and preview packages are handled on a best-effort basis.

## Reporting A Vulnerability

Please report suspected vulnerabilities privately through one of these routes:

- Open a GitHub security advisory or private issue if the repository host
  supports it.
- If private advisories are unavailable, contact the maintainer listed on the
  release page and include `SECURITY` in the subject.

Do not include private notebook contents in reports. Use a minimal synthetic
Markdown file or a redacted reproduction whenever possible.

## Scope

In scope:

- Markdown sanitization or XSS bypasses.
- Tauri command path-boundary bypasses.
- Export formula-injection regressions.
- Theme package import behavior that executes code without the documented user
  confirmation flow.
- Leaks of note content, editor state, or completion-training data outside the
  local application boundary.

Out of scope for this preview:

- Unsigned installer reputation warnings.
- Missing macOS notarization and the unchanged signing state of archived
  Windows/Linux v0.14 packages.
- Vulnerabilities that require manually installing and trusting a malicious
  local `trusted-code` theme package after the warning flow is shown.

## Response Target

For the preview line, the project targets an initial acknowledgement within 7 days
and a remediation plan or risk classification within 14 days.
