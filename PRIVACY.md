# JotLuck Privacy Policy

Last updated: 2026-09-17

JotLuck is a local-first Markdown notes application published by Linghu Technology (Shenzhen) Co., Ltd. The open-source core application does not require an account and does not collect, transmit, sell, or share notebook content, filenames, search queries, local completion data, or usage analytics.

## Data stored on the device

JotLuck reads and writes only the notebook folders and export locations selected by the user. Notes remain ordinary local `.md`, `.markdown`, `.mdx`, or `.txt` files. Local indexes, preferences, cached completion data, and application logs remain on the device and can be removed by uninstalling the application or deleting the relevant local application data.

## Network access

Core editing, rendering, search, export, and offline completion work without a network connection. When the user enables or manually triggers an update check, JotLuck may request public release metadata from GitHub. Opening a website, an issue form, or another external service is an explicit user action and is then governed by that service's privacy policy. Notebook content is not included in these requests.

The update check reads the machine-readable manifest at `https://jotluck.com/updates/v1.json` and cross-checks the matching public GitHub Release through GitHub's public API. The manifest is cached by the application for up to 24 hours; the website deployment target is a five-minute HTTP cache (`Cache-Control: public, max-age=300, must-revalidate`). Requests contain standard HTTP information, including a user-agent, and the public release tag being queried. Current-version comparison and platform selection happen locally. JotLuck does not send note content, filenames, local paths, account identifiers, or a device identifier. The website host and GitHub may independently receive the request IP address, time, and other technical data described in their own privacy policies.

## Optional paid components

Paid themes, models, or services are distributed outside the MIT-licensed core installer. Any future component that processes or transmits user data must disclose its own behavior and obtain the user's explicit choice before activation. It must not silently change the privacy behavior of the core application.

## Security and contact

JotLuck does not ask users to place passwords, MFA secrets, identity documents, or signing private keys inside a notebook or release artifact. Security issues should be reported through the project's [private GitHub security advisory form](https://github.com/jiay98528-dev/JotLuck/security/advisories/new).

Policy source: <https://github.com/jiay98528-dev/JotLuck/blob/main/PRIVACY.md>
