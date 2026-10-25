# Changelog

Versioning rule: bump the **minor** number for features and the **patch**
number for fixes. `POLICY.VERSION` in `web/workshop/write-policy.js` is the
single source of truth; every commit that changes behaviour bumps that version
and adds an entry here, newest first. The top entry below must match
`POLICY.VERSION` (a source check enforces this).

## 0.43.2 — 2026-10-25

- **Service interval presets explain the replace behaviour.** A note next to the
  presets states that setting a date or a distance replaces the other stored
  value and that the custom option stores both. What the presets write is
  unchanged.

## 0.43.1 — 2026-10-25

- **The public tree no longer requests the excluded PDF photo map.** A small
  `web/workshop/local-assets.js` marker ships `true` privately and is rewritten
  to `false` by `tools/public-tree.mjs`; the lazy loader checks it first, so the
  public page never asks for `part-images-pdf.js`. A source check pins the marker
  order, the guard, and the public-tree rewrite.

## 0.43.0 — 2026-10-25

- **One shared component-photo control.** The Overview and the report tab now use
  the same stateful button (not loaded, loading, loaded, failed). It stays
  session-only and OFF by default, and the privacy note states that loading
  contacts `cdn.jsdelivr.net`. Turning the session opt-in off returns both
  controls to “not loaded”.

## 0.42.2 — 2026-10-25

- **Clear service interval is always offered.** The Clear button is enabled
  whenever the session may write, even when the stored reminder was not read.
  Staging a clear first performs a read-only read of `0x2185`, then adds the
  empty-payload clear to the normal Pending changes batch, where it still needs
  Apply, approval and read-back. Invalid custom date/distance still shows its
  reason next to the button. No gate, tier or read-back rule changed.

## 0.42.1 — 2026-10-25

- **A distance-only or date-only service reminder is now rendered.** The cause
  was in `web/workshop/ui.js`: `summary()` read `RemoteControl.SERVICE_DUE` with
  `val()`, which returns `null` for the decoded object, so `service.set` was
  always false and both the Overview KPI and the Configure card said “Not set”.
  The rendering now reads the decoded object directly and shows the stored
  part(s) with the missing part, for example `2,522 km (no date)` or
  `date: 25 Oct 2027 (no distance)`. Decoders, the read path and every gate are
  unchanged. Tests use the three read-back fixtures and also prove the card
  updates after a verified write without a manual Re-read.

## 0.42.0 — 2026-10-25

- **Cadence bar now spans 0–120 rpm.** The report preview and the PDF use a
  120 rpm maximum, with updated labels; the shared `cadenceFill` clamps at 120
  and tests cover the new scale. Decoding and the read path are unchanged.

## 0.41.0 — 2026-10-25

- **Report shows average consumption for the Other segment.** The preview and the
  PDF add an amber Other bar to the average-consumption chart, using residual
  energy divided by residual distance with the same Wh/km unit and two-decimal
  rounding as the tracked modes. It is hidden when residual distance is zero or
  either total is missing.

## 0.40.2 — 2026-10-25

- **Public-tree references are now enforced.** `index.html` no longer names
  `web/workshop/part-images-pdf.js`, which the public tree excludes; the map is
  loaded lazily and quietly when present, so the private tree keeps its embedded
  photos while the public tree uses the vector fallback. `check-all.mjs` now
  blocks any `index.html` resource that matches `tools/public-exclude.txt`, and
  a missing script is always blocking (the optional-script exception is gone).

## 0.40.1 — 2026-10-25

- **Service interval date and distance inputs are readable.** The custom
  date/km fields now use the base font size and a sensible minimum width in both
  themes, and take the full column on narrow screens. A source check pins the
  rule.

## 0.40.0 — 2026-10-25

- **Registry tab shows its data source.** The top of the view now names the
  upstream project with a link, the CC BY 4.0 licence, the source file
  (`src/address-registry.json`), the generated file
  (`src/address-registry.generated.js`), the number of entries, and the registry
  `_meta.registryVersion` when present.

## 0.39.0 — 2026-10-25

- **PDF photo opt-in is now a stateful button.** The Diagnostic Report tab shows
  *Load component photos* with an explicit status (not loaded, loading, loaded,
  failed). It stays session-only and OFF by default, and the note states that
  loading contacts `cdn.jsdelivr.net`. The Overview keeps its own opt-in control.

## 0.38.0 — 2026-10-25

- **PDF component thumbnails fall back to vector icons.** When the embedded
  base64 images are absent (the public tree) and remote photos are not opted in,
  the report now draws a stylised, dependency-free vector icon for every
  component type that receives a thumbnail: drive unit, battery, second battery,
  control unit, Mini Remote, display, ConnectModule and ABS. The images are
  still preferred when available.

## 0.37.1 — 2026-10-25

- **Service interval Clear now explains why it is disabled.** When the stored
  `RemoteControl.SERVICE_DUE` read carries neither a date nor a distance, the
  Clear button stays disabled (unchanged) and the reason is shown next to it,
  like the Write Lab's unmet-reason text. Invalid custom date/distance input is
  also explained. No gate, tier or write condition changed.

## 0.37.0 — 2026-10-25

- **Streamlined for GitHub upload.** The Overview now puts **Components** before
  **Battery health** and keeps a single **Fault memory** section. The redundant
  Readout comparison, Software inventory diff, Fault summary, second-hand check,
  shop mode, units toggle, evidence export, re-read diff, staged-panel
  enhancements and Test Plan module were removed, together with the optional
  PWA/service-worker files. The read-only Connection doctor, Battery health and
  Registry browser remain.
