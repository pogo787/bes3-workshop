# Hardware test plan (live eBike)

This plan describes how the BES3 Workshop may be validated against a **real**
eBike. It is a plan, not a record: **the staged procedure below has not been
run as a whole.** It extends the "Live-hardware boundary (future phase)"
section of [`workshop-write-safety.md`](workshop-write-safety.md) into a staged
procedure.

**What *was* executed on a real bike (the reference bike, 2026-10-19).** Four
single writes, each individually approved and each confirmed by re-reading the
register:

| Operation | Register | Result |
| --- | --- | --- |
| `LIGHT_SWITCH` | `DriveUnit.BIKE_LIGHT` (0x181c) | written and read back |
| `LIGHT_AVAILABLE` | `DriveUnit.BIKE_LIGHT_AVAILABLE` (0x1820) | written and read back |
| `SERVICE_DUE` | `RemoteControl.SERVICE_DUE` (0x2185) | written and read back |
| `LIGHT_POWER` | `DriveUnit.BIKE_LIGHT_POWER` (0x1822) | 12.0 W (`08 78`) and 15.0 W (`08 96 01`) were acknowledged and read back, but the lamp output was observed not to change (`known-issue`) |

The debug log of that run lives next to the repository, outside the git tree
(`bes3-workshop/logs/bes3-debug-log-1792433779726.txt`), because it contains
bike-specific data; the two light-power write lines are quoted in
[`investigation-light-power.md`](investigation-light-power.md). Everything else
in this plan — the staged phases, the abort criteria, the repeat runs — is
still unexecuted.

## Principles

- **Read-only first.** No write of any kind until every read phase passes.
- **Demo mode is the default.** Work without a connected bike unless a step
  explicitly requires one.
- **One mutation at a time.** Each state-changing step is individually approved
  in the UI and re-read afterwards; a step that is not confirmed stops the plan.
- **No automatic retry, no repeated mutation, no automatic rollback.**
- **Stop and report** on any ambiguous, mismatched, or unexpected result.
- **Capture evidence** for every step: exact payload, before/after values,
  read-back, timestamps, firmware/component software versions.

## Equipment and preconditions

- A donor eBike the operator is willing to change (never a customer bike).
- USB-C data cable; on Windows, `WinUSB` bound via Zadig when needed.
- Recorded component software versions (drive unit, control unit, batteries) so
  results can be attributed to a specific firmware combination.
- For any lamp-related test: a bench lamp and a current-limited supply, so a
  wrong value cannot damage the customer's lamp.
- The session opt-in understood as an engineering safeguard, **not** approval to
  change a bike.

## Phase 0 — dry runs (already covered)

The offline regression runner (`node tools/check-workshop-light.mjs`) and demo
mode exercise the policy and engine wiring without hardware. This phase is
complete and is not repeated here.

## Phase 1 — read-only connectivity

- Connect via USB; confirm the device picker shows the control unit.
- Confirm the keepalive (`0x2106`, ~800 ms) stays healthy for several minutes.
- Read all core components (`DriveUnit`, `Battery`, `RemoteControl`) and every
  optional node present (`HeadUnit`, `Battery2`, `ConnectMore`, brakes).
- **Success:** a complete readout with no write frames on the bus.
- **Capture:** the full readout export plus the raw debug log.

## Phase 2 — fault memory (read only)

- Read the fault-memory RPC entries and render the 6-digit codes.
- **Success:** entries match what the bike/display reports; no writes.
- Live fault **clearing** stays out of scope (see below).

## Phase 3 — first single-write validation

Start with the observed-working operations, one per session:

| Order | Operation | Register | Evidence today |
| --- | --- | --- | --- |
| 3a | Mark light installed | `BIKE_LIGHT_AVAILABLE` `0x1820` | observed-working (one bike) |
| 3b | Service interval set/clear | `RemoteControl.SERVICE_DUE` `0x2185` | observed-working (one bike) |
| 3c | Light switch on/off | `BIKE_LIGHT` `0x181c` | observed-working (one bike) |

Per-write procedure:

1. Read and record the current value.
2. Show the intended change: component, address, exact payload, expected effect.
3. Approve exactly that one write in the UI.
4. Send the single frame; do not retransmit on a missing ACK.
5. Perform an independent read-back on the target address.
6. Record applied / not applied; **stop** on any mismatch or ambiguity.

## Phase 4 — light startup mode (untested)

`BIKE_LIGHT_CONFIGURATION` `0x1821` is `untested`. Only mode `2` is documented.
Validate one valid mode at a time, with the same per-write procedure, and record
whether the setting survives a power cycle.

## Phase 5 — System ID sync (untested, high caution)

`RemoteControl.BIKE_ID` `0x2184` sync writes the drive unit's UUID into the
control unit. A matching read-back does **not** prove the underlying ID conflict
is resolved. Attempt only after Phases 1–4, on a donor bike, and verify the
result through the bike's own diagnostics, not just the read-back.

## Out of scope

- **Light power `0x1822`** — the register write is marked `known-issue`
  (observed not working in practice): it is acknowledged and readable, but the
  actual lamp power/output does not change on tested bikes. Lamp-side and
  cross-hardware validation remains out of scope; see
  [`investigation-light-power.md`](investigation-light-power.md).
- **Live fault-memory clearing** — batches multiple RPC mutations and cannot be
  individually approved; disabled until a per-mutation approval flow exists.

## Abort criteria

Stop the session and report immediately if: an unexpected mutation frame is
observed, a read-back cannot be performed, the firmware silently rewrites a
value, the connection drops mid-write, or any safety guard (for example the
S-Pedelec light guard) would be weakened.
