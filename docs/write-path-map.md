# Write path map

This document maps every entry point in the Workshop that can send a
**mutating frame** to the gates it must pass, in order. It is a description of
the current source, not a proposal; it is kept in step with the source-level
invariants in `tools/check-workshop-light.mjs` (check 45).

A *mutating frame* is a `WRITE` (`0x02`) or `RPC_CALL` (`0x04`) request frame
sent to the bike. Read requests are not mutations and are not covered here.

The UI stages Configure changes in a `Pending changes` panel and applies the
visible rows as one batch. The engine still issues one one-shot grant per step;
there is no per-write approval dialog in front of each frame.

## The single transmission point

- `buildWriteFrame()` is defined in `src/protocol.js` and called from exactly
  one place: `rawWrite()` in `web/workshop/engine.js`.
- `rawWrite()` is defined once and called from exactly one place: inside
  `writeVerified()` (`web/workshop/engine.js`). It transmits **at most once**
  per call; a missing `WRITE_RESPONSE` is left to read-back verification and
  never triggers a retransmission.
- RPC mutations take a separate path: `rawRpc()` in `web/workshop/engine.js`
  (used for fault reading and, in demo only, fault clearing). No file under
  `web/workshop/` other than `engine.js` builds a write frame or calls
  `rawWrite()`.

`writeVerified()` is not exported; the only exported write entry points are
`Writers.*`, `runPlan()`, and `clearFaultMemory()` (see
`window.Bes3Workshop` at the end of `engine.js`).

## Entry points

### UI staged batch — `applyPending()` and `runStepsModal()`

This is the user-facing approval path for every Configure action:

1. **Stage.** The light, service, System ID and Write Lab controls build steps
   with `stageSteps()` instead of calling `runPlan()` immediately. Staging sends
   no frame. A row records the register, decoded old → new value, exact payload,
   tier and evidence.
2. **Revalidate.** `Apply N changes` rechecks generic payloads, refuses while
   the session cannot mutate, and keeps the lamp safety checkbox requirement for
   a light change that keeps or turns the output available.
3. **Typed gate.** All `high-impact` and `registry-readonly` rows are collected
   into one dialog. Every full `Component.NAME` must match before Continue is
   enabled. The names are copied to the steps; the engine's writer-boundary
   check still runs for each write. A later retry is a new batch and asks again.
4. **Batch approval.** `runStepsModal()` opens the progress modal and passes an
   `approve` callback that returns the same batch decision for every step.
   Closing the modal turns that decision false, so no remaining step starts.
5. **Run.** `runPlan()` runs the visible rows in order under the engine gates
   below. It stops at the first step that is not applied. Applied rows leave the
   panel; unapplied rows stay visible. Nothing is retried or rolled back.
6. **Discard/Edit/Escape.** These clear or change staged rows and send no frame.

### `Writers.*` — one register write each

Every `Writers.*` function funnels through `writeVerified()` (or throws before
it). Each carries a fixed operation id and target:

| Entry point | Operation | Target |
| --- | --- | --- |
| `Writers.lightAvailable(on, owner)` | `LIGHT_AVAILABLE` | `DriveUnit.BIKE_LIGHT_AVAILABLE` (0x1820) |
| `Writers.lightConfiguration(v, owner)` | `LIGHT_CONFIG` | `DriveUnit.BIKE_LIGHT_CONFIGURATION` (0x1821) |
| `Writers.lightPower(watt, owner)` | `LIGHT_POWER` | `DriveUnit.BIKE_LIGHT_POWER` (0x1822) |
| `Writers.lightSwitch(on, owner)` | `LIGHT_SWITCH` | `DriveUnit.BIKE_LIGHT` (0x181c) |
| `Writers.serviceDue({timestamp, odometer}, owner)` | `SERVICE_DUE` | `RemoteControl.SERVICE_DUE` (0x2185) |
| `Writers.syncBikeId(targetComponent, uuid, owner)` | `BIKE_ID` | `<target>.BIKE_ID` (0x2184 / 0x182c) |
| `Writers.generic(component, name, payloadBytes, owner)` | `GENERIC_WRITE` | a registry-writable, non-blocked register |

Writer-specific pre-checks that run **before** `writeVerified()` and can throw
`WRITE_BLOCKED` with zero frames:

- `Writers.lightPower` — `POLICY.validateLightPower(watt)` (finite, 1.0–18.0 W,
  0.1 W steps) then `POLICY.assertWritable('LIGHT_POWER')`.
- `Writers.generic` — `genericTargetReason(component, name)` (must be in the
  registry and not reserved for a dedicated control; a `registry-readonly`
  entry is allowed and only needs the typed register name).

#### Gate order inside `writeVerified(component, name, payload, expect, label, owner)`

1. **Mutation lock.** With no `owner`, take a fresh lock (`guard.tryAcquire`);
   with an `owner`, it must be the lock owner (`guard.owns`). Otherwise the
   write is logged as `blocked` and throws `WRITE_BLOCKED`.
2. **Approval requirement on a direct call.** If this call took its own lock
   (`acquiredHere`), set `owner.requireApproval = POLICY.approvalRequired(mode)`
   so a live direct call can never skip approval.
3. **Authorization.** `guard.canWrite(mode)` (experimental opt-in **and** a live
   or demo session; a saved readout can never write). Failure logs `blocked` and
   throws `WRITE_BLOCKED`.