- **Bike light power rating (`0x1822`) is marked `known-issue` (observed not
  working).** The control stays available with a clear warning, but the evidence
  label no longer claims it works: writing the register was observed not to
  change the actual lamp power or output, even when acknowledged and read back.

## 0.36.0 — 2026-10-25

- **Optional offline/PWA support.** A `manifest.webmanifest` and a service
  worker cache same-origin static files only. Component photos are never cached
  and external requests are skipped. Registration is limited to `https://` or
  `localhost`; opening `index.html` from `file://` keeps working unchanged.
  Instructions are in `WORKSHOP.md`.

## 0.35.0 — 2026-10-25

- **Keep the last good readout during a re-read (display only).** The Workshop
  keeps a snapshot of the last completed readout, shows its key values instead
  of a blank dashboard while a re-read is running, and lists the registers whose
  value or status changed when the new read finishes. The engine's read path,
  the write path and the connection handling are unchanged.

## 0.34.0 — 2026-10-25

- **Anonymised evidence export (download only).** The Session Log can build and
  download a small research bundle containing the registers that were read,
  their status and decoded type, and which components reported a software
  version. Serial numbers, System IDs, key-lock numbers, BLE records and raw
  identifier bytes are excluded, and nothing is uploaded.

## 0.33.0 — 2026-10-25

- **Service shop mode (display only).** The report view remembers an optional
  customer reference and workshop name in this browser, accepts a local PNG/JPEG
  shop logo held in memory, and offers A4 or Letter output. These fields never
  reach the bike, the JSON readout or any network request. There is no language
  switch.

## 0.32.0 — 2026-10-25

- **Units and locale (display only).** The Overview seeds `km`/`mi` and `°C`/`°F`
  from `RemoteControl.UNITS` once per readout and offers a session-only manual
  override. Distances, service intervals and pack temperatures are formatted
  with `Intl`. No value is written back and no preference is persisted.

## 0.31.0 — 2026-10-25

- **Staged panel clarity (display only).** Every staged row now has a
  plain-language summary, two rows that target the same address raise a visible
  warning, and an export-only JSON plan can be downloaded for review. The plan
  is never imported and the apply flow, order, gates and tiers are unchanged.

## 0.30.0 — 2026-10-25

- **Fault memory UX improvements (read-only).** Stored faults are grouped by
  component and sorted by the last reported occurrence, with activation counts
  and a per-code copy button. When two readouts are loaded in the comparison
  card, an activation-count trend shows which codes changed. Clearing remains a
  separate experimental action.

## 0.29.0 — 2026-10-25

- **Second-hand check report (read-only).** The Diagnostic Report view now offers
  a one-page PDF for buyers: odometer vs motor odometer plausibility, tuning
  detection, System ID match, state of health, stored fault memory, service due
  and the detected component list. It honours the anonymise switch, runs
  entirely locally and makes no network request.

## 0.28.0 — 2026-10-25

- **Software inventory diff (read-only, local only).** A new Overview card lists
  every component's `SOFTWARE_VERSION` from the two readouts already loaded in
  the comparison card (or the current readout) and flags differences. It makes
  no online lookup and is a hint to visit a dealer, not a diagnosis.

## 0.27.0 — 2026-10-25

- **Public-release readiness and optional remote component photos.** Internal
  working documents and reviews now live under `docs/internal/`, and
  `tools/public-tree.mjs` builds and verifies the public release tree from
  `tools/public-exclude.txt` (running `check-all.mjs`,
  `check-workshop-light.mjs`, and a privacy scan). `web/workshop/part-images.js`
  owns component photo resolution: local `web/parts/` first when present; when
  absent in the public tree, generic SVG icons by default with an explicit,
  session-only opt-in to load component photos from the pinned upstream commit on
  `cdn.jsdelivr.net` (and canvas conversion for PDF reports, omitting photos
  without error when absent or offline). `tools/check-all.mjs` forbids
  runtime-loading external URLs outside that single constant across HTML, CSS,
  and all Workshop scripts. Added `docs/public-release.md`,
  `THIRD_PARTY_NOTICES.md`, `SECURITY.md`, and `CONTRIBUTING.md`, and updated CI
  to run on Node 20 and Node 24.

## 0.26.0 — 2026-10-25

- **Read-only address-registry browser.** A new Registry view lists the existing
  registry with component, register, address, kind, policy tier, evidence and
  readable state, plus a filter. A `Read now` button appears only for readable
  entries and calls the existing `readKey` read path; without a live session it
  is disabled. The view has no write button or staging link. The existing
  read-only remote probe is reachable from this view.

## 0.25.0 — 2026-10-25

- **Battery health card (read-only heuristic).** The Overview now shows SoH,
  full charge cycles, lifetime energy, Wh per full cycle and minimum/maximum
  pack temperature. A conservative traffic light uses one documented
  `THRESHOLDS` object and the visible note `Heuristic, not a Bosch rating.`
  When a second readout is loaded through the comparison card, the same card
  shows the SoH, cycle, energy and odometer trend. No battery write or rating
  path was added.

## 0.24.0 — 2026-10-25

- **Readout comparison (read-only, in memory only).** Load two saved Workshop
  JSON readouts, or compare the current readout with a saved one. The card
  shows SoH, full cycles, odometer, fault-code presence and decoded register
  differences. It validates the same 8 MB / 5,000-register / date shape as the
  existing import, never imports into the live session and never exports
  comparison state.

## 0.23.0 — 2026-10-25

