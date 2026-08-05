# JotLuck Key Objectives

- Document ID: `KOD-JOTLUCK`
- Revision: `1`
- Status: `CONFIRMED`
- Confirmed actor: `product-owner`
- Confirmed at: `2026-07-29T17:33:08+08:00`
- Source documents: `PRODUCT.md`, `doc/PRD.md`, `doc/TAD.md`, `spec/decisions.md`, `spec/milestones.md`, `doc/release-rc-gate.md`, `SECURITY.md`, `KNOWN_LIMITATIONS.md`, `RELEASE_NOTES.md`, `spec/release/required-cases/installed-app-v2.json`

## North Star

JotLuck keeps user-owned plain-text notes safe and portable while making the complete Windows desktop writing workflow pleasant, observable, and honestly releasable.

## Key objectives

- `KO-001`: Preserve plain-text data ownership and file-operation correctness through safe relative paths, atomic writes, explicit failure handling, and post-write readback.
- `KO-002`: Close the user-visible writing, search, preview, export, restart recovery, and deletion journeys without stale note, bookmark, index, or asset state.
- `KO-003`: Preserve local-first privacy and the locked Markdown, DOMPurify, export-formula, path, and trusted-code theme safety boundaries.
- `KO-004`: Demonstrate real Windows x86_64 and ARM64 installation, WebView2 launch, four protected file associations, window isolation, restart, and uninstall quality without cross-architecture extrapolation.
- `KO-005`: Keep candidate identity, signing, dual-channel assets, raw evidence, role separation, withdrawal state, and public claims in one content-addressed closure.

## Failure modes that must remain fail-closed

- `KF-001`: Note bytes are corrupted, lost, partially written, or reported saved without matching readback.
- `KF-002`: A file, asset, export, archive, or evidence path escapes its authorized project or notebook boundary.
- `KF-003`: Markdown XSS, unsafe URL handling, or spreadsheet formula injection reaches an executable consumer.
- `KF-004`: Installation or file association handling silently overrides an existing Windows default application.
- `KF-005`: Trusted-code theme code executes without an understandable risk disclosure and explicit confirmation.
- `KF-006`: Evidence drifts, crosses candidates or architectures, reuses incompatible roles, or produces a false PASS from zero execution, skip, stale transcript, unverifiable artifacts, or unsupported adapter claims.

## Non-goals

- `NG-001`: Web/PWA and macOS, Linux, or mobile distribution are outside this production-candidate milestone.
- `NG-002`: Cloud synchronization, accounts, collaboration, and real payment are not part of the current boundary.
- `NG-003`: Stopped V2R/V2S architectures and Future V3 research cannot enter the current production candidate.
- `NG-004`: Theme sandboxing and community review are not promised by the current trusted-code theme model.
- `NG-005`: The threat model does not defend against the candidate, controller, verifier, and every trusted role acting maliciously together.

## Trust and threat boundary

Trust is limited to the exact tracked candidate, the pinned control runtime, recomputed Git objects and SHA-256 references, independently observed artifacts, and explicitly separated actors at the release boundary. Note content, Markdown, paths, theme packs, downloaded assets, self-reported JSON, old transcripts, cross-candidate evidence, and architecture extrapolation are untrusted.

Tauri remains an explicit investigation under vibe-control 0.3.6 because no formal Tauri adapter exists. Browser and generic-command evidence may prove only their descriptor-listed facts. Missing real ARM64 hardware evidence, signing identity, official website origin, or dual-channel closure must remain blocked rather than inferred.

The excluded joint-malicious threat model must be reopened if the project begins accepting unreviewed controller/runtime changes, untrusted signing infrastructure, or a release process in which all trusted roles can collude without an external trust anchor.

## Minimum safety and evidence core

- Every formal result binds one immutable candidate commit/tree, current objectives, positioning, rule set, task, checkpoint set, case/oracle, inputs, transcript, counters, and declared artifacts.
- Executed counters are non-zero and conserved; failures and skips are never rewritten as PASS.
- Required files are tracked ordinary files using safe project-relative paths, with byte counts and SHA-256 references rechecked from Git-visible content.
- x86_64 and ARM64 are distinct target environments. Cross-compilation and browser execution are diagnostic only for native installation claims.
- External R3 release work requires four distinct actors and Ed25519 public keys; private keys stay outside the project and Skill directories.
- The installed 0.3.6 package is `DEVELOPMENT_DIAGNOSTIC`, keeps `formalClaimsAllowed=false`, and caps every claim at `DEVELOPMENT_CHECKED`.

## Governance budget and audit rules

- Use the smallest contract compatible with risk: R1 for bounded mechanical work, R2 for candidate-bound product or governance changes, and R3 only for externally consequential or irreversible release work.
- Audit preset checkpoints first under `CONFORMANCE_PLUS_BOUNDED_EXPLORATION`; report every required checkpoint and then stop.
- Permit at most three ordinary exploratory findings per candidate. Current-goal, minimum-core, and locked-safety findings remain admissible only with the required objective/checkpoint/control references and evidence.
- Product feel, keyboard/IME/accessibility, theme trust prompts, and release-copy credibility remain HUMAN checkpoints.
- Warnings, investigations, future proposals, and out-of-scope observations do not silently expand the current task.

## Stop and change rules

Stop automatic progress at completed automated checkpoints, any HUMAN checkpoint, owner decision, boundary change, R3 or irreversible action, hard failure, push conflict, or user interruption. Ordinary tasks cannot edit this document. Objective changes require the content-bound `revise-objectives --plan` and `--apply` path; positioning changes require `reposition --plan` and `--apply`. Either change invalidates downstream task and candidate facts and returns the control plane to diagnostic draft state.
