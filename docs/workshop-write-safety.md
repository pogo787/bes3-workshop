# Workshop write safety

This document describes how the BES3 Workshop (`index.html`,
`web/workshop/*`) constrains hardware-changing actions, and how those
guarantees are verified without a connected eBike.

The policy lives in `web/workshop/write-policy.js` (pure, no DOM, no transport).
The engine (`web/workshop/engine.js`) enforces it at execution time, and the UI
(`web/workshop/ui.js`) only ever offers actions that the policy would accept.

## Scope

- Applies to the Workshop only. The Classic Reader (`index.html`, `web/app.js`)
  was a separate application with its own safety model; it was removed in 0.5.0
  and this document makes no read-only claim about its historical behavior.
- Reading is never restricted.
- No hardware-changing action is issued unless a live connection (USB) or the
  simulated demo bike is present **and** the session opt-in is enabled.

## Action to write matrix

| User action | Registers written | Emitted only when |
| --- | --- | --- |
| Enable light output | `DriveUnit.BIKE_LIGHT_AVAILABLE` (0x1820) | availability change is explicit and the current state is readable |
| Disable light output | `DriveUnit.BIKE_LIGHT` (0x181c, off), then `BIKE_LIGHT_AVAILABLE` (0x1820, false) | availability change is explicit and the light is currently installed |
| Switch light on/off (runtime) | `DriveUnit.BIKE_LIGHT` (0x181c) | explicit action; current state readable |
| Switch light on (function test) | `DriveUnit.BIKE_LIGHT` (0x181c) | explicit opt-in checkbox on the light card |
| Set startup mode | `DriveUnit.BIKE_LIGHT_CONFIGURATION` (0x1821) | explicit valid mode (1/2/3) chosen and different from current |
| Set light power | `DriveUnit.BIKE_LIGHT_POWER` (0x1822) | explicit value in 1.0–18.0 W (0.1 W steps) different from the current reading, current value readable, planned as the last step of the light write plan and covered by the same lamp confirmation |
| Set/clear service interval | `RemoteControl.SERVICE_DUE` | explicit target |
| Sync System ID | `RemoteControl.BIKE_ID` (0x2184) | explicit action; current drive-unit ID readable |
| Clear fault memory | `EXECUTE_INFORMATION_MANAGER_COMMAND*` RPCs | demo only; live is temporarily unavailable (see below) |
| Write Lab write | a single `src/address-registry` entry with a non-blocked `POLICY.genericTier` (never a free-form address) | Write Lab consent given for this session, the register read first when readable, valid hex payload ≤64 bytes, and — for a `high-impact` or `registry-readonly` register — the full `Component.NAME` typed per write |

There is no hidden default. A fresh draft writes nothing: no default power, no
default startup mode, and no implicit switch-on.

## Unknown / unread values

Unread values are treated as unknown, never as a guess:

- If light availability (0x1820) cannot be read, availability and startup-mode
  writes are refused.
- If the runtime light state cannot be read, switch actions are refused.
- If the light power (0x1822) cannot be read, a power write is refused, so the
  register is never written from a guessed current value.

## Experimental authorization

Every hardware-changing operation requires an explicit, session-only opt-in
("I understand — enable experimental writes for this session"):

- Off by default, never persisted.
- Cleared on connect, disconnect, transport loss, demo start, and on importing
  (opening) a saved readout or a Workshop export.
- A saved readout (`file` mode) can never write, even with the opt-in on.
- Checked again at execution time: `writeVerified`, `clearFaultMemory`, and each
  individual step of a write plan re-check authorization immediately before
  acting, so revoking the opt-in or losing the connection stops any plan in
  progress. The step that is stopped is logged as `blocked`.
- A single-writer lock prevents two write plans from interleaving.
- Queued and in-flight operations are bound to the session and transport that
  started them. The engine revalidates that context when a queued mutation
  actually starts, immediately before transmission, before verification reads,
  and before publishing a result into state. An operation from an old session
  never adopts a replacement transport, never retries or rolls back after a
  possible transmission, and never overwrites the replacement session's values,
  log, or lock.

