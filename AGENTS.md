# BES3 Workshop - Agent Instructions

## Language policy
- Always respond in English, even when the user writes in another language.
- Write project documentation, comments, user-facing messages, test
  descriptions, and commit messages in English.
- Preserve protocol identifiers, external API names, product names,
  quoted source material, and compatibility-sensitive data.
- Do not rename public interfaces or rewrite existing files solely to
  enforce the language policy without an approved migration plan.
- Report existing non-English content and propose targeted changes.

## Repository orientation
- Read README.md and WORKSHOP.md before proposing architectural changes.
- Identify actual entry points, build commands, and test commands.
- Distinguish source files from generated files.
- Inspect relevant sections instead of loading large registries,
  embedded image data, or third-party libraries in full.
- Preserve existing architecture, licenses, and attribution.

## Upstream sources and provenance
- `docs/sources.md` is the canonical list of upstream sources, their
  contribution descriptions, and per-source licensing. Read it before
  reusing or re-attributing upstream material.
- Treat upstream changes as research input only. A newer upstream commit
  is never automatic authorization to alter protocol addresses, writes,
  keepalive behavior, or safety checks; those still require explicit
  approval (see "Hardware and safety").
- Preserve attribution and keep licenses distinct: upstream code is MIT,
  while researched data (for example the address registry) is CC BY 4.0.
  Do not relabel inherited material as MIT.
- Report provenance or license gaps (such as a missing license file)
  instead of silently normalizing them.

## Change discipline
- Present a short plan and affected files before making changes.
- Make small, focused changes.
- Do not add dependencies or replace frameworks without approval.
- Do not perform unrelated formatting or refactoring.
- Never overwrite or discard the user's existing changes.

## Hardware and safety
- Work without a connected bicycle by default.
- Use demo mode and synthetic fixtures.
- Do not access real USB or Bluetooth devices.
- Do not execute write operations against a bicycle.
- Changes to protocol addresses, RPCs, keepalive behavior, write
  verification, or safety checks require explicit approval.
- Do not remove or weaken safety mechanisms.

## Privacy
- Do not read, reproduce, or transmit API keys, customer information,
  private diagnostic exports, or other confidential data.
- Do not assume that a file is anonymized merely because it is named demo.
- Use synthetic or explicitly approved test data.
- Store temporary patch specs, review drafts and scratch notes in the `specs/`
  directory outside the repository (a sibling of the code checkout), never in
  the repository. Sample Bosch serial numbers in those notes then cannot trip
  the repository privacy scan.

## Commands and Git
- Inspect scripts and Git hooks before requesting permission to run them.
- Do not install packages without approval.
- After a verified change set, commit automatically and push to the local
  GitLab remote (`origin`), without waiting for a separate instruction.
  "Verified" means the relevant checks pass and `git diff --check` is clean.
- Inside the container, run `tools/gitlab-push.sh --no-push` after a verified
  change set. It re-runs both suites and `tools/export-for-review.mjs` without
  hitting the container's `git push` deny rule. Do not call the wrapper without
  `--no-push` inside the container.
- After committing locally, always print the exact one-line host push command
  for this repository's host checkout, using the `tools/gitlab-push.sh` wrapper.
  The host wrapper handles `safe.directory`, the push and repository ownership.
  If it is unavailable, fall back to the explicit host command in the push report.
- The review filename scheme is always `bes3-workshop-{version}-{date}.md`, for
  example `bes3-workshop-0.59.0-2026-11-20.md`; do not add timestamps or suffixes.
  The wrapper never stages or commits the export.
- The review export contains `docs/internal/`. Keep it out of git, never attach
  it to a GitLab or GitHub issue, and use it only in a private AI session.
- Push only to the local GitLab server. Never commit or push to GitHub, and
  never add a GitHub remote to this repository. The public GitHub tree is
  published separately by the user; this history, its author identity, and
  its internal documentation must never reach GitHub.
- If a check fails, do not commit or push. Fix the failure or report it.
- If the push fails (no SSH client, key, or network), keep the commit local,
  report the exact host command, and do not retry destructively.
- Never run destructive Git commands or force-push.
- Do not change OpenCode permissions or configuration to bypass a restriction.
- Gated changes (protocol, writes, keepalive, safety) still require explicit
  approval before they are made, regardless of this automatic Git policy.

## Verification and reporting
- Use `./tools/gate.sh` as the single local gate: it runs `git diff --check`,
  both suites and the public-tree check in order and prints `ALL GATES PASSED`.
- Run only approved and relevant checks.
- Never claim a test passed unless it was actually executed successfully.
- Summarize changed files, checks performed, limitations, and remaining risks.

## Output discipline
- Run checks with filtered output (see the bes3-checks skill); paste at most 12 lines.
- Read files by line range or grep; never print large files in full.
- Load the bes3-boundaries skill before touching engine.js, protocol.js,
  transports or write-policy.js.
