# docs/

`ebike_live_data.proto` is a verbatim copy of Bosch eBike Systems' official
**Live Data Interface** specification (smart system control unit v19+,
published 2026-05-01), vendored here under the Apache-2.0 license Bosch
attached to that exact file. It defines a small, purpose-built BLE GATT
service (`0000eb20-eaa2-11e9-81b4-2a2ae2dbcce4`) that any accessory can read
without an account, license, or partnership agreement — see the source PDF's
Terms of Use ("fully public and open basis... no specific keys or other
technical barriers required").

It is a genuinely different thing from the rest of this repo's read path.
A standalone transport used to live in `web/transport-webble.js`; it was
removed in 0.20.1 because no shipped page loaded it. The protocol description
below is kept for reference:

|  | Official Live Data Interface | This repo's MessageBus reads |
|---|---|---|
| Transport | BLE only | USB today; BLE planned |
| Sanctioned by Bosch | Yes, explicitly, in writing | No — reverse-engineered |
| Fields | ~13: speed, cadence, rider power, SoC, odometer, lock/charger/light state | 98 curated registers across 7 components |
| Battery health (SoH), cycle count, serials, tuning-detection, region config | Not present | Present |

The official interface is great for what it's built for (ride telemetry for
accessories like bike computers). It deliberately does not expose the
health/diagnostic data an owner or independent repair shop needs to decide
whether a battery is worth keeping — which is exactly the gap the rest of
this repo's protocol work fills. See the main README's "Why this exists"
section.

## Project documents

- [`address-registry.md`](address-registry.md) — generated datapoint reference.
- [`write-path-map.md`](write-path-map.md) — every path that can send a
  mutating frame and the gates it must pass, in order.
- [`workshop-write-safety.md`](workshop-write-safety.md) — how the Workshop
  constrains and verifies hardware-changing actions.
- [`CHANGELOG.md`](CHANGELOG.md) — every released change, newest first.
- `docs/internal/review/review-1/code-review.md` — the first full
  code review (findings, severity, verified-clean list, roadmap).
- `docs/internal/review/review-2/code-review-2.md` — the second,
  independent code review at `9b2155c`, with its notes in `review-2/`.
- `docs/internal/reviews/review-3/code-review.md` — the third
  review, covering the write path, decoders, import/export privacy, escaping,
  keepalive/reconnect, PDF, demo, tooling, documentation and licenses.
- [`decision-write-flow.md`](decision-write-flow.md) — why Batch 6 replaced the
  per-write dialog with a staged batch and which gates did not change.
- `docs/internal/review-triage.md` — what was done with every finding of
  the first review.
- `docs/internal/review-triage-batch-4.md` — Batch 4 triage of
  the same review against the current tree.
- [`image-map-proposal.md`](image-map-proposal.md) — analysis of the
  synchronous 383 KB PDF image map (M20), not implemented.
- [`csp-proposal.md`](csp-proposal.md) — draft Content Security Policy (M15),
  not active.
- `docs/internal/review-pack-1.md` / `docs/internal/review-pack-2.md`
  — verbatim copies of the write-path source at the reviewed revision.
- [`diagnostics.md`](diagnostics.md) — fault-code catalog extraction details.
- [`investigation-light-power.md`](investigation-light-power.md) — what is known
  about the bike-light power register (0x1822) and why the writer stays bounded.
- [`investigation-assist-modes.md`](investigation-assist-modes.md) — why the
  statistics of deactivated assist modes cannot be read.
- [`mini-remote-detection.md`](mini-remote-detection.md) — why the upstream
  reader has no Mini Remote detection, what the USB read actually shows and
  what the read-only remote probe covers.
- [`write-lab-tier-list.md`](write-lab-tier-list.md) — generated full registry
  list with the Write Lab tier, writability and readability of all 895 entries.
- [`hardware-test-plan.md`](hardware-test-plan.md) — staged plan for validating
  the Workshop against a real eBike, read-only first.
- [`proposal-general-config.md`](proposal-general-config.md) — proposal for a
  registry-driven general configuration surface.
- `docs/internal/classic-reader-separation.md` — historical
  proposal (superseded in 0.5.0, when the Classic Reader was removed and the
  Workshop became the single `index.html` entry point).
- [`ROADMAP.md`](ROADMAP.md) — ordered roadmap.
- [`public-release.md`](public-release.md) — exclusion manifest and how to build
  and verify the public release tree.
- `docs/internal/batch-1-progress.md` — autonomous batch 1 progress log.
- `docs/internal/batch-2-progress.md` — autonomous batch 2 progress log.
- `docs/internal/batch-3-progress.md` — autonomous batch 3 progress log.
- `docs/internal/batch-4-progress.md` — autonomous batch 4 progress log.
- `docs/internal/batch-4-summary.md` — Batch 4 outcome, checks and
  remaining risks.
- `docs/internal/batch-5-progress.md` — autonomous batch 5 progress log.
- `docs/internal/batch-5-notes.md` — Batch 5 findings left open and the
  assumptions behind its fixes.
- `docs/internal/batch-5-summary.md` — Batch 5 outcome, checks, local
  merge and remaining human checks.
- `docs/internal/batch-6-plan.md` — Batch 6 scope, risks and commit
  sequence.
- `docs/internal/batch-6-summary.md` — Batch 6 outcome, verification,
  approved gate change and remaining human checks.
- `docs/internal/batch-8-plan.md` / `docs/internal/batch-8-summary.md` — Batch 8
  plan and summary (Mini Remote visibility and read-only features).

## Provenance and licensing

See [`sources.md`](sources.md) for the upstream repositories this project
builds on, their maintainer-provided contribution descriptions, how
copied/adapted code, research references, and local additions are
categorized, and the per-source license terms (MIT code vs. CC BY 4.0
researched data).
