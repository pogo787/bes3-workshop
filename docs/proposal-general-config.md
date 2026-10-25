# Proposal: a registry-driven general configuration surface

Status: **proposal only.** Nothing here is implemented, and nothing here
authorizes enabling a disabled register.

## Problem

Configuration writers have grown ad hoc, one feature at a time:

- The Workshop (`web/workshop/*`) has a hand-built light card, a few
  service/ID tools, and a generic **Write Lab** (registry-bound), each with its
  own control, payload preview, and wording. (The separate Classic Reader, with
  its own Write Lab and UDAM editor, was removed in 0.5.0.)
- The address registry already describes every datapoint
  (`src/address-registry.generated.js`), and `web/workshop/write-policy.js`
  already curates per-operation write metadata (address, writability,
  evidence).

The result is duplicated UI, inconsistent safety wording, and no single place
that answers "what may this build write, and what is the evidence for it?".

## Proposal

Add **one** general configuration surface to the Workshop, driven by
`write-policy.js` rather than by bespoke per-feature code:

1. **Curated metadata stays in `write-policy.js`.** Each writable operation
   keeps its `op`, `component`, `name`, `address`, `writable`, `experimental`,
   `evidence`, and `evidenceNote`. This is the allow-list; the registry is a
   lookup, not authority.
2. **The surface renders only allow-listed operations.** Disabled registers
   (`writable:false`, e.g. `BIKE_LIGHT_CONFIGURATION_OEM` 0x181F) are never
   offered, even if the registry says `writable:true`.
3. **Every change goes through the existing per-write approval gate**
   (`runPlan` + `options.approve`): component, address/RPC, exact payload,
   current value, intended value, expected effect, and "re-read after write; no
   automatic retry; no rollback".
4. **Evidence chips** (`describeOp` / `EVIDENCE_LABEL`) label each control
   `Observed working` / `Untested` / `Known issue` / `Unavailable live`.

## Design sketch

- A `configGroups()` helper groups writable operations by component.
- A generic editor renders one row per operation from its metadata plus a
  small per-op value codec (enum, bool, varint, RPC).
- Multi-step plans (for example "disable output" = off + uninstall) keep their
  explicit step list; each step is approved separately.
- Read-only datapoints are shown but never editable.

## Non-goals

- Enabling `BIKE_LIGHT_POWER` or any withdrawn register.
- Live fault-memory clearing.
- Replacing the dedicated light card before the generic surface reaches parity
  with it (including the S-Pedelec guard and startup-mode handling).
- Any write path that is not per-write approved.

## Migration

1. Land the generic surface behind the same opt-in + approval gate.
2. Move service/ID tools onto it, then the light card, keeping behavior and
   wording identical.
3. Only then consider retiring the duplicated per-feature code.

## Open questions

- How much per-op value editing is safe to generalize before a hidden default
  becomes possible?
- Should the Workshop's Write Lab converge further on this metadata, or stay a
  deliberately raw, registry-bound tool?
- How are RPC-style operations (argument-less vs. config-id) represented
  uniformly without implying they are single-register writes?
