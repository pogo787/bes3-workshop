# Decision: stage Configure changes and apply one visible batch

Status: accepted for Batch 6 (2026-10-23), local only.

This record explains why the user-facing approval flow changed from a dialog
before every write to a staged batch. It does not change protocol addresses,
payload encodings, keepalive behaviour or the policy tiers.

## Context

The engine already treated every write as a separate, risky operation:

- one single-writer lock;
- one one-shot approval grant per write;
- a writer-boundary check that the grant matches the exact operation and bytes;
- verify-by-re-read after every write, with no automatic retry or rollback;
- a session log and a typed register-name gate for high-impact and
  read-only tiers.

The UI, however, asked for approval one write at a time inside the progress
modal. That made a multi-step change hard to review as a whole, and it gave the
user no place to compare, edit or discard several pending register changes
before any frame was sent.

## Decision

Configure actions now **stage** changes instead of writing immediately:

1. Each action adds a row to a `Pending changes` panel. A row shows the
   register name, address, decoded old → new value, exact hexadecimal payload,
   policy tier and evidence label.
2. Staging sends no frame. Remove, Edit, Discard all and Escape clear or change
   rows with zero frames.
3. One `Apply N changes` action sends the visible rows in order.
4. The typed register-name gate runs **once per Apply batch**. Every full
   `Component.NAME` for a `high-impact` or `registry-readonly` row must match
   before Continue is enabled. The names are copied to the steps, so the
   engine's writer-boundary check still runs for every write.
5. A light change that keeps or turns the output available still requires the
   lamp safety checkbox.
6. The progress modal has no per-write Approve button. Closing it stops the
   remaining steps. Applied rows leave the panel; unapplied rows stay visible
   for a deliberate retry or discard.
7. The engine keeps its one-shot grant per step, single-writer lock,
   verify-by-re-read and stop-at-first-unverified behaviour. A batch is not a
   transaction and is never rolled back.

## Explicitly approved gate change

The user explicitly approved replacing the per-write approval dialog with this
staged batch flow for Batch 6. This is the only approved gate change in the
batch. It is recorded in `docs/CHANGELOG.md` and in the Batch 6 summary.

The following remain unchanged and must not be weakened:

- experimental opt-in, off by default and cleared on disconnect, connection
  loss or opening a saved readout;
- the single-writer lock and session/transport revalidation;
- the exact-operation/exact-bytes grant binding;
- verify-by-re-read after every write and stop at the first unverified step;
- the typed register-name gate for high-impact and read-only tiers;
- the S-Pedelec lighting warning;
- live Fault-Clear staying disabled.

## Alternatives considered

- **Keep the per-write dialog and add a summary screen.** Rejected: the user
  would still approve each write without a single place to review the whole
  change.
- **Send the batch as one transaction.** Rejected: the protocol has no
  transaction primitive, and claiming atomicity would be false. The batch stops
  on the first unverified step and leaves the rest visible.
- **Ask for the typed name before staging.** Rejected: the name is a batch
  authorization, not a payload-entry step. Asking once at Apply avoids repeated
  prompts and keeps the writer-boundary check.
- **Let a progress-modal close auto-retry or roll back.** Rejected: both would
  weaken the no-retry/no-rollback rule.

## Consequences

- The user sees every pending change, including its exact bytes, before any
  mutation.
- A multi-step change is one deliberate batch, but it is still not atomic.
- The UI and its fake-DOM tests are more complex; the engine gates are not.
- Documentation must describe the staged flow and must not claim that every
  write has its own dialog.
- The real-bike R2-H3 check and the browser pass remain human checks; the fake
  DOM is not a browser and the demo is not hardware.

## Verification

The batch is covered by `tools/check-workshop-light.mjs`: staging, edit,
discard/Escape with zero frames, apply order and frame count, read-back,
stop-at-first-unverified, one typed gate for two risky rows, evidence labels and
anonymised export privacy. `tools/check-all.mjs` scans the new panel's HTML for
escaping. Both checks pass locally; no hardware was used.