## Staged batch approval and the writer-boundary grant

Authorization (`canWrite`) is necessary but not sufficient for a live write.
The user approves a visible **batch**; the engine still issues one one-shot
grant per write. Experimental opt-in is **not** approval.

- Configure actions (light, service interval, System ID, light toggle and the
  Write Lab) add rows to a `Pending changes` panel. Each row shows the register,
  decoded old → new value, exact payload, tier and evidence. Staging sends no
  frame.
- One `Apply N changes` action sends the visible rows in order. It revalidates
  raw payloads, asks the typed gate once for all risky rows, requires the lamp
  safety checkbox for a light change that keeps or turns the output available,
  then opens the progress modal. Discard all, Remove, Edit and Escape clear or
  change staged rows with zero frames.
- The typed gate asks for every full `Component.NAME` in one dialog. Continue is
  enabled only when every name matches. The names are copied to the steps, so
  the engine's writer-boundary check still runs; a later retry is a new batch
  and asks again.
- The progress modal has no per-write Approve button. Closing it stops the
  remaining steps; the engine still treats the current step as already approved
  and never retries it. Applied rows leave the panel; unapplied rows stay
  visible for a deliberate retry or discard.
- **Fail closed.** If approval is required but no handler is supplied, or the
  handler resolves anything other than `true`, that step and all later steps
  send nothing. The batch handler returns the same decision for every step and
  turns false when the progress modal closes.
- The handler is raced against `options.approvalTimeoutMs` (default 120000 ms).
  A timeout (or a rejection) counts as **declined**: the step is blocked with
  `declined: true` and nothing is sent, so a forgotten approval can never hang a
  plan or hold the single-writer lock open.
- After the handler resolves, the session token and mode are re-validated before
  the step runs, so a session change while awaiting approval blocks with zero
  mutation frames.
- The approval promise never stays pending: closing the modal, a session change,
  or a lost connection resolves it `false`. The listener cleanup uses the
  engine's `off`.
- Ownership-based lock release is defensive: a no-argument `release()` frees only
  an anonymous lock, so a stray release can never drop another operation's lock.
- Approval is enforced at the **writer boundary**, not only in `runPlan`. A plan
  owner is `{ requireApproval, approvedWrite }`; `runPlan` issues a one-shot
  grant immediately before a step runs, and `writeVerified` must find that grant
  and consume it before transmission. Without it the write is blocked with
  `WRITE_BLOCKED` and zero mutation frames.
- The grant is **bound to the approved step**. `runPlan` issues it as
  `{ op, bytes }`, and `writeVerified` requires that `POLICY.OP[grant.op]` names
  the write's component and name and that `grant.bytes` equals the write's
  payload hex. A step that declares no `op`/`bytes` fails closed (nothing sent),
  and any mismatch between the approved step and the actual write is blocked with
  zero mutation frames. Every step built in `ui.js` therefore carries the `op`
  and `bytes` of exactly the write its `run()` performs.
- The requirement can never be switched off:
  `POLICY.needsApproval(mode, optionFlag)` is
  `approvalRequired(mode) || optionFlag === true`, so a live session always
  requires approval and `options.requireApproval === true` adds the requirement
  in demo. The writer boundary checks
  `owner.requireApproval === true || POLICY.approvalRequired(mode)`, so it holds
  even if a caller bypasses `runPlan`.
- A direct `Writers.*` call (no plan) in live mode is bound by the same contract
  and is therefore blocked: it can never carry a bound grant.
- One grant covers exactly one write. A step that performs two writes consumes
  the grant on the first and blocks the second with zero extra mutation frames.
- Demo mode rehearses the same batch and writer-boundary gates against the
  simulated transport; it is not a hardware test.

## Bounded light-power write (0x1822)

Writing `DriveUnit.BIKE_LIGHT_POWER` is a hardware-changing action with a numeric
range, so it is guarded on top of the normal policy:

