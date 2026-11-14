# Roadmap

Ordered intent for the BES3 Workshop. Everything here is planned work, not a
commitment; hardware-changing items stay gated by the write-safety policy and
the staged batch approval flow.

## Completed

- Staged write flow with `Pending changes` panel, typed-name gate, stop-on-first-unverified,
  evidence chips, anonymised export privacy.
- Repository quality gate (`tools/check-all.mjs`) and hardware-free regression suite
  (`tools/check-workshop-light.mjs`); CI on Node 20 and 24.
- Export provenance: `source` / `simulated` flags on all exports and log entries.
- Consistent experimental/evidence labels on every write operation.
- BLE MCSP transport: two-layer reassembly, MobileApp peer responder, address rewrite.
- BLE Live Data transport (official Bosch interface, read-only).
- Power ports card with normal-tier staged writes.
- Direct light toggle with availability-bounce mechanism for firmware that ignores
  a standalone `BIKE_LIGHT=false` write.
- USB `transferOut` result checked: stall/short is surfaced before ACK polling.
- Node/browser ACK byte-0 (endpoint state) now checked consistently in both transports.

## Near term

1. **Live-hardware validation, read-only first** —
   [`hardware-test-plan.md`](hardware-test-plan.md), Phases 1–2.
2. **Per-mutation approval for fault clearing**, so live fault clearing can be
   re-enabled safely.
3. **Registry-driven general configuration** —
   `proposal-general-config.md`.

## Long term

4. **Live-hardware write validation** for the observed-working operations, one
   at a time, on a donor bike (test plan Phases 3–5).
5. **Light power `0x1822`** — the register write is marked `known-issue`
   (observed not working in practice): the write is acknowledged and readable,
   but the actual lamp power/output does not change on tested bikes. Re-test
   only with lamp-side measurement and cross-hardware confirmation
   ([`investigation-light-power.md`](investigation-light-power.md)).

## Standing constraints

- Do not weaken the experimental opt-in, the staged batch approval gate, the
  single-writer lock, or the verify-by-reread semantics.
- One Apply action authorizes exactly the visible staged batch. Do not auto-apply
  or reuse an approval for a later batch.
- Keep the typed `Component.NAME` gate for `high-impact` and
  `registry-readonly` registers; it is asked once per Apply batch.
- Stop at the first unverified step. Never retry a write automatically.
  *Exception:* `step.continueOnFailure = true` allows subsequent independent
  steps to proceed when one step's read-back cannot confirm (e.g. port writes
  with unverified encoding, or light-toggle step 2 restoring availability after
  step 1 succeeded). The exception is opt-in per step and does not change the
  engine's one-shot grant, single-writer lock or ACK-not-applied semantics.
- Do not enable a disabled register without explicit approval and evidence.
- Live fault clearing stays disabled until it has per-mutation approval.
- Keep upstream provenance and licenses distinct (MIT code vs. CC BY 4.0 data);
  see [`sources.md`](sources.md).
