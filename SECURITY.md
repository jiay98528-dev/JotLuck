# Security Policy

## Supported Versions

JotLuck is currently distributed as `v0.15.0-rc.1`. Security fixes target the
current release-candidate line unless a later supported version is published.

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

Out of scope for this RC:

- Unsigned installer reputation warnings.
- Missing macOS/Linux notarization or signing.
- Vulnerabilities that require manually installing and trusting a malicious
  local `trusted-code` theme package after the warning flow is shown.

## Response Target

For the RC line, the project targets an initial acknowledgement within 7 days
and a remediation plan or risk classification within 14 days.