- `POLICY.validateLightPower(watt)` accepts only a finite number from 1.0 to
  18.0 W inclusive, in exact 0.1 W steps; anything else (a string, `NaN`,
  `null`, a sub-tenth value, or a value outside the range) is rejected with a
  message and is never coerced.
- It is called in the UI when the step is built, and again inside
  `Writers.lightPower(watt, owner)` **before any transport I/O**, so an invalid
  value produces zero mutation frames even if the writer is invoked
  programmatically.
- The step declares `op: 'LIGHT_POWER'` and its payload bytes, so it is bound to
  the approval grant like any other write, and the written value is verified by
  read-back (the re-read tenths must equal the written tenths). One value, one
  write; nothing is retried and nothing is rolled back.
- The evidence is `known-issue` (observed not working): 12.0 W (`08 78`) and
  15.0 W (`08 96 01`) were acknowledged and read back on the reference bike on
  2026-10-19, but the actual lamp power/output was observed not to change. The
  lamp effect and other bikes/firmware remain unverified. Power is an optional,
  **last** step of the single light write plan (availability, then
  configuration, then power): it is emitted only when the chosen value differs
  from the current reading, so an untouched draft and a no-op change add no
  step. An invalid value or an unread current value blocks the whole plan with
  zero steps. The UI requires the current value to have been read before
  offering a write, and repeats the observed evidence and the lamp-effect limit
  in the pending row and panel.

## Write Lab (registry-bound generic writes)

The Workshop exposes a generic writer (`GENERIC_WRITE`, evidence `untested`) as
the **Write Lab**: an always-visible card in the Configure tab. It never offers
a free-form address. Its header carries the single chip `Experimental ·
Untested`; the one warning paragraph says the target always comes from the
address registry, that staged rows are applied as one visible batch, re-read
when the register is readable, and that nothing is retried or rolled back.

- **Always visible card.** Component filter chips, a live search field, a
  register result list, the selected register, the current value and registry
  kind, a kind-matched value editor, a collapsible "Raw payload (hex)" section
  (collapsed by default) and exactly one Write button are always present.
- **Component chips and search.** Chips list every component with writable,
  non-blocked registry entries. The filter is single-select; clicking the active
  chip again clears it and shows all components. The search field filters by
  label, registry name and address text as you type, updating only the result
  list so the field keeps focus.
- **Register result list.** Every match shows `Label — Component.NAME (0xADDR)`
  and marks high-impact registers. Arrow Up/Down moves the highlight; Enter or a
  click selects. A no-match message replaces the list when nothing matches. The
  address always comes from the registry, never typed.
- **Current value and kind.** The card shows the selected register, the current
  value (or "not read — read the bike first") and the registry kind. Tier
  warnings are shown in the pending row and panel, not permanently on the card.
- **One Write button.** The Write button is clickable whenever a session is
  open and always runs the guided flow. The Write | Call toggle is gone: Call
  (RPC/button press) has no code path yet.
- **Kind-matched value editor.** bool → checkbox, uint/normFactor → number,
  string → text, enum → dropdown, unixTimestamp → date/time, anything else → raw
  hex. The raw hex payload is authoritative: it is what is validated, shown in
  the approval and written.
- **Guided staging flow.** The Write button walks through the next missing gate —
  the session consent, read the register now (read only; no write), validate the
  payload and stage the row. The typed register-name gate is deferred to Apply,
  once for the whole batch. The unmet step is also listed next to the button
  ("Next: …"). Cancelling any step sends nothing.
- **Consent on entering the Configure tab.** Opening the Configure tab asks once
  per session for the consent to write ("Enable experimental writes?"). Accepting
  enables the writes for that session; cancelling leaves the Configure controls
  read-only and shows a banner with an "Enable experimental writes" button that
  opens the same dialog again. The authorization still clears on disconnect,
  connection loss, opening a saved readout and a demo switch, and the dialog is
  asked again afterwards.
