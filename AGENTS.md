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

## Commands and Git
- Inspect scripts and Git hooks before requesting permission to run them.
- Do not install packages without approval.
- Do not commit, tag, or push without explicit instruction.
- Never run destructive Git commands or force-push.
- Do not change OpenCode permissions or configuration to bypass a restriction.

## Verification and reporting
- Run only approved and relevant checks.
- Never claim a test passed unless it was actually executed successfully.
- Summarize changed files, checks performed, limitations, and remaining risks.

## Output discipline
- Run checks with filtered output (see the bes3-checks skill); paste at most 12 lines.
- Read files by line range or grep; never print large files in full.
- Load the bes3-boundaries skill before touching engine.js, protocol.js,
  transports or write-policy.js.