- **Read-only hardware test-plan runner.** A new Test Plan view turns Phases
  1–2 of `docs/hardware-test-plan.md` into a guided checklist with pass, fail,
  skip and a note per step. The only action buttons call the existing read-only
  `readAll` path. Results stay in memory, are exported as an optional
  `testPlan` field, and are restored on import; anonymised exports omit notes.
  Phases 3–5 (writes) are not offered.

## 0.22.0 — 2026-10-25

- **Connection doctor (read-only).** A failed connect now opens a checklist
  built only from the error and session state the Workshop already has:
  cancelled picker, access denied, open failure, claim failure, no answer/first
  read timeout, lost connection, or a generic fallback. It includes the Linux
  udev rule for vendor id `108c` and the Windows Zadig/WinUSB steps as
  copyable text. It never opens a device or sends a frame.

## 0.21.2 — 2026-10-25

- **Mini Remote is shown only when it is actually detected.** The Overview card,
  the probe block and the PDF note now require the existing strict `BRC3300` /
  `hasMiniRemote` marker from the BLE peer database. Without that marker there
  is no Remote card, no placeholder and no PDF mention, including for imported
  readouts and the demo. The read-only probe code remains available for the
  Registry browser. No write path or detection rule changed.

## 0.21.1 — 2026-10-24

- **Review #4 non-gated fixes & quality improvements:**
  - `rawRpc` now checks `sent.ok` instead of treating the `send()` result object as a boolean, skipping response waits when a frame could not be sent (R4-H1).
  - `readAll()`, `readAssistModes()`, and `scanIssues()` are now bound to a single transport session context and run-id so an interrupted read cannot continue across a reconnect or overwrite the post-disconnect mode, and concurrent `readAll()` calls share one in-flight run (R4-H2).
  - The Re-read button is hidden/disabled while reading, connecting, or applying a write batch, clears stale staged rows on re-read, and catches errors via the modal dialog (R4-H3).
  - Prior session write logs are archived in `state.logHistory` across reconnects and session restarts, and an unverified transmitted write from the previous session displays a recovery banner on reconnect (R4-H4).
  - Removed the external `api.fontshare.com` stylesheet and preconnect from `index.html` so page loads make zero external requests; enforced by `tools/check-all.mjs` (R4-M3).
  - Added `W.closeReadout()` to reset all readout state (`values`, `components`, `assistModes`, `issues`, `remoteProbe`, `readAt`) when closing a saved file (R4-L1).
  - `connect()` now requests the WebUSB device before disconnecting an existing session so cancelling the device picker leaves a running demo or live session intact (R4-L2).
  - Fault memory truncation (>40 entries per component) is tracked on `state.issuesTruncated` and surfaced in the UI (`40+`) and JSON export/import (R4-L3).
  - **Approved protocol & USB transport fixes (R4-M1, R4-M2, R4-M4):** `parseReadResponseFrame` and `parseNotifyMessage` now reject truncated frames (`bytes.length < 2 + len`), and `buildFrame` throws a `RangeError` if a frame body exceeds 255 bytes; ported the mandatory USB bridge init + 9-frame MCSP handshake to `node/transport-node-usb.js`, serialized `node/cli.js` keepalive and reads via an `exclusive()` mutex with exact `READ_RESPONSE` + `seq` matching and `SIGINT`/`SIGTERM` cleanup; `web/transport-webusb.js` now releases interface 0 on close, clears endpoint stalls (`clearHalt`), and ignores short `transferIn` reads.

## 0.21.0 — 2026-10-23

- **Staged batch approval replaces the per-write approval dialog.** Configure
  actions now add rows to a `Pending changes` panel. Each row shows the
  register, decoded old → new value, exact payload, tier and evidence. One
  `Apply N changes` action sends the visible rows in order. This is the
  explicitly approved gate change for Batch 6; it does not change addresses,
  payload encodings, keepalive behaviour or tiers.
- **One typed register-name gate per Apply batch.** `high-impact` and
  `registry-readonly` rows ask for every full `Component.NAME` once, in one
  dialog, before the batch starts. Each typed name is copied to its step so the
  engine's writer-boundary check still runs. A later retry is a new batch and
  asks again.
- **Discard and Escape send nothing.** Discard all, Remove, Edit and Escape
  clear or change staged rows without a frame. A staged light change that keeps
  or turns the output available still requires the lamp safety checkbox.
- **The batch stops at the first unverified step.** Applied rows leave the
  panel; unapplied rows stay visible for a deliberate retry or discard. Nothing
  is retried or rolled back automatically.
- **Fake-DOM coverage** for staging, edit, discard/Escape, apply order, frame
  counts, read-back, stop-on-first-unverified, the once-per-batch typed gate,
  evidence labels and anonymised export privacy. No new dependencies.
- **Review #3 fixes:** bounded decoders, malformed-frame rejection, import date
  and BLE payload validation, certificate/PDF redaction, demo provenance and
  probe restoration, keepalive send-result handling and safe reconnects.
- The demo still rehearses the same engine gate; live Fault-Clear stays
  disabled.

## 0.20.2 — 2026-10-23

- **Batch 5 is merged locally.** The reviewed Batch 5 fixes are now on `main`
  (`2be891e`) and tagged `batch-5`; `backup/pre-batch-5-merge` marks the
  pre-merge commit. There is no remote and nothing was pushed.
- **The Batch 4 and Batch 5 summaries now match the history.** Both branches
  were merged locally; the summaries no longer claim that their work is
  unmerged. The Batch 5 notes keep the original findings and add a short
  post-merge note.
- **Decoder hardening from Batch 5 is recorded in the release history.** The
  ServiceDue length checks, safe-varint limit, Mini Remote marker check,
  missing-registry fail-closed path, hostile-import coverage and the CI gate are
  part of this patch release.
