// BES3 Workshop – write policy (pure)
// -----------------------------------------------------------------------------
// Hardware-free, DOM-free decision logic shared by the Workshop UI and the
// Node regression runner (tools/check-workshop-light.mjs). It defines the
// action-to-write contract, the session-only experimental authorization, and
// the write-verification judgement. It performs no transport I/O and touches
// no DOM, so the exact production policy can be tested without a browser.
//
// Loaded as a plain <script> in index.html (into window.Bes3WritePolicy) and
// as a CommonJS module by the Node runner.
// -----------------------------------------------------------------------------
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Bes3WritePolicy = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Single source of truth for the application version and release date. Bump
  // the minor number for features and the patch number for fixes; keep the top
  // entry of docs/CHANGELOG.md in step (a source check enforces this). The
  // engine and UI read this from the policy object.
  const VERSION = { version: '0.43.2', date: '2026-10-25' };

  // Every operation is experimental and carries an evidence label:
  //   observed-working  — a change was observed on at least one real bike
  //   untested          — no real-hardware evidence yet
  //   known-issue       — a write was reported not to work
  //   unavailable-live  — deliberately disabled for a live connection
  // `address` is the register (null where an operation is not a fixed single
  // register). `writable:false` means the Workshop must never issue this
  // mutation. Tests assert on these identities, not on display text.
  const OBSERVED_WORKING_NOTE =
    'Observed on one Performance Line CX / System Controller setup; not verified on other bikes or firmware.';
  const OP = {
    LIGHT_SWITCH:    { id: 'LIGHT_SWITCH',    component: 'DriveUnit',     name: 'BIKE_LIGHT',               address: 0x181c, writable: true,
      experimental: true, evidence: 'observed-working', evidenceNote: OBSERVED_WORKING_NOTE },
    LIGHT_AVAILABLE: { id: 'LIGHT_AVAILABLE', component: 'DriveUnit',     name: 'BIKE_LIGHT_AVAILABLE',     address: 0x1820, writable: true,
      experimental: true, evidence: 'observed-working', evidenceNote: OBSERVED_WORKING_NOTE },
    LIGHT_CONFIG:    { id: 'LIGHT_CONFIG',    component: 'DriveUnit',     name: 'BIKE_LIGHT_CONFIGURATION', address: 0x1821, writable: true,
      experimental: true, evidence: 'untested', evidenceNote: 'Not verified on real hardware; only mode 2 is documented.' },
    // Enabled but bounded. A dedicated writer accepts only 1.0–18.0 W in 0.1 W
    // steps (validateLightPower), so the wrong-power risk of an unbounded write
    // is contained to that documented range. The evidence is 'known-issue':
    // writing 0x1822 was observed not to change the actual lamp power/output in
    // practice, even when the register acknowledged the write and read back.
    LIGHT_POWER:     { id: 'LIGHT_POWER',     component: 'DriveUnit',     name: 'BIKE_LIGHT_POWER',         address: 0x1822, writable: true,
      experimental: true, evidence: 'known-issue', evidenceNote: 'Observed not working: writing 0x1822 (tested with 12.0 W / 08 78 and 15.0 W / 08 96 01) does not change the actual lamp power or output in practice. The lamp effect and other bikes/firmware are not verified.' },
    SERVICE_DUE:     { id: 'SERVICE_DUE',     component: 'RemoteControl', name: 'SERVICE_DUE',              address: null,   writable: true,
      experimental: true, evidence: 'observed-working', evidenceNote: OBSERVED_WORKING_NOTE },
    BIKE_ID:         { id: 'BIKE_ID',         component: 'RemoteControl', name: 'BIKE_ID',                  address: null,   writable: true,
      experimental: true, evidence: 'untested', evidenceNote: 'Not verified on real hardware; a matching read-back does not prove an error is resolved.' },
    CLEAR_ISSUES:    { id: 'CLEAR_ISSUES',    component: '*',             name: 'EXECUTE_INFORMATION_MANAGER_COMMAND', address: null, writable: true,
      experimental: true, evidence: 'unavailable-live', evidenceNote: 'Live fault clearing is unavailable; it batches multiple RPC mutations.' },
    // Advanced, registry-bound writer. The target register is resolved at
    // runtime from the address registry (never a free-form address) and the raw
    // payload is validated for shape only, not against the register kind. It is
    // experimental and untested, off by default, and gated behind a typed
    // confirmation in the UI.
    GENERIC_WRITE:   { id: 'GENERIC_WRITE',   component: '*',             name: '*',                        address: null,   writable: true,
      experimental: true, evidence: 'untested', evidenceNote: 'Registry-bound raw write; the payload is not validated against the register kind. One write per plan.' },
  };

  const EVIDENCE_LABEL = {
    'observed-working': 'Observed working',
    'untested': 'Untested',
    'known-issue': 'Known issue',
    'unavailable-live': 'Unavailable live',
  };

  // describeOp(id) -> a display-ready, defensive copy of one operation's
  // metadata (or null for an unknown id). Never exposes a mutable reference.
  function describeOp(id) {
    const op = OP[id];
    if (!op) return null;
    return {
      id: op.id,
      component: op.component,
      name: op.name,
      address: op.address,
      writable: op.writable === true,
      experimental: op.experimental === true,
      evidence: op.evidence,
      evidenceLabel: EVIDENCE_LABEL[op.evidence] || op.evidence,
      evidenceNote: op.evidenceNote,
    };
  }

  const POWER_DISABLED_REASON =
    'Experimental — writing light power is not enabled by the Workshop write policy.';
  const VALID_LIGHT_CONFIG = [1, 2, 3];

  function makeStep(opId, label, value) {
    const op = OP[opId];
    return { op: opId, component: op.component, name: op.name, address: op.address, label: label, value: value };
  }

  // varint(v) -> the LEB128 bytes used as a protobuf field-1 varint value.
  // Kept in sync with the engine's protocol encoder; only non-negative integers
  // are used here (tenths of a watt).
  function varint(v) {
    const out = [];
    let n = v;
    while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(n);
    return out;
  }

  function bytesFor(opId, value) {
    // Display-only preview of the payload; execution uses the engine encoders.
    if (opId === 'LIGHT_SWITCH' || opId === 'LIGHT_AVAILABLE') return value ? '08 01' : '(empty)';
    if (opId === 'LIGHT_CONFIG') return value ? ('08 0' + value) : '(empty)';
    if (opId === 'LIGHT_POWER') {
      const r = validateLightPower(value);
      if (!r.ok) return '';
      const raw = Math.round(r.value * 10);
      return [0x08].concat(varint(raw)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    }
    return '';
  }

  function withBytes(s) { s.bytes = bytesFor(s.op, s.value); return s; }

  // planLight(current, desired) -> { steps, error }
  //   current: { available, on, config, powerW }  — value or null when unread
  //   desired: { available, availableTouched, switchOn, config, configTouched,
  //              powerW, powerWTouched }
  //
  // Contract:
  //  - Emits LIGHT_POWER last, only on an explicit, changed, valid power value
  //    (validateLightPower bounds it to 1.0–18.0 W in 0.1 W steps); an unchanged
  //    value adds no step and an invalid value blocks the whole plan.
  //  - Emits LIGHT_AVAILABLE only when the user requested an availability change.
  //  - Emits LIGHT_CONFIG only on an explicit, valid, changed selection.
  //  - Emits LIGHT_SWITCH on explicit opt-in switch-on, or as part of an
  //    explicit "disable output" (off-before-remove), never as a hidden step.
  //  - Unread/unknown current values block the affected action instead of
  //    becoming a guessed default.
  function planLight(current, desired) {
    current = current || {};
    desired = desired || {};
    const steps = [];
    const err = function (msg) { return { steps: [], error: msg }; };

    const configTouched = desired.configTouched === true;
    if (configTouched && VALID_LIGHT_CONFIG.indexOf(desired.config) === -1) {
      return err('Choose a valid light startup mode (1, 2 or 3) before writing.');
    }

    const powerTouched = desired.powerWTouched === true;
    if (powerTouched) {
      const pv = validateLightPower(desired.powerW);
      if (!pv.ok) return err(pv.error);
      if (current.powerW === null || current.powerW === undefined) {
        return err('The current light power could not be read on this bike, so it cannot be changed safely.');
      }
    }

    const availableTouched = desired.availableTouched === true;
    const requestedEnable = availableTouched && desired.available === true;
    const requestedDisable = availableTouched && desired.available === false;

    if ((requestedEnable || requestedDisable) && current.available === null) {
      return err('Light output state could not be read on this bike, so it cannot be changed safely.');
    }

    const enabling = requestedEnable && current.available !== true;
    const disabling = requestedDisable && current.available === true;

    if (enabling) steps.push(makeStep('LIGHT_AVAILABLE', 'Mark bike light as installed', true));
    if (disabling) {
      if (current.on === true) steps.push(makeStep('LIGHT_SWITCH', 'Switch light off', false));
      steps.push(makeStep('LIGHT_AVAILABLE', 'Mark bike light as not installed', false));
    }

    if (configTouched) {
      if (current.available === null && !enabling) {
        return err('Light output state could not be read, so the startup mode cannot be written safely.');
      }
      const installed = enabling || current.available === true;
      if (installed && desired.config !== current.config) {
        steps.push(makeStep('LIGHT_CONFIG', 'Set light startup mode ' + desired.config, desired.config));
      }
    }

    if (desired.switchOn === true) {
      if (current.on === null || current.on === undefined) {
        return err('Light state could not be read, so it cannot be switched.');
      }
      if (current.on !== true && !disabling) {
        steps.push(makeStep('LIGHT_SWITCH', 'Switch light on (function test)', true));
      }
    }

    if (powerTouched) {
      const pv = validateLightPower(desired.powerW);
      if (Math.round(current.powerW * 10) !== Math.round(pv.value * 10)) {
        steps.push(makeStep('LIGHT_POWER', 'Set light power to ' + pv.value.toFixed(1) + ' W', pv.value));
      }
    }

    return { steps: steps.map(withBytes), error: null };
  }

  // planLightSwitch(currentOn) -> { steps, error }
  // The dedicated runtime on/off action: exactly one BIKE_LIGHT mutation.
  function planLightSwitch(currentOn) {
    if (currentOn === null || currentOn === undefined) {
      return { steps: [], error: 'Light state could not be read, so it cannot be switched.' };
    }
    return { steps: [withBytes(makeStep('LIGHT_SWITCH', currentOn ? 'Switch light off' : 'Switch light on', !currentOn))], error: null };
  }

  // validateLightPower(watt) -> { ok, value, error }
  // The only accepted light-power values are finite numbers from 1.0 to 18.0 W
  // inclusive, in exact 0.1 W steps. Nothing is coerced: a string, NaN, null or
  // an out-of-range / sub-tenth value is rejected with a message. The UI, the
  // plan builder and the writer all call this, and the writer calls it before
  // any transport I/O, so an invalid value produces zero mutations.
  const LIGHT_POWER_MIN = 1.0;
  const LIGHT_POWER_MAX = 18.0;
  function validateLightPower(watt) {
    if (typeof watt !== 'number' || !isFinite(watt)) {
      return { ok: false, error: 'Light power must be a number between 1.0 and 18.0 W.' };
    }
    if (watt < LIGHT_POWER_MIN || watt > LIGHT_POWER_MAX) {
      return { ok: false, error: 'Light power must be between 1.0 and 18.0 W.' };
    }
    const tenths = Math.round(watt * 10);
    if (Math.abs(watt * 10 - tenths) > 1e-9) {
      return { ok: false, error: 'Light power must be in 0.1 W steps (at most one decimal place).' };
    }
    return { ok: true, value: tenths / 10, error: null };
  }

  // validateHexPayload(hex) -> { ok, bytes, hex, error }
  // The advanced registry-bound writer accepts a raw hexadecimal payload only:
  // optional whitespace between bytes, an even number of hex digits, and at most
  // 64 bytes. The bytes are returned in order; the canonical lowercase,
  // space-separated `hex` matches the engine's toHex so the grant can be bound to
  // the exact payload.
  const GENERIC_WRITE_MAX_BYTES = 64;
  function validateHexPayload(hex) {
    if (typeof hex !== 'string') return { ok: false, error: 'Enter a hexadecimal payload.' };
    const cleaned = hex.replace(/\s+/g, '');
    if (cleaned === '') return { ok: false, error: 'Enter a hexadecimal payload.' };
    if (!/^[0-9a-fA-F]+$/.test(cleaned)) return { ok: false, error: 'The payload may contain only hexadecimal characters (0-9, a-f).' };
    if (cleaned.length % 2 !== 0) return { ok: false, error: 'The payload must have an even number of hex digits (whole bytes).' };
    if (cleaned.length / 2 > GENERIC_WRITE_MAX_BYTES) {
      return { ok: false, error: 'The payload must be at most ' + GENERIC_WRITE_MAX_BYTES + ' bytes.' };
    }
    const bytes = [];
    for (let i = 0; i < cleaned.length; i += 2) bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
    const canon = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    return { ok: true, bytes: bytes, hex: canon, error: null };
  }

  // The generic writer is tiered instead of allowlisted. The policy itself is
  // DOM-free; it reads the generated address registry (window.Bes3AddressRegistry
  // in the browser, the CommonJS export in Node) so the same production rules run
  // in both environments.
  let registryCache = null;
  function registryEntries() {
    if (registryCache) return registryCache;
    try {
      if (typeof window !== 'undefined' && window.Bes3AddressRegistry) {
        registryCache = window.Bes3AddressRegistry.ADDRESS_REGISTRY.addresses;
      } else if (typeof module !== 'undefined' && module.exports) {
        registryCache = require('../../src/address-registry.generated.js').ADDRESS_REGISTRY.addresses;
      }
    } catch (_) {
      registryCache = null;
    }
    return registryCache;
  }

  const HIGH_IMPACT_PAIRS = [
    ['DriveUnit', 'MAXIMUM_ASSISTANCE_SPEED_IBD'],
    ['DriveUnit', 'REAR_WHEEL_CIRCUMFERENCE_USER'],
    ['DriveUnit', 'WALK_ASSIST_CONFIGURATION'],
    ['DriveUnit', 'START_ASSIST_MODE_CONFIGURATION'],
    ['Battery', 'SO_C_LOWER_LIMIT'],
    ['Battery', 'SO_C_UPPER_LIMIT'],
    ['Battery2', 'SO_C_LOWER_LIMIT'],
    ['Battery2', 'SO_C_UPPER_LIMIT'],
    ['DriveUnit', 'RESET_RIDE_STATISTICS'],
    ['DriveUnit', 'RESET_UDAM_VALUES'],
    ['DriveUnit', 'HIGH_POWER_PORT_ACTIVE'],
    ['DriveUnit', 'LOW_POWER_PORT_ACTIVE'],
    ['DriveUnit', 'MULTI_PURPOSE_PORT_STATUS'],
    ['DriveUnit', 'BATTERY_KEY_LOCK_NUMBER'],
    ['HeadUnit', 'BUZZER'],
    ['RemoteControl', 'BUTTON_EVENTS_ENABLED'],
  ];
  const HIGH_IMPACT = new Set(HIGH_IMPACT_PAIRS.map((pair) => pair.join('.')));
  const HIGH_IMPACT_REASON = 'High-impact register. Type the register name to confirm.';

  // Any name suggesting a lock, security, update, reset, calibration, key or
  // port changes behaviour beyond a simple preference. It is a speed bump, not
  // proof of safety, so it errs on the side of tagging.
  const HIGH_IMPACT_NAME = /(LOCK|SECURITY|SIGNATURE|DEACTIVAT|UPDATE|FIRMWARE|BOOT|FLASH|DFU|ERASE|FACTORY|RESET|CALIBRAT|KEY|PIN|PAIR|BOND|TEST_MODE|TEST_PATTERN|SPEED|CIRCUMFERENCE|LIMIT|PORT)/;
  function isHighImpactName(name) {
    return HIGH_IMPACT_NAME.test(name);
  }

  // The Write Lab shows one pending modal at a time in a single DOM slot. This
  // module holds that bookkeeping without touching the DOM, so the rule can be
  // tested: when a second modal opens while one is pending, the pending one is
  // *cancelled* (resolved with `false`) instead of being left pending forever.
  // A replaced modal must never look like a confirmation, so `false` is the only
  // value a replaced or cancelled modal ever resolves with.
  function createModalStack() {
    let current = null;
    const finish = (entry, value) => {
      if (entry.onClose) { try { entry.onClose(); } catch (_) { /* ignore */ } }
      entry.resolve(value === true);
    };
    return {
      current() { return current; },
      // open(entry) -> the cancelled entry (or null). The new entry becomes the
      // current modal; the previous one is cancelled first.
      open(entry) {
        let cancelled = null;
        if (current) {
          cancelled = current;
          current = null;
          finish(cancelled, false);
        }
        current = entry;
        return cancelled;
      },
      // close(entry, value) -> true when this entry was the current modal and
      // was closed. A stale entry (already replaced) is ignored.
      close(entry, value) {
        if (!entry || current !== entry) return false;
        current = null;
        finish(entry, value);
        return true;
      },
      cancelAll() {
        if (!current) return false;
        const entry = current;
        current = null;
        finish(entry, false);
        return true;
      },
    };
  }

  // writeLabNextStep(state) -> { step, label }
  //   The pure decision logic behind the Write Lab: which prerequisite is
  //   missing next? `state` is a plain snapshot:
  //     sessionOpen         — a live or demo session is open
  //     experimentalEnabled — the session may request writes at all
  //     hasTarget           — a register is selected
  //     targetReadable      — the selected register can be read back
  //     targetRead          — the selected register has been read successfully
  //     payloadValid        — the payload is a valid hex payload
  //     typedNameRequired   — the tier needs the typed register name
  //     typedNameConfirmed  — the typed register name matches the target
  //   `step` is null when nothing is missing.
  const WRITE_LAB_STEPS = {
    session: 'Connect the eBike or start the demo',
    consent: 'Enable experimental writes',
    target: 'Choose a register',
    read: 'Read the register first',
    value: 'Enter a valid value',
    typedName: 'Type the register name to confirm',
  };
  function writeLabNextStep(state) {
    const s = state || {};
    if (!s.sessionOpen) return { step: 'session', label: WRITE_LAB_STEPS.session };
    if (!s.experimentalEnabled) return { step: 'consent', label: WRITE_LAB_STEPS.consent };
    if (!s.hasTarget) return { step: 'target', label: WRITE_LAB_STEPS.target };
    if (s.targetReadable && !s.targetRead) return { step: 'read', label: WRITE_LAB_STEPS.read };
    if (!s.payloadValid) return { step: 'value', label: WRITE_LAB_STEPS.value };
    if (s.typedNameRequired && !s.typedNameConfirmed) return { step: 'typedName', label: WRITE_LAB_STEPS.typedName };
    return { step: null, label: 'All conditions met.' };
  }

  // maskIdentifier(value) -> a masked form of an identifier: the first two and
  // the last two characters are kept, everything in between becomes '*'. Short
  // values are masked completely. Used by the exports that offer anonymisation.
  function maskIdentifier(value) {
    if (value === null || value === undefined || value === '') return value;
    const s = String(value);
    if (s.length <= 4) return '****';
    return s.slice(0, 2) + s.slice(2, -2).replace(/[0-9A-Za-z]/g, '*') + s.slice(-2);
  }

  // The register names whose values are personal identifiers. They are masked
  // in an anonymised export.
  const ANONYMIZED_REGISTERS = [
    'SERIAL_NUMBER', 'OEM_BIKE_ID', 'OEM_BIKE_MODEL_ID', 'BIKE_ID', 'BATTERY_KEY_LOCK_NUMBER',
  ];

  // genericTier(component, name) -> { tier, reason }
  //   blocked           — not in the registry, or reserved for a dedicated
  //                       control (BIKE_LIGHT_POWER). reason is shown to the user.
  //   registry-readonly — in the registry with writable:false. The bike will
  //                       usually refuse such a write, but it is offered under the
  //                       same typed register-name confirmation as high-impact.
  //   high-impact       — writable, but needs an extra typed register-name
  //                       confirmation and a highImpactConfirmed grant flag.
  //   normal            — writable and allowed.
  //
  // The tiers of the whole registry are built in one pass and cached; the cache
  // is dropped when the registry itself changes, so a lookup never walks the
  // registry again.
  function tierOfEntry(entry) {
    if (!entry) {
      return { tier: 'blocked', reason: 'That register is not in the address registry.' };
    }
    if (entry.component === 'DriveUnit' && entry.name === 'BIKE_LIGHT_POWER') {
      return { tier: 'blocked', reason: 'Use the Light power control' };
    }
    if (entry.writable !== true) {
      return { tier: 'registry-readonly', reason: 'Read-only in the registry. The bike will usually refuse this write.' };
    }
    if (HIGH_IMPACT.has(entry.component + '.' + entry.name) || isHighImpactName(entry.name)) {
      return { tier: 'high-impact', reason: HIGH_IMPACT_REASON };
    }
    return { tier: 'normal', reason: null };
  }
  let tierCache = null;
  function tierCacheFor(entries) {
    if (tierCache && tierCache.entries === entries) return tierCache;
    // A missing registry is a fail-closed state, not a crash: genericTier()
    // still returns the blocked reason below. Cache an empty map for it.
    const list = Array.isArray(entries) ? entries : [];
    const map = new Map();
    for (const e of list) {
      if (!e || !e.component || !e.name) continue;
      const key = e.component + '.' + e.name;
      if (map.has(key)) continue;
      map.set(key, tierOfEntry(e));
    }
    tierCache = { entries: entries || null, map };
    return tierCache;
  }
  function genericTier(component, name) {
    const entries = registryEntries();
    const cache = tierCacheFor(entries);
    const key = component + '.' + name;
    if (cache.map.has(key)) return cache.map.get(key);
    const entry = entries ? entries.find((e) => e.component === component && e.name === name) : null;
    const result = tierOfEntry(entry);
    cache.map.set(key, result);
    return result;
  }

  // genericTierMap() -> Map of "Component.NAME" -> { tier, reason } for every
  // registry entry. One pass, cached with the registry: a caller that needs the
  // tier of many entries (the Write Lab picker) never calls genericTier per
  // entry.
  function genericTierMap() {
    return tierCacheFor(registryEntries()).map;
  }

  // genericDenied(component, name) -> the blocked reason, else null. Kept as the
  // engine's name for the blocked-tier check.
  function genericDenied(component, name) {
    const result = genericTier(component, name);
    return result.tier === 'blocked' ? result.reason : null;
  }

  // assertWritable(opId) — throws before any transport I/O when an operation is
  // disabled. The wattage writer calls this first, so an attempted power write
  // produces zero mutations even if invoked programmatically.
  function assertWritable(opId) {
    const op = OP[opId];
    if (!op || op.writable !== true) {
      const reason = opId === 'LIGHT_POWER' ? POWER_DISABLED_REASON
        : ('Operation ' + opId + ' is not enabled by the Workshop write policy.');
      const e = new Error(reason);
      e.code = 'WRITE_BLOCKED';
      throw e;
    }
    return true;
  }

  // judgeWrite(ack, afterValue, matches, options) -> { applied, acked, statusName }
  // Contract:
  //  - `applied` means only that a fresh read-back was available and matched.
  //    It is an observation of current state, not proof of causation or
  //    persistence (the value may already have been equal).
  //  - A missing acknowledgment does NOT by itself deny a matching read-back:
  //    over USB the WRITE_RESPONSE can be absent even when the value applied.
  //  - A missing/unknown read-back is never success, with or without ACK.
  //  - `acked` is always preserved so callers can distinguish the cases.
  //  - `matches` must be the boolean true; truthy values are not coerced.
  //  - options.readable === false means the register cannot be read back. A
  //    transmitted write then stays unverified and is never reported as applied.
  function judgeWrite(ack, afterValue, matches, options) {
    if (options && options.readable === false) {
      return { applied: false, acked: !!ack, statusName: 'unverified (cannot be read back)' };
    }
    const haveRead = afterValue !== null && afterValue !== undefined;
    const confirmed = haveRead && matches === true;
    return {
      applied: confirmed,
      acked: !!ack,
      statusName: !ack ? 'no acknowledgment'
        : confirmed ? 'confirmed by read-back'
          : haveRead ? 'acknowledged, not confirmed' : 'acknowledged, read-back unknown',
    };
  }

  // Session-only experimental authorization. Hardware-changing operations
  // require an explicit opt-in; saved readouts can never write. The opt-in is
  // never persisted and is cleared on disconnect / connection replacement /
  // demo-live transition / import by the engine.
  //
  // `generation` changes whenever authorization is reset or toggled. A plan
  // captures `snapshot()` when it is created and is rejected if the generation
  // moved on — even if the new session has since been authorized. The lock is
  // ownership-based so a delayed completion from an old plan cannot release a
  // newer plan's lock.
  function createSession() {
    let experimental = false;
    let owner = null;
    let generation = 0;
    return {
      setExperimental(on) { experimental = !!on; generation++; if (!experimental) owner = null; },
      isExperimental() { return experimental; },
      canWrite(mode, token) {
        if (token !== undefined && token !== null && token !== generation) return false;
        return experimental === true && (mode === 'live' || mode === 'demo');
      },
      snapshot() { return generation; },
      isCurrent(token) { return token === generation; },
      tryAcquire(candidate) {
        if (owner !== null) return false;
        owner = candidate === undefined ? true : candidate;
        return true;
      },
      release(candidate) {
        // A no-argument release may only free an anonymous lock (owner ===
        // true). An identified owner's lock can only be released by that same
        // owner, so a stray release() can never drop another operation's lock.
        if (candidate === undefined) { if (owner === true) owner = null; return; }
        if (owner === candidate) owner = null;
      },
      isBusy() { return owner !== null; },
      owns(candidate) { return owner !== null && candidate !== undefined && owner === candidate; },
      reset() { experimental = false; owner = null; generation++; },
    };
  }

  function authorizationReason(mode) {
    if (mode === 'file') return 'Saved readouts are read-only. Connect the eBike to make changes.';
    return 'Experimental writes are not enabled for this session. Tick "I understand — enable experimental writes" on the Configure tab first.';
  }

  // approvalRequired(mode) — a live session always requires explicit per-write
  // approval; simulated (demo) sessions and saved readouts do not. The engine
  // uses this both as the runPlan default and to bind direct writer calls.
  function approvalRequired(mode) {
    return mode === 'live';
  }

  // needsApproval(mode, optionFlag) — the per-write approval requirement can
  // only ever be widened by a caller, never removed. A live session always
  // requires approval; an explicit optionFlag === true adds the requirement in
  // any mode (used to exercise the gate in demo). In a non-live mode an
  // optionFlag of false/null/undefined does not add a requirement.
  function needsApproval(mode, optionFlag) {
    return approvalRequired(mode) || optionFlag === true;
  }

  return {
    VERSION: VERSION,
    OP: OP,
    describeOp: describeOp,
    POWER_DISABLED_REASON: POWER_DISABLED_REASON,
    VALID_LIGHT_CONFIG: VALID_LIGHT_CONFIG,
    planLight: planLight,
    planLightSwitch: planLightSwitch,
    assertWritable: assertWritable,
    validateLightPower: validateLightPower,
    validateHexPayload: validateHexPayload,
    genericTier: genericTier,
    genericTierMap: genericTierMap,
    genericDenied: genericDenied,
    writeLabNextStep: writeLabNextStep,
    createModalStack: createModalStack,
    maskIdentifier: maskIdentifier,
    ANONYMIZED_REGISTERS: ANONYMIZED_REGISTERS,
    judgeWrite: judgeWrite,
    createSession: createSession,
    authorizationReason: authorizationReason,
    approvalRequired: approvalRequired,
    needsApproval: needsApproval,
    bytesFor: bytesFor,
  };
});