- **No typed arming.** The typed `WRITE` arming ("Arm Write Lab") was removed in
  0.13.0 with the user's explicit permission: the session consent, the typed
  register name for the `high-impact` and `registry-readonly` tiers, the staged
  batch Apply, the read-first rule, the bound grant and the read-back all
  remain. No other gate was changed.
- **Full registry list.** The picker lists every registry entry the policy does
  not block (894 of 895). Registry read-only entries are listed and can be
  staged, then applied after the once-per-batch typed name confirmation; the
  bike usually refuses them. The
  complete, generated tier table is in `docs/write-lab-tier-list.md`;
  `tools/build-write-lab-tier-list.mjs` regenerates it.
- **Tiers.** `POLICY.genericTier(component, name)` returns `blocked`,
  `registry-readonly`, `high-impact` or `normal`:
  - **blocked** — not in the registry, or `DriveUnit.BIKE_LIGHT_POWER` ("Use the
    Light power control"). Refused at the writer boundary with zero frames.
  - **registry-readonly** — in the registry with `writable:false` (861 entries),
    readable when the registry allows it. The bike usually refuses these writes,
    but they are offered under the same typed register-name confirmation as
    high-impact: the user must type the full `Component.NAME` in the Apply
    gate, the pending row shows a "Read-only in registry" warning, and the
    grant carries the typed `Component.NAME` (`typedName`), which the writer
    boundary compares with the target register. The reason shown is "Read-only
    in the registry. The bike will usually refuse this write." This precheck is
    scoped to the generic writer: dedicated
    fixed-operation writers (the System ID sync) keep their own gate.
  - **high-impact** — writable entries matching the high-impact pair list or a
    sensitive name pattern (`LOCK`, `SECURITY`, `SIGNATURE`, `DEACTIVAT`,
    `UPDATE`, `FIRMWARE`, `BOOT`, `FLASH`, `DFU`, `ERASE`, `FACTORY`, `RESET`,
    `CALIBRAT`, `KEY`, `PIN`, `PAIR`, `BOND`, `TEST_MODE`, `TEST_PATTERN`,
    `SPEED`, `CIRCUMFERENCE`, `LIMIT`, `PORT`). The user must type the full
    `Component.NAME` in the Apply gate; the pending row shows a "High-impact
    register" warning and the grant carries the typed name (`typedName`), which
    the writer boundary compares with the target register.
  - **normal** — everything else registry-writable (including the dedicated light
    switch, availability and configuration registers).
  The old five-register `GENERIC_ALLOWLIST` is gone; `POLICY.genericDenied` still
  returns only the blocked reason.
- **One typed gate per Apply batch.** Staging never carries a typed name. Apply
  collects every `high-impact` and `registry-readonly` row into one dialog; each
  full `Component.NAME` must match before Continue is enabled. The names are
  copied to the steps only after that gate, so the writer-boundary check still
  runs. Unapplied rows lose the typed name after the batch, so a later retry is
  a new batch and asks again.
- **Payload shape only.** `POLICY.validateHexPayload(hex)` accepts optional
  whitespace, an even number of hex digits, and at most 64 bytes, and returns the
  canonical lowercase, space-separated form.
- **Read first, when readable.** A readable target must already have been read,
  or the write is refused; the guided flow can read it on demand. Registry entries
  with `readable:false` (93 total, 2 writable) skip the read step.
- **Bound grant, one write, read-back.** The step declares `op: 'GENERIC_WRITE'`
  plus `component`/`name`/`address`, the payload bytes and the typed name, so
  the grant is bound to the exact target and payload; `writeVerified` re-checks
  the registry, the tier, the typed name and the binding before transmission.
  One write per plan. A readable result is judged by
  comparing the re-read raw payload to the written bytes (`judgeWrite`). A
  write-only target sends one frame and is reported as
  `unverified (cannot be read back)` with `applied:false`. Nothing is retried and
  nothing is rolled back.
- **Out of scope.** Call/RPC mode, a full RPC Lab and live fault clearing are not
  provided; live fault clearing stays unavailable (below).

## Evidence labels

Every operation carries an evidence label, surfaced as a chip on its control
(`web/workshop/write-policy.js` `describeOp`, `EVIDENCE_LABEL`). Each
hardware-changing card header carries a single grey `Experimental` chip, while
the control rows carry only the evidence label below, so the two are not
repeated:

| Label | Meaning |
| --- | --- |
| `observed-working` | a change was observed on at least one real bike |
| `untested` | no real-hardware evidence yet |
| `known-issue` | a write was reported not to work |
| `unavailable-live` | deliberately disabled for a live connection |

`observed-working` records a single bike/firmware and does not generalize; the
labels exist so the UI never implies more confidence than the evidence supports.

## One mutation per approved execution

A state-changing register write is transmitted **at most once** per approved
execution. If the `WRITE_RESPONSE` is missing, the engine does not retransmit;
it relies on a fresh read-back instead. The missing acknowledgment is still
recorded, and the write remains unverified unless that read-back matches. A
transfer failure is not reported as "never sent". Read-only retry behavior is
unchanged.

If the session becomes stale **after** the write was (or may have been)
transmitted, the result is marked `interrupted`, the payload hex is kept in
`sent`, and the boolean is reported as `transmitted` (never overloading `sent`).
When `transmitted` is true and the current transport is still the one the write
was sent on, the interrupted entry is published to the session log with `mode`,
`applied: false`, and `interrupted: true`, so a possibly-applied write is not
silently lost. A replacement transport never inherits the entry.

Live fault-memory clearing is temporarily disabled because its current
implementation batches multiple RPC mutations (delete-all plus per-entry
deletes). That cannot be approved as individual staged writes, so the engine
refuses it before any mutation I/O. Reading the fault memory is unchanged and
still available; the simulated demo may still exercise clearing.

## Verification semantics

A write is reported as applied only when an independent read-back after the
write matches the expected value (`judgeWrite`):

- The read-back is **authoritative**: a missing write acknowledgment must not be
  used to deny a matching read-back, because the acknowledgment frame can be
  absent even when the value was applied.
- The acknowledgment flag is always preserved in the result and the log, but it
  is neither sufficient for success nor required to observe one.
- acknowledgment alone is **not** success;
- an unknown or failed read-back is **not** success, and a cached/stale value,
  a default (`false`/`0`), coercion, or a swallowed error cannot turn it into
  one. Only a boolean `true` match counts;
- an observed match is evidence that the current read-back equals the requested
  value. It is **not** proof of causation or of persistence across a power
  cycle.

`writeVerified` derives the verdict (`applied`, `statusName`) from
`POLICY.judgeWrite(ack, afterValueOrNull, match)`; the raw acknowledgment status
text is kept in a separate `ackStatus` field so the two are never conflated.

Result wording reflects this without over-claiming hardware validation:

- live + confirmed read-back: "Confirmed by read-back."
- demo: "Confirmed in simulation."

## Regression checks

`tools/check-workshop-light.mjs` is a dependency-free Node runner with two
phases:

1. **Policy** — exercises the real `write-policy.js` (planning, authorization,
   verification judgement, including the acknowledgment/read-back contract)
   plus a source check for the truthful result wording.
2. **Engine** — loads the real `engine.js` in a synthetic sandbox and drives it
   against the built-in simulated transport with synthetic inputs: connect
   refusal, blocked writes before opt-in, one verified mutation, power-writer
   rejection, read-back contract cases (including a suppressed write ACK and a
   suppressed read response), stale authorization tokens, delayed plan
   completion, mid-plan revocation, single-writer lock, direct-writer lock
   bypass, blocked service/System-ID/fault-clear before mutation I/O,
   connection loss, and imported/offline refusal. New boundary checks hold real
   production writers at controlled promise gates: a mutation queued behind a
   read and revoked before release, a queued mutation whose replacement session
   is authorized, and a writer held after transmission while the session is
   replaced. Mutation transport frames are counted per transport, including a
    check that a missing ACK causes exactly one write frame. The engine approval
    gate is covered by nine checks: declining at step 1 sends zero
    frames; approving both steps of a two-step plan sends exactly two; declining
    at step 2 sends exactly one; a session replaced while awaiting approval sends
    zero additional frames; `requireApproval` without a handler is blocked with
    zero frames; approving a single step sends exactly one frame; a step that
    performs two writes gets one grant and blocks the second (one frame); a
    writer called with a different owner sends zero frames; and a never-resolving
    approval with a short `approvalTimeoutMs` times out as declined, sends zero
    frames, and releases the lock. Four checks cover the bound grant: a step that
    declares one operation but writes another sends zero frames; a correctly
    bound step sends exactly one; a step without `op`/`bytes` fails closed with
    zero frames; and a payload that does not match the grant sends zero frames.
    Six checks cover the bounded light-power writer: out-of-range and malformed
    values (0.9, 18.1, 5.55, `NaN`, `"abc"`, `null`) are each rejected with zero
    frames; a 5.5 W demo write is applied with exactly one frame and reads back
    5.5 W; the same value through `runPlan` with a bound grant is applied with one
    frame; a writer called with an owner that has no grant is blocked with zero
    frames; the policy's payload preview matches the engine encoder; and a
    three-step plan (availability, configuration, power) consumes one approval per
    step and sends exactly three frames, with the power step applied last. A
    policy check additionally proves the power step is optional and placed last:
    only a changed, valid value emits it, an unchanged value adds no step, and an
    invalid or unread value blocks the whole plan with zero steps. The policy
    check also pins the four-tier counts (1 blocked, 861 registry-readonly,
    24 high-impact, 9 normal) over all 895 registry entries, and
    `judgeWrite(..., { readable:false })` stays `unverified (cannot be read
    back)`. The Write Lab writer checks: an unregistered register,
    `BIKE_LIGHT_POWER` via the generic writer, a registry read-only register
    without the typed confirmation, and odd-length/oversize payloads are each
    rejected with zero frames; the blocked-tier registers are rejected at the
    boundary with zero frames; the Write Lab target list offers all 894
    non-blocked registry entries (including read-only ones) and marks the tiers; a
    valid normal write is applied with exactly one frame; the same write through
    `runPlan` with a bound grant is applied with one frame; a registry read-only
    register with the typed confirmation is applied with exactly one frame (demo);
    the dedicated System ID sync (also a registry read-only register) still sends
    one frame under its own gate; source checks prove the typed name is cleared in
    a `finally` block only after the write is handed to `runPlan` and when the
    register changes, and that the guided flow has only the `experimentalConfirm()`
    opt-in (no second prompt); a high-impact register without the typed
    confirmation is blocked at the writer
    boundary with zero frames; with the confirmation it is applied with exactly one
    frame; a write-only register sends exactly one frame but is never applied
    (`unverified (cannot be read back)`); a target or payload mismatch against the
    grant sends zero frames; and the payload preview matches the engine encoder. A further boundary
    check confirms that a possibly-transmitted write whose
    connection becomes stale on the same transport is logged once as
    `interrupted` with `applied: false`. `POLICY.approvalRequired`,
    `POLICY.needsApproval` (the gate can be widened but never switched off), and
    the ownership-based `createSession.release` (a no-argument release never
    frees another owner) are covered by policy checks, and a source check
    confirms the approval resolves the real `SERVICE_DUE`/`BIKE_ID` register from
    the registry (with an engine check asserting those addresses). Source checks
    confirm the start-of-page risk warning runs before the rest of the UI and
    gates Connect and Demo, that it has no Cancel, keeps acceptance in memory only
    (no storage API) and states the non-affiliation, risk and experimental-writes
    wording; that the interrupted log chip reads "unverified — interrupted" (never
    "rejected"); that each card header carries exactly one `Experimental` chip and
    the control rows carry evidence only, with a plain Write Lab title and one
    combined warning paragraph; that the progress modal uses one batch approval
    and stops the remaining steps when it closes; that the light-power control is
    a bounded, read-gated number input offered as an optional step of the light
    write plan and that its card states the observed evidence and no
    retry/rollback; that the Write Lab is off by
    default, needs the session consent, and is dropped on
  disconnect/connection loss/session change; that the Write Lab lists the full
  registry, marks read-only and write-only entries, filters blocked tiers, and
  shows the unverified-register, read-only-in-registry and high-impact notices;
  that the card has single-select component chips, a live
  search field that updates a result list in place, arrow-key/Enter selection, a
  no-match state, one Write button and a reasons list; that the Write button
  calls the guided flow (consent, read now, typed name, confirmation) rather
  than staying permanently disabled, and that Call mode has no code
  path; and that the code version matches the top changelog entry.

Hardware safety of the engine phase:

- It never loads `web/transport-webusb.js` or `node/transport-node-usb.js`.
- `navigator` is pinned to `{ usb: undefined }`; `window.Bes3WebUsb` is replaced
  by a stub whose methods throw if touched, and the runner asserts the stub was
  never called.
- If the fake-transport harness cannot start, that is a **failure**, never a
  fallback to a real device.

It uses a simulated transport only: no browser, no real USB/Bluetooth
transport, no network, no hardware, and it writes no files:

```
node tools/check-workshop-light.mjs
```

Status (executed): Node.js **v24.22.1**. `node --check` passed for
`write-policy.js`, `engine.js`, `ui.js` and this runner; the runner reported
**212 passed, 0 failed, 0 skipped** (the policy/source checks plus the engine
checks against the simulated transport); `git diff --check` was clean. One of the
source checks validates the System ID card's experimental/untested wording at
source level; it is not browser execution. This establishes the policy and the
engine's offline wiring only. It is **not** browser/UI execution and it does not
establish behavior on real firmware or hardware.

## Live-hardware boundary (future phase)

The session opt-in is an engineering safeguard, **not** approval to change a
bike. The staged batch Apply and the engine's one-shot grants above now implement
the "explicit approval of the visible state-changing batch" requirement, but
this does not authorize any live change: it is still unexecuted, and the
procedural plan lives in [`hardware-test-plan.md`](hardware-test-plan.md). Any
future live-hardware phase must:

- start with a bounded, read-only plan;
- classify each RPC by its actual behavior (do not assume every RPC is a read);
- obtain explicit approval immediately before each individual state-changing
  operation, showing target component, address/RPC, exact payload, current
  value, intended value, expected effect, and verification plan;
- treat each approval as authorizing exactly one stated mutation;
- avoid automatic retry, repeated mutation, batched approval, and automatic
  rollback/restoration;
- stop and disclose when one UI action would bundle multiple mutations, so each
  can be approved separately;
- stop and report on an ambiguous result.


## Limitations

- The runner exercises the pure policy and, via a fake transport, the engine's
  guard/plan/lock/read-back and session-boundary wiring. It does not exercise
  the DOM/UI layer, and it does not prove behavior against real firmware.
- The demo transport (`web/workshop/demo.js`) is a fixed simulation and does not
  by itself prove behavior against real firmware.
- The Write Lab writer validates only the payload's hexadecimal shape, not its
  meaning for the target register (the registry kind is shown, not enforced). The
  typed high-impact confirmation is a deliberate speed bump, not proof that the
  change is safe. The writer is experimental and untested.
- Live fault-memory clearing is intentionally unavailable until an individual
  approval flow exists for its batched RPC mutations; fault reading is
  unaffected. Demo-mode clearing is simulation only.
- Writability of `DriveUnit.BIKE_LIGHT*` and `RemoteControl.BIKE_ID` on a given
  bike/firmware is not guaranteed; the Workshop re-reads after every write and
  reports honestly when the bike declines or ignores a change.