- No write gate changed in this patch.

## 0.20.1 — 2026-10-20

- **Untracked assistance modes are now shown as Other.** The distance and energy
  charts, their legends and the PDF append an amber **Other** segment as the
  last entry. It is `total − sum(tracked modes)`, using the bike's own
  `DriveUnit.ODOMETER` and `Battery.TOTAL_ENERGY`; the residual is clamped to
  zero, hidden when it would round to `0.0 km` / `0.00 kWh`, and skipped
  independently if a total is missing or non-numeric. A shared footnote
  explains that Other means riding in modes the bike does not track (for
  example eMTB or Turbo). The demo bike now shows non-zero Other values.
- **Remote-register probe results no longer stretch the layout.** The probe now
  renders into its own bounded, scrollable `Register | Value` table with a
  caption and a summary such as “100 of 150 registers read”. Rows that returned
  no value are hidden by default behind an `aria-expanded` toggle, long names
  and hex values wrap, and the component grid keeps `min-width: 0` so a card
  cannot overlap its neighbour at narrow widths. The probe remains read-only.
- **The cadence bar now shows its actual fill.** The report preview and PDF
  share a clamped `cadenceFill` helper (0, 64, 100, 150, -5, NaN and numeric
  strings are covered by tests), the track is grey and the fill blue, and the
  rpm text stays black at full contrast. A saved readout that carries the value
  as a string no longer produces a full-looking or malformed bar.
- **A declined or failed read-back is now "read-back unknown".** The marker that
  is handed to `POLICY.judgeWrite` is only formed when the re-read succeeded
  (`after.status === 'ok'`): the decoded value when the register has one, the
  raw payload otherwise. A re-read the bike declined or that never arrived is no
  read at all, so the verdict is "acknowledged, read-back unknown" instead of
  "acknowledged, not confirmed". A byte-identical raw read-back of a payload the
  decoder cannot interpret still counts as a match, and a register whose value
  is `false` still counts as a read.
- **Stale comments corrected.** `genericTargetReason` no longer claims that the
  writer boundary rejects read-only targets (they are allowed with the typed
  register name), the Write Lab comment no longer mentions a
  `highImpactConfirmed` flag (the grant carries the typed name itself), and the
  `runPlan` documentation now sits above `runPlan` instead of above
  `requireDecision`.
- **The Write Lab list is memoised (M8).** The tier of every registry entry is
  built in one pass and cached in the policy; the cache is dropped only when the
  registry itself changes. The Write Lab target list and the filtered result
  list are cached as well, so a render (and a keystroke) no longer walks the 895
  registry entries more than once.
- No write gate changed.

## 0.20.0 — 2026-10-20

- **The light theme reaches the WCAG AA contrast (4.5:1) for the small
  labels.** The muted ink (`--ink-3`), the "verified" chip (`--ok`) and the
  warning chip (`--warn`) were darkened; the measured ratios (WCAG 2.x,
  computed from the CSS tokens) are now:
  - `--ink-3` #5f6670 on `--bg` #f4f4f1: **5.26:1** (was 3.51:1)
  - `--ink-3` #5f6670 on `--surface` #ffffff: **5.80:1** (was 3.87:1)
  - `--ok` #1a7a42 on `--ok-soft` #e4f4ea: **4.72:1** (was 3.84:1)
  - `--warn` #a25400 on `--warn-soft` #fdf0dd: **4.91:1** (was 4.16:1)
  - unchanged and already passing: `--bad` 4.67:1, `--beam-ink` 7.51:1,
    `--primary` 5.18:1, `--ink-2` 8.13:1
- **The modal keeps the focus where it belongs.** The element that had the
  focus before a dialog opened gets it back when the dialog closes, Tab is
  trapped inside the open dialog, and the per-write approval gives the focus to
  the "Approve this one write" button.
