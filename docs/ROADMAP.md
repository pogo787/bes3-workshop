# Roadmap

Ordered intent for the BES3 Workshop. Everything here is planned work, not a
commitment; hardware-changing items stay gated by the write-safety policy and
the staged batch approval flow.

## Done (this batch)

- Batch 5 merged locally (`2be891e`) and tagged `batch-5`; the pre-merge state
  is tagged `backup/pre-batch-5-merge`.
- Code review #3 under `reviews/review-3/`.
- Staged write flow: a `Pending changes` panel, per-register rows with decoded
  old/new values, exact payload, tier and evidence, and one `Apply N changes`
  action.
- One typed `Component.NAME` gate per Apply batch for `high-impact` and
  `registry-readonly` registers.
- Fake-DOM coverage for staging, editing, discard/Escape, apply order and
  read-back, stop-on-first-unverified, the typed gate, evidence chips and
  anonymised export privacy.
- Repository quality gate: `tools/check-all.mjs`.
- Export provenance: `source` / `simulated` on exports and log entries.
- Consistent experimental/evidence labels on every operation.
- Supporting docs: [`investigation-light-power.md`](investigation-light-power.md),
  [`hardware-test-plan.md`](hardware-test-plan.md),
  [`proposal-general-config.md`](proposal-general-config.md),
  `classic-reader-separation.md`.

## Near term

1. **Stabilize the quality gate.** (Done in 0.5.0: the reported `index.html`
   `data-pplx-inline-edit` limitation was resolved by removing the Classic
   Reader page it belonged to; see
   `classic-reader-separation.md`.)
2. **UI/DOM test coverage.** (Done in 0.21.0 for the staged write flow: the
   fake DOM loads the real `ui.js` and covers staging, edit, discard/Escape,
   apply order, read-back, stop-on-first-unverified, the once-per-batch typed
   gate and evidence chips. It is still not a browser or accessibility test.)
3. **Fix the `.gitignore` staging gap** noted in the batch progress log
   (`web/data/issues/` entry staged via an approved path). **Done:** the path is
   ignored (`.gitignore:22`) and the staging gap is closed.
4. **R2-H3 real-bike check.** The harmless bike-light switch still needs a human
   with a real bike. It is not performed by Batch 6.

## Mid term

5. **Registry-driven general configuration** —
   [`proposal-general-config.md`](proposal-general-config.md).
6. **Live-hardware validation, read-only first** —
   [`hardware-test-plan.md`](hardware-test-plan.md), Phases 1–2.
7. **Per-mutation approval for fault clearing**, so live fault clearing can be
   re-enabled safely.

## Long term

8. **Live-hardware write validation** for the observed-working operations, one
   at a time, on a donor bike (test plan Phases 3–5).
9. **Light power `0x1822`** — the register write is marked `known-issue`
   (observed not working in practice): the write is acknowledged and readable,
   but the actual lamp power/output does not change on tested bikes. Re-test
   only with lamp-side measurement and cross-hardware confirmation
   ([`investigation-light-power.md`](investigation-light-power.md)).
10. **Classic Reader separation** cleanup — done in 0.5.0: the Classic Reader
    was removed and the Workshop became the single `index.html` entry point
    (`classic-reader-separation.md` is kept as a
    historical record).

## Standing constraints

- Do not weaken the experimental opt-in, the staged batch approval gate, the
  single-writer lock, or the verify-by-reread semantics.
- One Apply action authorizes exactly the visible staged batch. Do not auto-apply
  or reuse an approval for a later batch.
- Keep the typed `Component.NAME` gate for `high-impact` and
  `registry-readonly` registers; it is asked once per Apply batch.
- Stop at the first unverified step. Never retry a write automatically.
- Do not enable a disabled register without explicit approval and evidence.
- Live fault clearing stays disabled until it has per-mutation approval.
- Keep upstream provenance and licenses distinct (MIT code vs. CC BY 4.0 data);
  see [`sources.md`](sources.md).