4. **High-impact typed confirmation.** If `POLICY.genericTier(component, name)`
   is `high-impact` - or `registry-readonly` on the generic writer - the grant
   must carry the typed register name: `grant.typedName` has to be exactly
   `component + '.' + name`. The engine compares the name itself, not a
   boolean the UI sets.
   Re-checked for every write, not only plans.
5. **One-shot writer-boundary grant.** When `owner.requireApproval === true` or
   the mode requires approval, the write must find a one-shot grant on
   `owner.approvedWrite` and **consumes it** (sets it `false`). The UI batch
   supplies this grant through `runPlan`; a direct live write cannot. The grant
   is bound to the exact write:
   - `GENERIC_WRITE`: `genericTargetReason`, then `component`/`name`,
     `address === addrOf(component, name)`, `bytes === payloadHex`, and the
     high-impact flag.
   - fixed operations: `POLICY.OP[grant.op]` must name the same component and
     name, and `grant.bytes === payloadHex`.
   A missing/mismatched grant logs `blocked` and throws `WRITE_BLOCKED` with
   nothing sent.
6. **Context snapshot.** Capture `operationContext()` and the current value
   (`state.values[...]`) for the before/after diff.
7. **Transmit (once).** `exclusive(() => ctxCurrent(ctx) ? rawWrite(...) : ...)`
   — a stale context returns `interrupted` before transmission.
8. **Settle and read back.** `sleep(...)`, then `readKeyInContext(...)`; the
   verdict is `POLICY.judgeWrite(ack, re-read value, match)`. If the ack arrived
   but the match failed, one more read-back is taken — a **read** only, the
   write is never retransmitted. A stale context at any point returns
   `interrupted`.
9. **Log and release.** The step is pushed to the session log and `change` is
   emitted; the lock is released only if this call acquired it.

### `runPlan(steps, onStep, options)` — a sequence of writes

`runPlan` does not transmit anything itself; it orchestrates steps (each step's
`run(owner)` calls a `Writers.*` function, which then re-runs the gates above).

1. **Token.** `token = options.token ?? guard.snapshot()`.
2. **Requirement.** `requireApproval = POLICY.needsApproval(sessionMode(),
   options.requireApproval)` — the option can only widen, never switch off.
3. **Lock.** `owner = { requireApproval, approvedWrite: false }`; take the
   single-writer lock or throw.
4. **Per step, before anything:** re-read `mode`; block and stop if the token is
   stale (`!guard.isCurrent(token)`) or `!guard.canWrite(mode)`.
5. **Batch approval gate.** If `requireApproval`: with no `approve` handler,
   block and stop; otherwise `requireDecision(approve({index,total,step}),
   approvalTimeoutMs)` races the decision against a timeout
   (timeout/rejection = declined). The UI's handler returns the one batch
   decision for every step; closing the progress modal makes it false. After it
   settles, re-validate the session; if declined or the session changed, block
   and stop.
6. **Grant.** Build the one-shot grant from the step's `op`, `component`,
   `name`, `address`, `bytes`, and `typedName` (the typed register name, empty
   when the tier does not need one). If approval is
   required and the step declares no `op`/`bytes`, block and stop.
7. **Issue.** `owner.approvedWrite = grant || false` — the only place a grant is
   issued.
8. **Run.** `steps[i].run(owner)`; a thrown `WRITE_BLOCKED` is recorded as
   `blocked`.
9. **Stop on first non-applied step**; release the lock in `finally`.

### `clearFaultMemory(owner)` — RPC mutations (demo only)

This entry point does **not** use `writeVerified` or grants; it issues batched
`EXECUTE_INFORMATION_MANAGER_COMMAND*` RPCs through `rawRpc`.

1. **Mutation lock.** With no `owner`, take a fresh lock; with an `owner`, it
   must be the lock owner.
2. **Connection.** Must be live with a transport.
3. **Live is refused.** If `sessionMode() !== 'demo'`, throw `WRITE_BLOCKED`:
   the implementation batches multiple RPC mutations, which cannot be
   approved as individual staged writes. (Fault *reading* is unaffected.)
4. **Authorization.** `guard.canWrite(mode)` or throw `WRITE_BLOCKED`.
5. **Execute (demo only).** Delete-all plus per-entry deletes via `rawRpc`;
   `sleep`, re-scan, judge, log.
6. **Release** the lock if this call acquired it.

## Where the invariants are enforced

- The Write Lab used to add a typed `WRITE` arming on top of these gates. It was
  **removed in 0.13.0 with the user's explicit permission**; every gate listed
  above (opt-in, staged batch Apply, bound grant, tier checks, typed register
  name, read-first, read-back) is unchanged.

- `tools/check-workshop-light.mjs` check 45 pins these properties at source
  level: a single `buildWriteFrame()` call site and a single `rawWrite()` call
  site, both inside `engine.js`; every `Writers.*` method funnelling through
  `writeVerified()`; no write frame built outside the engine; no retry loop
  around the transmit; no web storage in the write/authorization path; and
  `runPlan` as the only place a grant is issued.
- The engine phase of the same runner drives these paths against a simulated
  transport and counts mutation frames (zero for every blocked case).
- `docs/workshop-write-safety.md` describes the same gates in policy terms.