- **The re-read control stays reachable on a narrow screen.** It is no longer
  hidden below 520 px (re-reading is the app's own verification step); it is
  only rendered more compactly there.
- The regression suite checks the contrast ratios of the light theme and the
  three source rules above.
- No write path changed.

## 0.19.0 — 2026-10-20

- **The regression suite covers the gaps of the code review.**
  - The emulated live mode is asserted: a direct writer and a plan without an
    approval handler are both blocked with zero write frames.
  - The service-interval writer is executed end to end: one write frame, applied
    and the same timestamp and odometer read back.
  - Every kind of the address registry now has a decoder fixture; a new kind in
    the registry fails the suite until it has one.
  - Write frames (type 2) and RPC frames (type 4) are counted separately, and
    the counters are reset before every check, so a check only sees its own
    frames.
- **The simulated bike's response latency is injectable.** The harness runs
  without it (the suite is faster), and one check exercises the delayed path on
  purpose.
- **The USB write acknowledgement state machine is pure and tested.** It moved
  into `web/workshop/usb-ack.js`: the busy retry, the error status, the short
  answer, the 64-byte padding and the size guard are unit tested with a fake
  device instead of hardware. The transport uses the same functions.
- **The quality gate parses more.** It now parses `node/` and every script
  under `tools/` as well, and the pre-commit hook runs the gate (it takes about
  a second and needs no network).
- The suite prints the duration of every check.
- No write path changed.

## 0.18.0 — 2026-10-20

- **The Remote card can probe the remote registers.** The new "Probe remote
  registers" button sends **read requests only**: one read per register, no
  retries, nothing written, and no approval needed because no mutation is sent.
  It reads every readable registry entry whose name or label mentions the
  remote, the BLE stack, buttons, pairing or the eShift (127 registers with the
  current registry) and shows the address, the register name, the raw hex and
  the decoded value; declined registers are marked.
- The probe results travel with the JSON readout export (remoteProbe).
- The probe is honest about its limits: the Mini Remote pairs over Bluetooth
  and does not have to appear in the wired registers, so the result may stay
  empty on a bike where the remote works.
- The probed registers are documented in docs/mini-remote-detection.md.
- The Mini Remote document now states that the 2026-10-19 hardware log exists
  next to the repository (outside version control) and quotes its two
  light-power write lines, instead of claiming that it is missing.
- No write path changed.

## 0.17.0 — 2026-10-20

- **The JSON readout export and the debug log can be anonymised.** The log view
  offers the same "Anonymise identifiers" switch as the PDF report (off by
  default). In the JSON export the personal identifiers (the serial numbers,
  the System ID, the OEM bike ID, the key-lock number) are masked and their raw
  bytes are dropped; in the debug log the payload bytes of every entry are
  removed. An anonymised JSON export can still be opened again.
- **The exports say what they contain.** The log view states next to the export
  buttons which personal data the files can contain, and the debug log itself
  names them in its header.
- The debug log is now titled "BES3 Workshop debug log" (it was still called
  "BES3 Reader").
- README.md and WORKSHOP.md describe the exports and their anonymisation.
- No write path changed.

## 0.16.0 — 2026-10-20

- **Deactivated assist modes are listed.** The bike can have more assist-mode
  slots (name, colour) than it reports configuration ids for. Such a slot is
  now shown in the ride statistics card under "Deactivated modes", marked as
  deactivated, with the note that its statistics cannot be read.
- **Why there are no numbers for them.** Every statistics call is keyed by a
  configuration id, and the bike reports ids for the *active* modes only: the
  unused slot of `ACTIVE_ASSIST_MODES` carries an empty id. The complete
  drive-unit RPC block and every candidate register were checked (see
  `docs/investigation-assist-modes.md`); none of them enumerates the
  deactivated modes or carries their ids. No id is guessed and no extra read
  request is sent for such a slot.
- The statistics of every mode the bike reports an id for are read as before.
- No write path changed.

## 0.15.0 — 2026-10-20

- **The typed register name is verified by the engine, not by the UI.** The
  grant now carries the typed name itself (`typedName`) instead of a boolean.
  `writeVerified` compares it with the target register
  (`Component.NAME`) for the `high-impact` and `registry-readonly` tiers, so a
  UI that forgets the confirmation cannot turn it into a permission. A wrong or
  missing name is blocked with zero frames.
- **Mutating RPCs are sent at most once and are bound to the session.** The
  fault-memory clear now uses a single-attempt, context-bound RPC path: a
  failing delete is not retried, and a session change stops the batch. Read RPCs
  keep their retries.
- **"Transferred" and "not transferred" are now distinguished.** When the USB
  transport fails after the frame was handed to the device, the error says so
  and the step reports "transferred, not acknowledged" instead of a plain
  transfer failure.
- **The demo shows the approval dialog too.** `requireApproval` is now also set
  for demo sessions, so a demo run rehearses exactly the live gate: the
  per-write approval dialog appears and the grant binding is enforced.
- **The fault-memory dialog states the exact number of mutations.** The batch
  (one delete-all plus one delete per stored entry, per command tier) is
  labelled with its exact count before it is sent. Live fault clearing stays
  disabled.
- **The simulated bike can fail.** A demo-only control lets the user choose
  "decline", "acknowledged but unchanged" or "never answered", so every result
  state can be seen without a device.
- **The demo's writable set comes from the address registry** instead of a
  hardcoded snapshot, plus the two System ID registers the dedicated writer
  uses.
- The USB disconnect handler now only reacts to the connected device and is
  removed on disconnect, so unplugging another USB device no longer drops a
  healthy session.
- `drain()` tolerates a closed transport and the write path checks the session
  before draining.
- The USB transport no longer ignores the `byteOffset`/`byteLength` of a
  `DataView`.
- No write gate was weakened; every gate is enforced by the engine as before.

## 0.14.0 — 2026-10-20

- **Every value that reaches the DOM is escaped.** The read view, the ride
  statistics, the fault-memory cards and the KPI cards now pass device text and
  imported text through `esc()`; numbers through `escNum()` and the assist-mode
  colours through `escColor()` (a colour that is not a plain hex value falls
  back to a neutral one). The assist-mode colours, the UDAM numbers, the fault
  counters, the state of charge and the light-power fields were the places
  where unescaped values could reach the markup.
- **The quality gate now enforces it.** `tools/check-all.mjs` checks every
  `${…}` inside an `innerHTML =` template: it must be escaped, a literal, or an
  explicitly allow-listed helper or fragment. The allow-list is reviewed and
  documented in the gate; there is no blanket exception. The gate also self-tests
  the rule so it cannot silently pass everything.
- **Imported readouts are validated.** A readout file is untrusted input. Both
  import paths now rebuild every value from scratch: the shape is checked (a bad
  `values`, `issues` or `assistModes` is rejected with a clear message), strings
  are bounded, lists and objects are capped, `__proto__`/`constructor`/`prototype`
  keys are dropped, and the file size is limited to 8 MB before it is read. An
  imported readout still can never write.
- **A failing render is no longer silent.** When a render listener throws, the
  engine publishes the error and the UI shows a message instead of freezing the
  view without a word.
- The values used by the UI (`val()`, `disp()`) are coerced to a primitive, so a
  malformed value cannot break the renderer.
- No write gate changed.

## 0.13.0 — 2026-10-20

- **The typed `WRITE` arming of the Write Lab was removed**, with the user's
  explicit permission. The "Arm Write Lab" button, the typed `WRITE` prompt and
  the arm/disarm helpers are gone. Every other gate stays exactly as it was:
  the session consent, the per-write approval in live mode, the bound one-shot
  grant, the tier checks, the typed `Component.NAME` for the `high-impact` and
  `registry-readonly` tiers, the read-first rule and the read-back.
- **The consent moved to the Configure tab.** The "enable experimental writes"
  checkbox is gone. Opening the Configure tab asks once per session with the
  existing "Enable experimental writes?" dialog. Cancelling leaves the Configure
  controls read-only and shows a banner with an "Enable experimental writes"
  button that opens the same dialog again. The authorization still clears on
  disconnect, connection loss, opening a saved readout and a demo switch, and
  the dialog is asked again afterwards.
- **The Write Lab is simpler.** Component chips, a search field with a live
  result list, the selected register, the current value and the registry kind,
  a value editor matched to the register kind, a collapsible "Raw payload (hex)"
  (collapsed by default) and **one** Write button. The Write | Call toggle is
  gone (Call never had a code path) and the tier warnings now appear only in the
  confirmation dialogs, not as permanent text on the card.
- **The Write Lab can write again (two defects fixed).**
  - A second modal no longer replaces an open one and leaves its promise
    pending: the modal slot is a stack, and a replaced modal is *cancelled*
    (resolved with `false`, never with a confirmation).
  - The progress modal no longer sticks on "Please wait …" when a plan throws:
    the plan runs in a `try/catch`, the error is shown in the modal and the
    modal can be closed while it runs.
  - A raw payload whose value the decoder cannot interpret is now confirmed by
    the read-back: the re-read bytes matched, so the verdict is "confirmed by
    read-back" instead of "read-back unknown". This is a verdict fix, not a gate
    change — a mismatching re-read is still not applied.
- The Write Lab draft (payload, typed register name, search, filter) is cleared
  whenever the target changes and on every session change, so a confirmation
  typed for one register can never be used for another.
- The System ID write is only offered when the drive unit reports a well-formed
  UUID, and every action in the UI reports a failure in a modal instead of
  failing silently.
- The missing prerequisite is now decided by one pure policy function,
  `POLICY.writeLabNextStep(state)`, with unit tests for every combination.
- No other write gate was changed.

## 0.12.0 — 2026-10-20

- **Average rider cadence is now decoded in rpm.** `DriveUnit.AVERAGE_RIDER_CADENCE`
  (0x1876) counts half revolutions per minute, so the raw count is twice the
  cadence. The raw value read on the reference bike (`08 80 01` = 128) is
  **64 rpm**, not 128 rpm. The decoder now returns and displays 64 rpm; the
  raw count stays available as `rawCount` and the raw hex is unchanged. The
  scale was derived by comparing a read of this bike with a Bosch
  DiagnosticTool report of the same bike; the address registry lists the
  register with kind `unknown` and no unit, so this scale is not documented
  upstream and is kept as the project's own measurement.
- The PDF diagnostic report shows the cadence as **one horizontal bar** from
  0 to 100 rpm (labels at both ends, the fill clamped to the bar, the value
  printed as text) instead of the previous rolled gauge.
- The Overview no longer repeats the "Configure light & service" and
  "PDF diagnostic report" buttons; the Configure and Report tabs already
  provide both.
- No write gate changed.

## 0.11.1 — 2026-10-20

- The typed register-name confirmation is now single-use: `applyGenericWrite`
  clears `draft.advanced.highImpactName` in a `finally` block, so a
  `high-impact` or `registry-readonly` register asks again for every write,
  including after a cancel, a block or an error. Choosing another register also
  clears it. The value is only cleared after the write has been handed to
  `runPlan`, never before.
- The guided Write Lab flow no longer shows a redundant "Enable experimental
  writes?" prompt before the real consent dialog. `experimentalConfirm()` is the
  single opt-in dialog and still sends nothing when cancelled.
- No write gate, retry or rollback behaviour changed.

## 0.11.0 — 2026-10-19

- The Write Lab can now send a write to a `registry-readonly` register (a
  registry entry with `writable:false`) under the same rules as `high-impact`:
  the user must type the full `Component.NAME` and the approval grant must carry
  `highImpactConfirmed: true`. The reason shown is "Read-only in the registry.
  The bike will usually refuse this write."
- `blocked` stays blocked: a register that is not in the registry, or
  `DriveUnit.BIKE_LIGHT_POWER` (reserved for its dedicated control), is still
  refused at the boundary with zero frames.
- The writer boundary applies the typed-name requirement to both `high-impact`
  and `registry-readonly` tiers and the `GENERIC_WRITE` grant branch requires
  `highImpactConfirmed === true` for either; `Writers.generic` no longer rejects
  a read-only target outright. `judgeWrite`/read-back behaviour is unchanged:
  readable targets are re-read and compared, write-only targets stay
  `unverified (cannot be read back)` with `applied:false`.
- The Write Lab card, guided flow and approval box now show a "Read-only in
  registry" banner instead of refusing the register; the register name input is
  offered for both tiers.
- The read-only precheck in `writeVerified` is scoped to the generic writer, so
  dedicated fixed-operation writers keep their own gate; a regression test pins
  the System ID sync (also a read-only registry entry) at one frame.
- No write gate, retry or rollback behaviour was weakened; the new tier only
  adds another typed confirmation in front of an already-approved write.

## 0.10.0 — 2026-10-19

- The Write Lab now lists the full address registry (894 non-blocked entries)
  instead of only the 34 writable ones. Read-only entries are reference only;
  the picker marks them and the writer rejects them before any I/O with zero
  frames.
- Split the policy into four tiers: `blocked` (not in the registry, or
  `DriveUnit.BIKE_LIGHT_POWER`), `registry-readonly` (`writable:false`),
  `high-impact` (the pair list or a sensitive name pattern such as `LOCK`,
  `RESET`, `UPDATE`, `BOOT`, `KEY`, `SPEED`, `PORT`, `TEST_MODE`), and `normal`.
  The tier counts are pinned by tests: 1 / 861 / 24 / 9.
- Added generated `docs/write-lab-tier-list.md` (regenerated by
  `tools/build-write-lab-tier-list.mjs`) with every entry, its address, kind,
  writability, readability and tier.
- Write-only registers (registry `readable:false`; 2 writable, 91 read-only) are
  handled explicitly: the guided flow skips the read step, `writeVerified` sends
  one frame and does not re-read, and `judgeWrite(..., { readable:false })`
  reports `unverified (cannot be read back)` with `applied:false`.
- The writer boundary and grant binding re-check `registry-readonly` and
  `high-impact`; the existing read-only, reserved and binding rejections still
  produce zero mutation frames.
- No write gate, retry or rollback behaviour was weakened.

## 0.9.0 — 2026-10-19

- Replaced the Write Lab register dropdown with a live result list. Typing
  filters the list in place so the search field keeps focus; Arrow Up/Down moves
  the highlight, Enter or a click selects, and a no-match message appears when
  nothing matches. Each entry shows `Label — Component.NAME (0xADDR)` and marks
  high-impact registers.
- Made the component filter single-select: clicking the active chip clears the
  filter and shows all components.
- Added a guided write flow for both Write buttons: enable experimental writes,
  arm with typed `WRITE`, read the register now (read only), type the
  high-impact name, then the normal confirmation and per-write approval.
  Cancelling any step sends nothing. The buttons are no longer permanently
  disabled and the unmet steps remain listed next to the button.
- Removed the redundant high-impact field override before the final write check
  so a name confirmed in the guided step is not discarded.
- Source checks updated: the in-place result list, arrow-key selection,
  no-match state, single-select filter and guided flow are pinned.
- No write gate, payload or safety check was weakened.

## 0.8.0 — 2026-10-19

- De-cluttered the evidence chips. Each hardware-changing card (Bike light,
  Service interval, ID conflict & System ID sync, Fault memory) now has exactly
  one `Experimental` chip in its header, and the control rows show only the
  evidence label (`Observed working` / `Untested` / `Known issue` /
  `Unavailable`) with the full note kept as the tooltip.
- Removed the repeated inline `Experimental` chips and the "Experimental:"
  prefixes inside the light card; the Write Lab title is now plain "Write Lab"
  with a single `Experimental · Untested` header chip, and its standalone warning
  banner was merged into the card's one warning paragraph.
- Source checks updated and one added: the header-chip helper, the four header
  chips, the absence of inline `Experimental` chips, and the plain Write Lab
  title with one combined paragraph are pinned.
- Presentation only; no write gate, payload or safety check changed.

## 0.7.0 — 2026-10-19

- Light power `DriveUnit.BIKE_LIGHT_POWER` (0x1822): evidence raised from
  `known-issue` to `observed-working` after 12.0 W (`08 78`) and 15.0 W
  (`08 96 01`) were written and confirmed by read-back on the reference bike on
  2026-10-19. The writer stays experimental and bounded to 1.0–18.0 W in 0.1 W
  steps, with per-write approval, read-back, no retries and no rollback; the
  lamp effect and other bikes/firmware remain unverified.
- The light-power hint and approval box now state the observed values and keep
  the lamp-effect limit instead of repeating the old "reported not to change"
  wording.
- Updated `docs/investigation-light-power.md`,
  `docs/workshop-write-safety.md`, `docs/hardware-test-plan.md` and
  `docs/ROADMAP.md`. The cited 2026-10-19 debug log lives next to the
repository, outside the git tree (it contains bike-specific data); that is
recorded in the investigation note rather than papered over.
- Policy and source checks updated: the evidence label is
  `observed-working`; the note must cite both payloads and the read-back; the
  approval note must keep the lamp-effect limit and the no-retry/no-rollback
  statement.

## 0.6.0 — 2026-10-19

- Mini Remote detection: compared the Workshop with the upstream reader and
  found that it has no Mini Remote logic at all (`decodeBlePeers`,
  `hasMiniRemote`, `BRC3300` are Workshop-only). There was nothing to port.
- The Mini Remote card no longer says "None detected". It now states that the
  bike did not list a Mini Remote over USB, that the remote pairs over
  Bluetooth, and it exposes the raw `BLE_CENTRAL_DATABASE` (0x2210),
  `DEVICE_DATABASE` (0x2332), `DEVICE_AVAILABILITY` (0x2331) and
  `AVAILABLE_BUTTONS` (0x2041) values in a collapsible area.
- Added `docs/mini-remote-detection.md` with the upstream comparison and the
  values observed on the reference bike (`0a 00` / empty databases).
- Added decoder and source checks: the real USB values decode as empty with no
  Mini Remote, an imported export keeps that result, a synthetic `BRC3300`
  record is still detected, and the card text is pinned.
- Read-only presentation change; no write gate was altered.

## 0.5.1 — 2026-10-19

- Added source-level write-path invariants to `tools/check-workshop-light.mjs`
  (check 45): exactly one `buildWriteFrame()` call site and one `rawWrite()`
  call site, both inside `engine.js`; every `Writers.*` method funnels through
  `writeVerified()`; no write frame is built outside the engine; no retry loop
  around the transmit; no web storage in the write/authorization path; and
  `runPlan` is the only place a one-shot approval grant is issued.
- Added `docs/write-path-map.md`, which lists every mutating entry point
  (`Writers.*`, `runPlan`, `clearFaultMemory`) and the gates it passes, in
  order.
- No behavior change; safety gates are unchanged.

## 0.5.0 — 2026-10-19

- The Workshop is now the application: `workshop.html` was renamed to
  `index.html`, and the separate Classic Reader page (`index.html`) and its
  script (`web/app.js`) were removed. The single entry point is `index.html`.
- Removed every Classic Reader / Expert View link, button and usage note from
  the UI, `README.md`, `WORKSHOP.md` and `docs/`; the two-interface description
  is gone. Upstream attribution for `rweijnen/bosch-bes3-reader` is preserved
  (the Classic Reader remains part of that upstream project and of this
  repository's git history).
- `tools/check-all.mjs` now validates the single `index.html` page; the former
  `data-pplx-inline-edit` baseline limitation is gone with the Classic page it
  applied to.
- `docs/classic-reader-separation.md` is marked historical (superseded by this
  release).
- Safety is unchanged: one write per plan, a bound grant, per-write approval,
  read-back with `judgeWrite`, no retries, and the current value must have been
  read first.

## 0.4.0 — 2026-10-19

- Added a blocking start-of-page risk warning. On every page load the Workshop
  shows "Use at your own risk" with the non-affiliation and reverse-engineering
  wording, a required "I understand and accept these terms." checkbox, and a
  single Continue action that stays disabled until the box is ticked. There is
  no Cancel. Acceptance is kept in memory for this page load only — it is never
  written to `localStorage`/`sessionStorage` and is not remembered across
  reloads. Connect and Demo both re-check acceptance (and show the same warning
  if it is missing), replacing the old pre-connect dialog so there is no
  duplicate warning.
- Replaced the "Advanced writes (registry-bound)" card with the original-style
  Write Lab card: component filter chips, a live search field, a register picker
  (`Label — Component.NAME (0xADDR)`), the current value and registry kind, a
  Write | Call toggle (Call disabled: "Not available in the Workshop yet"), a
  value editor matched to the register kind (raw hex always shown and
  authoritative), and a Write button that lists every unmet reason instead of
  hiding why it is disabled. The card is always visible and collapsible.
- Replaced the five-register `GENERIC_ALLOWLIST` with `POLICY.genericTier()`
  (`blocked` / `high-impact` / `normal`). Everything registry-writable is
  reachable except the explicitly blocked cases (`DriveUnit.BIKE_LIGHT_POWER`
  points at the Light power control; missing or read-only registers are
  blocked). High-impact registers need an extra typed confirmation of the
  register name, show a "High-impact register" banner in the approval box, and
  carry `highImpactConfirmed: true` in the bound grant, which the writer
  boundary re-checks. Dedicated light controls stay normal-tier.
- Safety is unchanged: one write per plan, a bound grant, per-write approval,
  read-back with `judgeWrite`, no retries, and the current value must have been
  read first.

## 0.3.0 — 2026-10-18

- Restored the original light power UI from the baseline: the power setting
  now appears in the same plan as the other light actions (availability,
  configuration, then power). The separate write-power button and lamp-rating
  checkbox are gone. Light power is an optional extra step included only when
  the value differs from the current reading, with the same safety rules and
  approval logic. The UI shows power presets, a dual-range/number input, and the
  dedicated control stays off-by-default, experimental and known-issue.
- Made the Advanced writes card always visible in the Configure tab, with a
  clear "Arm advanced writes" button. While experimental writes are disabled,
  the button is grayed out with an explanation ("Enable experimental writes first").
  The card mirrors the Classic Reader’s Write Lab: a register picker (only
  allowlisted registers), current value displayed after a read, payload input
  (friendly where the kind is known, otherwise raw hex), a write button, and
  read‑back results. The allowlist (`GENERIC_ALLOWLIST`) is unchanged, and the
  allowed registers are listed so it is obvious why the picker is short.
- Added source checks for the new light-power steps in the plan and for the
  visible Advanced card; added a regression test for the non‑allowlisted
  registers still being blocked at the boundary.

## 0.2.1 — 2026-10-18

- Advanced generic writer is now allowlist-only: it can only target
  `RemoteControl.LANGUAGE`, `RemoteControl.UNITS`, `RemoteControl.TIME_FORMAT`,
  `RemoteControl.TIME` and `RemoteControl.LED_COLORS` (fixed in code). Every
  other register is refused with "Not on the generic-writer allowlist.", while
  registers with a dedicated control (light, service interval, System ID) keep
  their specific reason. The engine boundary and the UI target list both use the
  same policy decision, so a non-allowlisted register never produces a frame.
- Fixed the generic-writer approval details so they resolve the register name
  from the step instead of an undefined variable.

## 0.2.0 — 2026-10-18

- Bound approvals: every write's approval grant is tied to the exact operation
  and payload it authorises, so a step can never be approved for one write and
  used for another (fail closed).
- Bounded light power: the light-power control is limited to 1.0–18.0 W in
  0.1 W steps, validated in the policy before any transport I/O.
- Registry-bound generic writer (advanced): raw writes only ever target a
  register the address registry marks writable, off by default, armed per
  session with a typed confirmation, and re-checked at the writer boundary.
- Pre-connect warning: an explicit, never-remembered acknowledgement is required
  before opening a USB device; demo mode shows its own notice.
- Consistency fixes: evidence chips wrap instead of overflowing, the configure
  layout is repaired, and the Mini Remote state is explained in the UI.
