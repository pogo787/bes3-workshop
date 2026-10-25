// BES3 Workshop – engine
// -----------------------------------------------------------------------------
// Connection, reading and writing for the BES3 Workshop UI. Built on the same,
// hardware-proven protocol core as the classic reader (src/protocol.js,
// src/messageTypes.js, web/transport-webusb.js) and mirrors its proven
// behaviour: sequence-matched responses, retry on silent drop, keepalive
// heartbeat, and — for every write — an independent re-read afterwards.
//
// Verification rule (learned on the user's own bike, 17.10.2026):
// over USB the WRITE_RESPONSE comes back with an EMPTY payload even when the
// value WAS applied. So a write is only ever judged by re-reading the
// address afterwards and comparing with the requested value.
// -----------------------------------------------------------------------------
(function () {
  'use strict';

  const P = window.Bes3Protocol;
  const MT = window.Bes3MessageTypes;
  const REGISTRY = window.Bes3AddressRegistry.ADDRESS_REGISTRY.addresses;
  const {
    MessageType, buildReadRequestFrame, buildWriteFrame, buildRpcCallFrame, buildRpcCallFrameWithArg,
    parseReadResponseFrame, decodeValue, toHex, encodeBoolArg, encodeEnumArg, encodeStringArg, encodeConfigIdArg,
    decodeConfigIdList, decodeStringList, decodeAssistModeStatistics, decodeUdamParams,
    DiagnosticCommand, encodeExecuteInformationManagerCommandArg, decodeExecuteInformationManagerCommandReturn,
    diagnosticReturnValueName,
  } = P;
  const { decodeTyped } = MT;
  const POLICY = window.Bes3WritePolicy;

  const sleep = (window && typeof window.__bes3Sleep === 'function')
    ? window.__bes3Sleep
    : (ms) => new Promise((r) => setTimeout(r, ms));
  const now = (window && typeof window.__bes3Now === 'function')
    ? window.__bes3Now
    : () => Date.now();
  const dlog = (cat, msg, data) => { if (window.Bes3DebugLog) window.Bes3DebugLog.log(cat, msg, data); };

  // The application version, declared on the write policy (the single source of
  // truth, also mirrored by docs/CHANGELOG.md).
  function appVersion() {
    const v = POLICY.VERSION;
    return v && v.version ? v.version : '0.0.0';
  }
  // The first entry of every session log: which Workshop build produced it.
  function versionLogEntry() {
    return {
      at: new Date(), label: `Workshop v${appVersion()}`, info: true,
      sent: '', before: null, after: null, applied: false, acked: false,
      mode: state.demo ? 'demo' : 'live',
    };
  }

  function entryOf(component, name) {
    return REGISTRY.find((a) => a.component === component && a.name === name) || null;
  }
  function addrOf(component, name) {
    const e = entryOf(component, name);
    return e ? e.address : null;
  }
  // The registry-bound generic writer targets any registry entry the policy does
  // not block. A registry read-only entry is allowed: it needs the typed
  // register-name confirmation, and the bike will usually refuse the write. A
  // high-impact entry needs the same confirmation. Both are re-checked at the
  // writer boundary, which rejects them without the confirmation and with zero
  // I/O.
  function genericTargetReason(component, name) {
    const entry = entryOf(component, name);
    if (!entry) return 'That register is not in the address registry.';
    return POLICY.genericDenied(component, name);
  }
  function registryWritable() {
    return REGISTRY.filter((e) => e.writable === true).map((e) => ({
      component: e.component, name: e.name, address: e.address, kind: e.kind,
      confirmed: e.confirmed === true, label: e.label,
    }));
  }

  // ---------------------------------------------------------------- varints
  function varint(n) {
    // Safe for any non-negative integer up to 2^53 (no 32-bit truncation).
    const out = [];
    let v = Math.floor(n);
    while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
    out.push(v);
    return out;
  }
  function readVarint(bytes, i) {
    // Bounds-check before reading and stop at the protobuf 10-byte limit. The
    // old loop read one undefined byte past the end and kept multiplying mul.
    let result = 0; let mul = 1; let count = 0;
    while (i < bytes.length && count < 10) {
      const b = bytes[i++];
      result += (b & 0x7f) * mul;
      if (!(b & 0x80)) return { value: result, next: i };
      mul *= 0x80;
      count++;
      // Keep the returned value a safe JavaScript integer. Fields used here are
      // small; a longer hostile varint is truncated at this boundary.
      if (!Number.isSafeInteger(result) || !Number.isSafeInteger(mul)) break;
    }
    return { value: result, next: i };
  }
  // field-1 varint message, e.g. Uint8NormFactor10Message / enum / bool
  function encodeField1Varint(v) { return v === 0 ? [] : [0x08, ...varint(v)]; }
  function decodeField1Varint(payload) {
    if (!payload || payload.length === 0) return 0;
    if (payload[0] !== 0x08) return null;
    return readVarint(payload, 1).value;
  }

  // UUID { bytes value = 1 } wrapped in field 1: 0a 12 0a 10 <16 bytes> (or 0a 10 <16 bytes>)
  function encodeUuidPayload(uuidStr) {
    const clean = String(uuidStr || '').replace(/-/g, '').trim();
    if (!/^[0-9a-fA-F]{32}$/.test(clean)) throw new Error('Invalid UUID');
    const bytes = [];
    for (let i = 0; i < 32; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return [0x0a, 0x12, 0x0a, 0x10, ...bytes];
  }
  function decodeUuidBytes(raw) {
    if (!raw || !raw.length) return null;
    let b = null;
    if (raw.length === 20 && raw[0] === 0x0a && raw[1] === 0x12 && raw[2] === 0x0a && raw[3] === 0x10) b = raw.slice(4, 20);
    else if (raw.length === 18 && raw[0] === 0x0a && raw[1] === 0x10) b = raw.slice(2, 18);
    else if (raw.length === 16) b = raw.slice(0, 16);
    if (!b) return null;
    const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }
  function decodeBlePeers(raw) {
    if (!raw || !raw.length) return { count: 0, text: 'no entries', hasMiniRemote: false, hasBleRecord: false, hex: '' };
    const hex = toHex(raw);
    const ascii = raw.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ' ')).join('');
    let nonEmptyRecords = 0; let i = 0;
    while (i < raw.length) {
      const tag = raw[i++]; const wt = tag & 7;
      if (wt === 0) {
        const r = readVarint(raw, i);
        if (r.next <= i) break;
        i = r.next;
        if (r.value > 0) nonEmptyRecords++;
      } else if (wt === 2) {
        const l = readVarint(raw, i);
        if (l.value < 0 || l.next + l.value > raw.length) break;
        if (l.value > 0) nonEmptyRecords++;
        i = l.next + l.value;
      } else break;
    }
    // A non-empty peer database is not proof of a Mini Remote: only the
    // BRC3300 / Mini Remote marker in the payload may make that claim.
    const hasBleRecord = nonEmptyRecords > 0;
    const hasMiniRemote = /BRC3300|Mini\s*Remote/i.test(ascii);
    const text = nonEmptyRecords > 0 ? `${nonEmptyRecords} entry (${raw.length} B)` : `empty slot (${hex})`;
    return { count: nonEmptyRecords, text, hasMiniRemote, hasBleRecord, hex };
  }

  // ServiceDue { Timestamp timestamp = 1 { sint64 seconds = 1 }; uint32 odometer(m) = 2 }
  function encodeServiceDue({ timestamp, odometer }) {
    const out = [];
    if (timestamp && timestamp > 0) {
      const inner = [0x08, ...varint(timestamp * 2)]; // zigzag(+n) = 2n
      out.push(0x0a, inner.length, ...inner);
    }
    if (odometer && odometer > 0) out.push(0x10, ...varint(odometer));
    return out;
  }
  function decodeServiceDue(payload) {
    const out = { timestamp: 0, odometer: 0 };
    let i = 0;
    while (payload && i < payload.length) {
      const tag = payload[i++];
      const field = tag >>> 3; const wt = tag & 7;
      if (wt === 0) { const r = readVarint(payload, i); i = r.next; if (field === 2) out.odometer = r.value; }
      else if (wt === 2) {
        // The length is a varint, not one byte, and the content must fit in the
        // packet. Reject a truncated/overlong record instead of decoding a
        // timestamp from a partial tail.
        const len = readVarint(payload, i); i = len.next;
        if (len.value < 0 || i + len.value > payload.length) break;
        const content = payload.slice(i, i + len.value); i += len.value;
        if (field === 1 && content[0] === 0x08) {
          const z = readVarint(content, 1).value;
          out.timestamp = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
        }
      } else break;
    }
    return out;
  }

  // ------------------------------------------------------------ read plan
  // Curated list for the dashboard + report. Optional components are probed
  // with PRODUCT_NAME first and skipped entirely if absent.
  const READ_PLAN = {
    DriveUnit: ['PRODUCT_NAME', 'PRODUCT_LINE', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION',
      'HARDWARE_VERSION', 'ODOMETER', 'ODOMETER_MOTOR', 'MAXIMUM_ASSISTANCE_SPEED', 'MAXIMUM_LEGAL_BIKE_SPEED',
      'REGIO_SPEED_CONFIGURATION', 'OEM_BRAND_NAME', 'OEM_BIKE_MODEL_ID', 'OEM_BIKE_ID', 'BIKE_ID',
      'BATTERY_KEY_LOCK_NUMBER', 'GEARING_SYSTEM', 'MAXIMUM_GEAR_RATIO', 'REAR_WHEEL_CIRCUMFERENCE_OEM',
      'REAR_WHEEL_CIRCUMFERENCE_USER', 'WALK_ASSIST_CONFIGURATION', 'BIKE_LIGHT', 'BIKE_LIGHT_AVAILABLE',
      'BIKE_LIGHT_CONFIGURATION', 'BIKE_LIGHT_CONFIGURATION_OEM', 'BIKE_LIGHT_POWER', 'POWER_ON_TIME',
      'POWER_ON_TIME_WITH_MOTOR_SUPPORT', 'BIKE_CATEGORY', 'START_ASSIST_MODE_CONFIGURATION', 'TUNING_DETECTION',
      'PRESENT_PCB_TEMPERATURE', 'AVERAGE_RIDER_CADENCE', 'ASSIST_MODE_SHORT_NAMES', 'ASSIST_MODE_COLORS',
      'ACTIVE_ASSIST_MODES'],
    Battery: ['PRODUCT_NAME', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION', 'STATE_OF_CHARGE',
      'STATE_OF_HEALTH', 'PRESENT_CELL_VOLTAGE', 'NUMBER_OF_FULL_CHARGE_CYCLES', 'DELIVERED_WH_OVER_LIFETIME',
      'MINIMUM_PACK_TEMPERATURE', 'MAXIMUM_PACK_TEMPERATURE', 'REMAINING_ENERGY', 'PRESENT_PACK_TEMPERATURE',
      'TOTAL_ENERGY'],
    RemoteControl: ['PRODUCT_NAME', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION', 'SERVICE_DUE',
      'LANGUAGE', 'UNITS', 'TIME', 'TIME_ZONE', 'SYSTEM_LOCKED', 'SYSTEM_LOCK_FEATURE_ENABLED',
      'BIKE_ID', 'BLE_CENTRAL_DATABASE', 'DEVICE_DATABASE', 'DEVICE_AVAILABILITY', 'AVAILABLE_BUTTONS', 'E_SHIFT_AVAILABLE'],
    HeadUnit: ['PRODUCT_NAME', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION', 'HARDWARE_VERSION'],
    Battery2: ['PRODUCT_NAME', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION', 'STATE_OF_CHARGE', 'STATE_OF_HEALTH', 'REMAINING_ENERGY', 'TOTAL_ENERGY', 'NUMBER_OF_FULL_CHARGE_CYCLES'],
    ConnectModule: ['PRODUCT_NAME', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION', 'HARDWARE_VERSION'],
    AntiLockBrakeSystem: ['PRODUCT_NAME', 'PRODUCT_CODE', 'PART_NUMBER', 'SERIAL_NUMBER', 'SOFTWARE_VERSION', 'HARDWARE_VERSION'],
  };
  const CORE_COMPONENTS = ['DriveUnit', 'Battery', 'RemoteControl'];

  // Values the engine knows how to interpret beyond the generic decoder.
  const BOOL_KEYS = new Set(['DriveUnit.BIKE_LIGHT', 'DriveUnit.BIKE_LIGHT_AVAILABLE', 'RemoteControl.SYSTEM_LOCKED',
    'RemoteControl.SYSTEM_LOCK_FEATURE_ENABLED', 'RemoteControl.E_SHIFT_AVAILABLE']);

  function interpret(component, name, addr, payload) {
    const key = `${component}.${name}`;
    const raw = Array.from(payload || []);
    const hex = toHex(raw);
    if (key === 'DriveUnit.BIKE_LIGHT_POWER') {
      const v = decodeField1Varint(raw);
      return { display: v === null ? `hex: ${hex}` : `${(v / 10).toFixed(1)} W`, value: v === null ? null : v / 10, hex };
    }
    if (key === 'DriveUnit.BIKE_LIGHT_CONFIGURATION') {
      const v = decodeField1Varint(raw);
      return { display: v === null ? `hex: ${hex}` : String(v), value: v, hex };
    }
    if (key === 'RemoteControl.BIKE_ID' || key === 'DriveUnit.BIKE_ID') {
      const u = decodeUuidBytes(raw);
      if (u) return { display: u, value: u, hex };
    }
    if (key === 'RemoteControl.BLE_CENTRAL_DATABASE' || key === 'RemoteControl.DEVICE_DATABASE') {
      const info = decodeBlePeers(raw);
      return { display: info.text, value: info, hex };
    }
    if (key === 'RemoteControl.SERVICE_DUE') {
      const v = decodeServiceDue(raw);
      return { display: v.timestamp || v.odometer ? 'set' : 'not set', value: v, hex };
    }
    if (key === 'DriveUnit.AVERAGE_RIDER_CADENCE') {
      const v = decodeField1Varint(raw);
      if (v === null) return { display: `hex: ${hex}`, value: null, hex };
      // The register counts half revolutions per minute, so the raw count is
      // twice the cadence in rpm. The scale was derived by comparing a read of
      // this bike with a Bosch DiagnosticTool report of the same bike (raw 128
      // = 64 rpm); the registry lists the register with kind "unknown" and no
      // unit, so the raw count is kept for reference.
      return { display: `${v / 2} rpm`, value: v / 2, hex, rawCount: v };
    }
    if (BOOL_KEYS.has(key)) {
      const v = decodeField1Varint(raw);
      // An empty payload is the proto3 false default; a non-empty payload that
      // does not start with the field-1 varint tag is an unknown encoding, not
      // a confident "false".
      if (v === null) return { display: `hex: ${hex}`, value: null, hex };
      return { display: v ? 'true' : 'false', value: !!v, hex };
    }
    if (key === 'DriveUnit.ASSIST_MODE_SHORT_NAMES') {
      const names = decodeStringList(raw);
      return { display: names.filter(Boolean).join(', '), value: names, hex };
    }
    if (key === 'DriveUnit.ACTIVE_ASSIST_MODES') {
      const ids = decodeConfigIdList(raw);
      return { display: ids.join(', '), value: ids, hex };
    }
    const typed = decodeTyped(addr, raw);
    if (typed) return { display: typed.display, value: typed.value, hex };
    const g = decodeValue(raw);
    return { display: g.display, value: g.kind === 'string' ? g.value : (g.kind === 'empty' ? null : g.value), hex, generic: g.kind };
  }

  // ------------------------------------------------------------ backend
  // A tiny event emitter so the UI can listen.
  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function off(evt, fn) {
    const a = listeners[evt];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i !== -1) a.splice(i, 1);
  }
  // Iterate over a copy so a handler may unsubscribe (or subscribe) safely.
  // A listener that throws must not freeze the view silently: the error is
  // published on the 'error' channel so the UI can show it.
  function emit(evt, data) {
    (listeners[evt] || []).slice().forEach((fn) => {
      try { fn(data); } catch (e) {
        console.error(e);
        if (evt !== 'error') (listeners['error'] || []).slice().forEach((g) => { try { g(e); } catch (_) { /* ignore */ } });
      }
    });
  }

  const state = {
    mode: 'idle', // idle | connecting | reading | ready | demo | file
    live: false,
    demo: false,
    connectionLost: false,
    connectionLostReason: null,
    values: {}, // key -> {status, display, value, hex}
    components: {}, // component -> present bool
    assistModes: [], // [{configId, name, color, distance, energy, udam}]
    issues: null, // null | [{component, issueId, timestamp, activationCount}]
    issuesScanned: false,
    issuesTruncated: false,
    deviceName: null,
    readAt: null,
    simulatedExport: false, // true only while viewing an imported demo export
    remoteProbe: [], // results of the read-only Mini Remote probe
    remoteProbeAt: null,
    log: [], // writer history
    logHistory: [], // prior sessions' writer history (newest session first)
    lastUnverifiedWrite: null, // most recent interrupted-after-transmission step from a prior session
  };

  let transport = null;
  let connectedDevice = null;
  let seq = 0;
  let busy = Promise.resolve();
  let busyCount = 0;
  let keepaliveTimer = null;
  let consecutiveFailures = 0;
  const KEEPALIVE_ADDR = 0x2106;

  // Session-only experimental authorization + write-plan lock (write-policy.js).
  const guard = POLICY.createSession();

  // The current session mode: 'live' (real USB ), 'demo' (simulated) or 'file'
  // (saved readout, read-only). Hardware-changing operations require 'live' or
  // 'demo' AND the explicit experimental opt-in.
  function sessionMode() { return state.demo ? 'demo' : (state.live && transport ? 'live' : 'file'); }
  function exportSource() { return sessionMode(); }
  function setExperimental(on) { guard.setExperimental(on); emit('change'); }

  // Operation context: binds asynchronous work to the session/transport that
  // started it. A queued or in-flight operation must not adopt a replacement
  // transport or a newly authorized session. Reads only care about the
  // transport; writes also carry the authorization generation and mode.
  function transportContext() { return { transport: transport }; }
  function operationContext() { return { token: guard.snapshot(), transport: transport, mode: sessionMode() }; }
  function ctxCurrent(ctx) {
    if (!ctx || ctx.transport !== transport) return false;
    if (ctx.token === undefined) return true;
    return guard.isCurrent(ctx.token) && sessionMode() === ctx.mode;
  }

  function markConnectionAlive() {
    consecutiveFailures = 0;
    if (state.connectionLost) { state.connectionLost = false; state.connectionLostReason = null; emit('change'); }
  }
  function handleTransportLoss(reason) {
    if (!state.live) return;
    guard.reset();
    clearRemoteProbe();
    dlog('workshop', `connection lost: ${reason}`);
    stopKeepalive();
    removeUsbDisconnectListener();
    try { if (transport && transport.close) transport.close().catch(() => {}); } catch (_) { /* ignore */ }
    transport = null;
    state.live = false;
    state.demo = false;
    state.simulatedExport = false;
    state.connectionLost = true;
    state.connectionLostReason = reason || 'No response from eBike';
    if (state.mode !== 'demo') state.mode = Object.keys(state.values).length ? 'file' : 'idle';
    emit('connectionlost', { reason: state.connectionLostReason });
    emit('disconnect');
    emit('change');
  }

  function nextSeq() { const s = seq; seq = (seq + 1) & 0x0f; return s; }

  // Serialise every transport operation (reads, writes, RPCs, keepalive).
  function exclusive(fn) {
    const run = busy.then(async () => { busyCount++; try { return await fn(); } finally { busyCount--; } });
    busy = run.catch(() => {});
    return run;
  }

  async function drain(ms) {
    const until = now() + ms;
    for (let i = 0; i < 6 && now() < until; i++) {
      if (!transport) return;
      const f = await transport.readNextFrame(1, 2);
      if (!f) break;
    }
  }
  // Sends one frame. The result says whether the frame was handed to the
  // device (`transferred`): a transport that failed *after* the transfer may
  // still have applied the write, and the UI must say so.
  async function send(frame, target) {
    const t = target === undefined ? transport : target;
    if (!t) return { ok: false, transferred: false };
    try { await t.doMcspWrite(frame); return { ok: true, transferred: true }; }
    catch (err) {
      dlog('workshop', `send failed: ${err.message}`);
      consecutiveFailures += 2;
      if (consecutiveFailures >= 3 || /transferOut|disconnected|device|GATT|USB/i.test(err.message || '')) {
        handleTransportLoss('USB transfer failed (' + (err.message || 'device disconnected') + ')');
      }
      return { ok: false, transferred: !!(err && err.transferred === true) };
    }
  }

  // Waits for a response matching addr + type + seq. Returns parsed frame or null.
  // When `ctx` is given, stop as soon as that operation's context is no longer
  // current, so an old operation never reads through a replacement transport.
  async function awaitResponse(addr, type, s, timeoutMs, ctx) {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (ctx && !ctxCurrent(ctx)) return null;
      let frame = null;
      try { frame = await transport.readNextFrame(4, 4); } catch (_) { return null; }
      if (!frame) continue;
      const parsed = parseReadResponseFrame(frame);
      if (!parsed) continue;
      const gotAddr = (parsed.addrHigh << 8) | parsed.addrLow;
      if (gotAddr === (addr & 0x7fff) && parsed.type === type && parsed.seq === s) { markConnectionAlive(); return parsed; }
    }
    return null;
  }

  async function rawRead(addr, ctx) {
    return rawReadWithAttempts(addr, ctx, 3);
  }

  // One read attempt, no retry: used by the read-only remote probe.
  async function rawReadOnce(addr, ctx) {
    return rawReadWithAttempts(addr, ctx, 1);
  }

  async function rawReadWithAttempts(addr, ctx, attempts) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (ctx && !ctxCurrent(ctx)) return null;
      const s = nextSeq();
      await drain(10);
      if (ctx && !ctxCurrent(ctx)) return null;
      if (!(await send(buildReadRequestFrame(addr, s), ctx ? ctx.transport : undefined)).ok) continue;
      const r = await awaitResponse(addr, MessageType.READ_RESPONSE, s, attempt === 0 ? 450 : 700, ctx);
      if (ctx && !ctxCurrent(ctx)) return null;
      if (r) {
        if (!r.ok) return { status: 'declined', statusName: r.statusName, payload: null };
        return { status: 'ok', payload: Array.from(r.payload) };
      }
      await drain(60);
    }
    return { status: 'timeout', payload: null };
  }

  // A state-changing write is transmitted at most once per approved execution.
  // A missing WRITE_RESPONSE is left to read-back verification; it never causes
  // another write transmission.
  async function rawWrite(addr, payload, tag, ctx) {
    const s = nextSeq();
    const frame = buildWriteFrame(addr, s, payload);
    dlog(tag, `-> WRITE 0x${addr.toString(16)} seq ${s}`, frame);
    await drain(10);
    if (ctx && !ctxCurrent(ctx)) {
      return { acked: false, sent: false, blocked: true, interrupted: true, statusName: 'interrupted' };
    }
    const sent = await send(frame, ctx ? ctx.transport : undefined);
    if (!sent.ok) {
      // The frame may already have reached the bike: the step says whether it
      // was transferred, and the read-back still decides the verdict.
      return { acked: false, sent: sent.transferred, statusName: sent.transferred ? 'transferred, not acknowledged' : 'transfer failed' };
    }
    const r = await awaitResponse(addr, MessageType.WRITE_RESPONSE, s, 900, ctx);
    if (ctx && !ctxCurrent(ctx)) {
      return { acked: false, sent: true, interrupted: true, statusName: 'interrupted' };
    }
    if (r) {
      dlog(tag, `<- WRITE_RESPONSE ok=${r.ok} status=${r.statusName}`, r.payload);
      return { acked: r.ok, sent: true, statusName: r.statusName };
    }
    dlog(tag, '<- no WRITE_RESPONSE (single transmission)');
    return { acked: false, sent: true, statusName: 'no response' };
  }

  // A mutating RPC is sent at most once and is bound to the session context,
  // exactly like a write frame. Read RPCs may keep their retries.
  async function rawRpcOnce(addr, argPayload, tag, ctx) {
    if (ctx && !ctxCurrent(ctx)) return { status: 'interrupted', statusName: 'interrupted', payload: null };
    const s = nextSeq();
    const frame = argPayload ? buildRpcCallFrameWithArg(addr, s, argPayload) : buildRpcCallFrame(addr, s);
    if (tag) dlog(tag, `-> RPC 0x${addr.toString(16)} seq ${s} (single attempt)`, frame);
    await drain(10);
    if (ctx && !ctxCurrent(ctx)) return { status: 'interrupted', statusName: 'interrupted', payload: null };
    const sent = await send(frame, ctx ? ctx.transport : undefined);
    if (!sent.ok) return { status: sent.transferred ? 'sent' : 'failed', statusName: sent.transferred ? 'transferred, not acknowledged' : 'transfer failed', payload: null };
    const r = await awaitResponse(addr, MessageType.RPC_RESPONSE, s, 900, ctx);
    if (ctx && !ctxCurrent(ctx)) return { status: 'interrupted', statusName: 'interrupted', payload: null };
    if (r) {
      if (tag) dlog(tag, `<- RPC_RESPONSE ok=${r.ok} status=${r.statusName}`, r.payload);
      if (!r.ok) return { status: 'declined', statusName: r.statusName, payload: null };
      return { status: 'ok', payload: Array.from(r.payload) };
    }
    return { status: 'timeout', statusName: 'no response', payload: null };
  }

  async function rawRpc(addr, argPayload, tag, ctx) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (ctx && !ctxCurrent(ctx)) return { status: 'interrupted', payload: null };
      const s = nextSeq();
      const frame = argPayload ? buildRpcCallFrameWithArg(addr, s, argPayload) : buildRpcCallFrame(addr, s);
      if (tag) dlog(tag, `-> RPC 0x${addr.toString(16)} attempt ${attempt} seq ${s}`, frame);
      await drain(10);
      if (ctx && !ctxCurrent(ctx)) return { status: 'interrupted', payload: null };
      const sent = await send(frame, ctx ? ctx.transport : undefined);
      if (!sent.ok) { await drain(60); continue; }
      const r = await awaitResponse(addr, MessageType.RPC_RESPONSE, s, attempt === 0 ? 600 : 900, ctx);
      if (ctx && !ctxCurrent(ctx)) return { status: 'interrupted', payload: null };
      if (r) {
        if (tag) dlog(tag, `<- RPC_RESPONSE ok=${r.ok} status=${r.statusName}`, r.payload);
        if (!r.ok) return { status: 'declined', statusName: r.statusName, payload: null };
        return { status: 'ok', payload: Array.from(r.payload) };
      }
      await drain(60);
    }
    return { status: 'timeout', payload: null };
  }

  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
      if (!transport || busyCount > 0) return;
      exclusive(async () => {
        try {
          if (!transport) return;
          const s = nextSeq();
          const sent = await send(buildRpcCallFrame(KEEPALIVE_ADDR, s));
          // send() returns an object, not a boolean. A failed send already
          // counted the failure; do not wait for a response and count it again.
          if (!sent.ok) return;
          {
            const r = await awaitResponse(KEEPALIVE_ADDR, MessageType.RPC_RESPONSE, s, 350);
            if (!r) {
              consecutiveFailures++;
              if (consecutiveFailures >= 3) handleTransportLoss('eBike stopped responding (switched off or cable unplugged)');
            }
          }
        } catch (_) { /* ignore */ }
      });
    }, 800);
  }
  function stopKeepalive() { if (keepaliveTimer) clearInterval(keepaliveTimer); keepaliveTimer = null; }

  // The Mini Remote probe: READ requests only, for every readable registry
  // entry whose name or label mentions the remote, the BLE stack, buttons,
  // pairing or the eShift. Nothing is written, and every register is read
  // exactly once (no retries).
  // A probe belongs to one session. Clear it whenever that session ends or is
  // replaced so old rows cannot appear in a new readout or export.
  function clearRemoteProbe() {
    state.remoteProbe = [];
    state.remoteProbeAt = null;
  }
  const REMOTE_PROBE_KEYWORDS = ['REMOTE', 'BLE', 'BUTTON', 'MINI', 'PERIPHERAL', 'PAIR', 'BOND', 'DEVICE_DATABASE', 'DEVICE_AVAILABILITY', 'CONNECTED', 'ESHIFT'];
  function remoteProbeCandidates() {
    const entries = REGISTRY;
    const out = [];
    for (const e of entries) {
      if (!e || !e.component || !e.name) continue;
      if (e.readable === false) continue;
      const hay = (e.name + ' ' + (e.label || '')).toUpperCase();
      if (!REMOTE_PROBE_KEYWORDS.some((k) => hay.indexOf(k) !== -1)) continue;
      out.push(e);
    }
    return out;
  }
  async function probeRemoteRegisters() {
    if (!state.live || !transport) throw new Error('Not connected to an eBike');
    const results = [];
    const ctx = transportContext();
    for (const e of remoteProbeCandidates()) {
      if (!ctxCurrent(ctx)) break;
      const addr = addrOf(e.component, e.name);
      const res = await exclusive(() => rawReadOnce(addr, ctx));
      const stored = res && res.status === 'ok' ? storeValue(e.component, e.name, res) : null;
      results.push({
        component: e.component,
        name: e.name,
        label: e.label || e.name,
        address: addr,
        status: res ? res.status : 'no response',
        hex: stored && typeof stored.hex === 'string' ? stored.hex : '',
        display: stored ? stored.display : (res ? res.status : 'no response'),
      });
    }
    state.remoteProbe = results;
    state.remoteProbeAt = new Date();
    emit('change');
    return results;
  }

  // ------------------------------------------------------------ reading
  function storeValue(component, name, res) {
    const key = `${component}.${name}`;
    const addr = addrOf(component, name);
    if (res.status === 'ok') {
      state.values[key] = { status: 'ok', ...interpret(component, name, addr, res.payload) };
    } else {
      state.values[key] = { status: res.status, display: res.status === 'declined' ? 'declined' : 'no response', value: null, hex: '' };
    }
    return state.values[key];
  }

  async function readKey(component, name) {
    const addr = addrOf(component, name);
    if (addr == null) return null;
    const ctx = transportContext();
    const res = await exclusive(() => rawRead(addr, ctx));
    if (res === null || !ctxCurrent(ctx)) return null;
    return storeValue(component, name, res);
  }

  // Read-back used by write verification: the fresh value is stored only if the
  // originating write context is still current.
  async function readKeyInContext(component, name, ctx) {
    const addr = addrOf(component, name);
    if (addr == null) return null;
    if (!ctxCurrent(ctx)) return null;
    const res = await exclusive(() => rawRead(addr, ctx));
    if (res === null || !ctxCurrent(ctx)) return null;
    return storeValue(component, name, res);
  }

  function planCount() {
    return Object.values(READ_PLAN).reduce((a, l) => a + l.length, 0) + 12;
  }

  let readRunId = 0;
  let readInFlight = null;

  async function readAll() {
    if (readInFlight) return readInFlight;
    const runId = ++readRunId;
    const ctx = transportContext();
    const run = (async () => {
      state.mode = 'reading';
      clearRemoteProbe();
      state.values = {};
      state.components = {};
      state.assistModes = [];
      state.issues = null;
      state.issuesScanned = false;
      state.issuesTruncated = false;
      const total = planCount();
      let done = 0;
      const progress = (label) => emit('progress', { done, total, label });
      emit('change');

      try {
        for (const [component, names] of Object.entries(READ_PLAN)) {
          if (runId !== readRunId || !ctxCurrent(ctx)) return;
          const core = CORE_COMPONENTS.includes(component);
          for (let i = 0; i < names.length; i++) {
            if (runId !== readRunId || !ctxCurrent(ctx)) return;
            const name = names[i];
            progress(`${component} · ${name}`);
            const v = await readKeyInContext(component, name, ctx);
            if (!v || runId !== readRunId || !ctxCurrent(ctx)) return;
            done++;
            if (i === 0 && !core && v.status !== 'ok') {
              state.components[component] = false;
              done += names.length - 1;
              break;
            }
            if (i === 0) state.components[component] = v.status === 'ok';
          }
        }
        if (runId !== readRunId || !ctxCurrent(ctx)) return;
        progress('Assistance modes');
        await readAssistModes(ctx, runId);
        if (runId !== readRunId || !ctxCurrent(ctx)) return;
        done += 8;
        progress('Fault memory');
        await scanIssues(ctx, runId);
        if (runId !== readRunId || !ctxCurrent(ctx)) return;
        done += 4;
        progress('complete');
        state.mode = state.demo ? 'demo' : 'ready';
        state.readAt = new Date();
        emit('change');
      } finally {
        if (readInFlight === run) readInFlight = null;
        if (state.mode === 'reading' && !ctxCurrent(ctx)) {
          state.mode = Object.keys(state.values).length ? 'file' : 'idle';
          emit('change');
        }
      }
    })();
    readInFlight = run;
    return run;
  }

  async function readAssistModes(ctx, runId) {
    const useCtx = ctx || transportContext();
    const STATS = addrOf('DriveUnit', 'GET_ASSIST_MODE_STATISTICS');
    const UDAM = addrOf('DriveUnit', 'READ_UDAM_VALUES');
    const active = state.values['DriveUnit.ACTIVE_ASSIST_MODES'];
    const ids = ['0'];
    if (active && Array.isArray(active.value)) active.value.forEach((id) => { if (id && !ids.includes(id)) ids.push(id); });
    const names = (state.values['DriveUnit.ASSIST_MODE_SHORT_NAMES'] || {}).value || [];
    const colors = (state.values['DriveUnit.ASSIST_MODE_COLORS'] || {}).value || [];
    const aligned = names.length === ids.length || names.length === ids.length + 1;
    const modes = ids.map((configId, i) => ({
      configId,
      name: (aligned ? names[i] : names[i - 1]) || (i === 0 ? 'OFF' : `Mode ${i}`),
      color: colors[i] && colors[i].hex && colors[i].hex !== '#000000' ? colors[i].hex : null,
      // Every mode the bike reports an id for is an active mode.
      active: true,
      distance: null, energy: null, udam: null,
    }));
    // The bike can have more mode slots (names, colours) than it reports ids
    // for: a slot without a config id is a deactivated mode. Its statistics
    // cannot be read, because every statistics RPC is keyed by a config id and
    // the bike reports none for that slot. The slot is shown, marked
    // "deactivated", instead of being guessed at.
    if (aligned && names.length > ids.length) {
      for (let i = ids.length; i < names.length; i++) {
        const name = names[i];
        if (!name) continue;
        modes.push({
          configId: null,
          name: name,
          color: colors[i] && colors[i].hex && colors[i].hex !== '#000000' ? colors[i].hex : null,
          active: false,
          distance: null, energy: null, udam: null,
        });
      }
    }
    for (const m of modes) {
      if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
      if (!m.configId) continue; // a deactivated slot has no id: no statistics
      if (STATS) {
        const r = await exclusive(() => rawRpc(STATS, encodeConfigIdArg(m.configId), 'assist-rpc', useCtx));
        if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
        if (r.status === 'ok') {
          const s = decodeAssistModeStatistics(r.payload);
          m.distance = s.distance; m.energy = s.consumedEnergy;
        }
      }
      if (UDAM && m.configId !== '0') {
        const r = await exclusive(() => rawRpc(UDAM, encodeConfigIdArg(m.configId), 'assist-rpc', useCtx));
        if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
        if (r.status === 'ok') m.udam = decodeUdamParams(r.payload);
      }
    }
    if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
    state.assistModes = modes;
  }

  async function scanIssues(ctx, runId) {
    const useCtx = ctx || transportContext();
    const out = [];
    let anyAnswer = false;
    let truncated = false;
    for (const component of Object.keys(READ_PLAN)) {
      if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
      if (!state.components[component]) continue;
      const addr = addrOf(component, 'EXECUTE_INFORMATION_MANAGER_COMMAND_BOSCH');
      if (addr == null) continue;
      const countRes = await exclusive(() => rawRpc(addr, encodeExecuteInformationManagerCommandArg(DiagnosticCommand.GET_ISSUE_COUNT, 0), 'diag', useCtx));
      if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
      if (countRes.status !== 'ok') continue;
      anyAnswer = true;
      const c = decodeExecuteInformationManagerCommandReturn(countRes.payload);
      const totalCount = c.entryCount || 0;
      const n = Math.min(totalCount, 40);
      if (totalCount > 40) truncated = true;
      // Entries are numbered from 0 (same as the classic reader's diagnostics card).
      for (let k = 0; k < n; k++) {
        if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
        const r = await exclusive(() => rawRpc(addr, encodeExecuteInformationManagerCommandArg(DiagnosticCommand.READ_ISSUE_BY_NUMBER, k), 'diag', useCtx));
        if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
        if (r.status !== 'ok') break;
        const d = decodeExecuteInformationManagerCommandReturn(r.payload);
        if (d.returnValue === 1 /* DOES_NOT_EXIST */) break;
        if (d.returnValue !== 0 || d.issueId == null) continue;
        out.push({ component, issueId: d.issueId, timestamp: d.timestamp, activationCount: d.activationCount });
      }
    }
    if ((runId !== undefined && runId !== readRunId) || !ctxCurrent(useCtx)) return;
    state.issues = out;
    state.issuesScanned = anyAnswer;
    state.issuesTruncated = truncated;
  }

  // Experimental fault memory clearing via EXECUTE_INFORMATION_MANAGER_COMMAND_*
  // DiagnosticCommandEnum: 1 = DELETE_ISSUE (with field 2 IssueId{1: issueId}), 2 = DELETE_ALL_ISSUES.
  async function clearFaultMemory(owner) {
    let acquiredHere = false;
    if (owner === undefined || owner === null) {
      const self = {};
      if (!guard.tryAcquire(self)) {
        const e = new Error('Another write is already in progress. Wait for it to finish.'); e.code = 'WRITE_BLOCKED'; throw e;
      }
      owner = self; acquiredHere = true;
    } else if (!guard.owns(owner)) {
      const e = new Error('This write is not part of the active write plan.'); e.code = 'WRITE_BLOCKED'; throw e;
    }
    try {
      if (!state.live || !transport) throw new Error('Not connected to an eBike');
      const mode = sessionMode();
      if (mode !== 'demo') {
        // Temporarily disabled: the current implementation batches several RPC
        // mutations (delete-all plus per-entry deletes across components). That
        // is incompatible with approval of exactly one mutation at a time.
        const e = new Error('Live fault-memory clearing is temporarily unavailable: it batches multiple RPC mutations, which cannot be individually approved. Fault reading is unaffected.');
        e.code = 'WRITE_BLOCKED';
        throw e;
      }
      if (!guard.canWrite(mode)) {
        const e = new Error(POLICY.authorizationReason(mode)); e.code = 'WRITE_BLOCKED'; throw e;
      }
    // Every mutating RPC is sent once and is bound to the session that started
    // it: a session change stops the batch.
    const ctx = operationContext();
    const beforeIssues = (state.issues || []).slice();
    const beforeCount = beforeIssues.length;
    const comps = [...new Set(beforeIssues.map((i) => i.component))];
    if (!comps.length) comps.push('RemoteControl', 'DriveUnit', 'Battery');
    const sentPayloads = [];
    let lastStatus = 'no response';
    let anyAck = false;

    for (const component of comps) {
      const tiers = [
        addrOf(component, 'EXECUTE_INFORMATION_MANAGER_COMMAND_BOSCH'),
        addrOf(component, 'EXECUTE_INFORMATION_MANAGER_COMMAND_IBD'),
        addrOf(component, 'EXECUTE_INFORMATION_MANAGER_COMMAND_SP'),
      ].filter((a) => a != null);
      const compIssues = beforeIssues.filter((i) => i.component === component);

      for (const addr of tiers) {
        const argAll = [0x08, 0x02];
        sentPayloads.push(toHex(argAll));
        const rAll = await exclusive(() => rawRpcOnce(addr, argAll, 'diag-clear', ctx));
        if (rAll.status === 'ok') {
          anyAck = true;
          const dec = decodeExecuteInformationManagerCommandReturn(rAll.payload);
          lastStatus = dec.returnValue === 0 ? 'SUCCESS' : `RET_${dec.returnValue}`;
        } else {
          lastStatus = rAll.status;
        }
        for (const it of compIssues) {
          if (!it.issueId) continue;
          const idInner = [0x08, ...varint(it.issueId)];
          const argOne = [0x08, 0x01, 0x12, idInner.length, ...idInner];
          sentPayloads.push(toHex(argOne));
          const rOne = await exclusive(() => rawRpcOnce(addr, argOne, 'diag-clear', ctx));
          if (rOne.status === 'ok') anyAck = true;
        }
        if (anyAck) break;
      }
    }

    await sleep(state.demo ? 200 : 500);
    await scanIssues();
    const afterCount = (state.issues || []).length;
    const applied = beforeCount === 0 ? true : afterCount === 0;
    const step = {
      at: new Date(),
      mode,
      label: 'Clear fault memory (experimental)',
      component: comps.join(', '),
      name: 'EXECUTE_INFORMATION_MANAGER_COMMAND',
      sent: sentPayloads.slice(0, 2).join(' / ') || '08 02',
      acked: anyAck,
      statusName: lastStatus,
      applied,
      before: `${beforeCount} entr${beforeCount === 1 ? 'y' : 'ies'}`,
      after: `${afterCount} entr${afterCount === 1 ? 'y' : 'ies'}`,
      // The exact number of mutating RPC frames this action sends.
      mutations: sentPayloads.length,
    };
    state.log.push(step);
    dlog('workshop', `clearFaultMemory: acked=${anyAck} before=${beforeCount} after=${afterCount}`);
    emit('change');
    return step;
    } finally {
      if (acquiredHere) guard.release(owner);
    }
  }

  // ------------------------------------------------------------ writing
  // Every write goes through here: write -> short settle -> independent re-read
  // -> compare against the expected value. Returns a step result object.
  async function writeVerified(component, name, payload, expect, label, owner, options) {
    // Mutations are mutually exclusive: a plan passes its owner; a direct
    // writer takes a fresh lock for the duration of this write.
    let acquiredHere = false;
    if (owner === undefined || owner === null) {
      const self = {};
      if (!guard.tryAcquire(self)) {
        const reason = 'Another write is already in progress. Wait for it to finish.';
        state.log.push({ at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
          mode: sessionMode(), acked: false, applied: false, blocked: true, statusName: 'blocked', before: '–', after: '–', reason });
        emit('change');
        const e = new Error(reason); e.code = 'WRITE_BLOCKED'; throw e;
      }
      owner = self; acquiredHere = true;
    } else if (!guard.owns(owner)) {
      const reason = 'This write is not part of the active write plan.';
      state.log.push({ at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
        mode: sessionMode(), acked: false, applied: false, blocked: true, statusName: 'blocked', before: '–', after: '–', reason });
      emit('change');
      const e = new Error(reason); e.code = 'WRITE_BLOCKED'; throw e;
    }
    try {
      const mode = sessionMode();
      // A direct writer (no plan owner) is bound by the same approval contract:
      // in live mode it requires per-write approval and can never carry a grant,
      // so it is blocked at the writer boundary below.
      if (acquiredHere) owner.requireApproval = POLICY.approvalRequired(mode);
      if (!guard.canWrite(mode)) {
        const reason = POLICY.authorizationReason(mode);
        state.log.push({
          at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
          mode, acked: false, applied: false, blocked: true, statusName: 'blocked', before: '–', after: '–', reason,
        });
        emit('change');
        dlog('workshop', `${label}: blocked (${mode})`);
        const e = new Error(reason); e.code = 'WRITE_BLOCKED'; throw e;
      }
      // High-impact registers always need the typed-register-name confirmation
      // carried in the one-shot grant, even in a mode where per-write approval is
      // not otherwise required. The grant carries the *typed name itself*, not a
      // boolean, and the engine compares it with the target: the UI cannot turn
      // a boolean into a confirmation. The registry read-only tier is only
      // writeable through the generic writer, so its typed confirmation is
      // required there; dedicated fixed-operation writers (such as the System ID
      // sync) keep their own gate and are not subject to the generic tier.
      const precheckTier = POLICY.genericTier(component, name).tier;
      const genericTarget = !!(options && options.generic === true);
      const typedNameRequired = precheckTier === 'high-impact' || (precheckTier === 'registry-readonly' && genericTarget);
      if (typedNameRequired) {
        const hiGrant = owner.approvedWrite;
        const typedOk = !!hiGrant && hiGrant !== true && hiGrant.typedName === component + '.' + name;
        if (!typedOk) {
          const reason = 'This register requires a typed register-name confirmation, and this write carries none. The write was blocked.';
          state.log.push({
            at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
            mode, acked: false, applied: false, blocked: true, statusName: 'blocked', before: '–', after: '–', reason,
          });
          emit('change');
          dlog('workshop', `${label}: blocked (typed register-name confirmation)`);
          const e = new Error(reason); e.code = 'WRITE_BLOCKED'; throw e;
        }
      }
      // Writer-boundary enforcement: a write that requires approval must find a
      // one-shot grant that matches the actual write, and consume it before any
      // transmission. The requirement is driven by the live mode as well as the
      // owner, so it holds even if a caller bypasses runPlan. One grant covers
      // exactly one write (a step performing two writes sees the second one
      // blocked), and a write whose operation or payload differs from the
      // approved step is blocked with nothing sent.
      if (owner.requireApproval === true || POLICY.approvalRequired(mode)) {
        const grant = owner.approvedWrite;
        // Consume the grant regardless of outcome: it authorizes at most one write.
        owner.approvedWrite = false;
        const payloadHex = toHex(payload) || '(empty)';
        let reason = null;
        if (!grant || grant === true) {
          reason = 'This write requires per-write approval, and no approval was granted for this step.';
        } else if (grant.op === 'GENERIC_WRITE') {
          // The registry-bound writer carries its own target in the grant; re-check
          // the registry membership, writable flag and denylist, then the binding.
          reason = genericTargetReason(component, name);
          if (!reason && (grant.component !== component || grant.name !== name)) {
            reason = 'The approved register does not match the write being sent, so the write was blocked.';
          } else if (!reason && grant.address !== addrOf(component, name)) {
            reason = 'The approved register address does not match the write being sent, so the write was blocked.';
          } else if (!reason && grant.bytes !== payloadHex) {
            reason = 'The approved payload does not match the write being sent, so the write was blocked.';
          } else if (!reason
            && (POLICY.genericTier(component, name).tier === 'high-impact' || POLICY.genericTier(component, name).tier === 'registry-readonly')
            && grant.typedName !== component + '.' + name) {
            reason = 'This register requires a typed register-name confirmation, and the approval does not carry it. The write was blocked.';
          }
        } else {
          const grantOp = POLICY.OP[grant.op];
          if (!grantOp) {
            reason = 'The approved operation is not a known write operation, so the write was blocked.';
          } else if (grantOp.component !== component || grantOp.name !== name) {
            reason = 'The approved operation does not match the write being sent, so the write was blocked.';
          } else if (grant.bytes !== payloadHex) {
            reason = 'The approved payload does not match the write being sent, so the write was blocked.';
          }
        }
        if (reason) {
          state.log.push({
            at: new Date(), label, component, name, sent: payloadHex,
            mode, acked: false, applied: false, blocked: true, statusName: 'blocked', before: '–', after: '–', reason,
          });
          emit('change');
          dlog('workshop', `${label}: blocked (approval binding)`);
          const e = new Error(reason); e.code = 'WRITE_BLOCKED'; throw e;
        }
      }
      const ctx = operationContext();
      const addr = addrOf(component, name);
      const before = state.values[`${component}.${name}`] ? { ...state.values[`${component}.${name}`] } : null;
      const tag = `write-${name}`;
      const interrupted = (sent, acked) => {
        const step = {
          at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
          transmitted: !!sent, acked: !!acked, applied: false, blocked: !sent, interrupted: true,
          statusName: 'interrupted', before: '–', after: '–',
          reason: sent
            ? 'The frame was transmitted and may have been applied by the bike; the read-back decides the result. The session changed before the read-back could verify it, and no retry was attempted.'
            : 'The session changed before the write was transmitted. Nothing was sent.',
        };
        // A possibly-transmitted write is published only into the connection it
        // was sent on. A replacement transport must not inherit the entry.
        if (sent && ctx.transport === transport) {
          state.log.push({ ...step, mode });
          dlog('workshop', `${label}: interrupted after transmission (unverified)`);
          emit('change');
        }
        return step;
      };

      const write = await exclusive(() => {
        if (!ctxCurrent(ctx)) return { acked: false, sent: false, blocked: true, interrupted: true, statusName: 'interrupted' };
        return rawWrite(addr, payload, tag, ctx);
      });
      if (write.interrupted) return interrupted(write.sent, write.acked);
      if (!ctxCurrent(ctx)) return interrupted(write.sent, write.acked);

      // Some registry entries are write-only: they cannot be read back. A
      // transmitted write is therefore never called applied. No retry is made.
      const targetEntry = entryOf(component, name);
      if (targetEntry && targetEntry.readable === false) {
        const judged = POLICY.judgeWrite(write.acked, null, false, { readable: false });
        const step = {
          at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
          mode, acked: write.acked, statusName: judged.statusName, ackStatus: write.statusName, applied: false,
          before: before ? before.display : '–', after: '–',
          reason: 'This register cannot be read back, so the write is unverified. Nothing was retried and nothing was rolled back.',
        };
        if (!ctxCurrent(ctx)) return interrupted(true, write.acked);
        state.log.push(step);
        dlog('workshop', `${label}: acked=${write.acked} unverified (cannot be read back)`, payload);
        emit('change');
        return step;
      }

      await sleep(state.demo ? 250 : 700);
      if (!ctxCurrent(ctx)) return interrupted(true, write.acked);
      let after = await readKeyInContext(component, name, ctx);
      if (after === null || !ctxCurrent(ctx)) return interrupted(true, write.acked);
      let applied = after.status === 'ok' && expect(after.value, after) === true;
      if (!applied && write.acked) {
        // A second look — the drive unit sometimes needs a moment. This is a
        // read-back only; the write itself is never retransmitted.
        await sleep(900);
        if (!ctxCurrent(ctx)) return interrupted(true, write.acked);
        after = await readKeyInContext(component, name, ctx);
        if (after === null || !ctxCurrent(ctx)) return interrupted(true, write.acked);
        applied = after.status === 'ok' && expect(after.value, after) === true;
      }
      // The applied/statusName verdict comes from the shared, tested judgeWrite
      // contract; the raw acknowledgment status text is kept separately. The
      // read-back marker is only formed when the re-read succeeded: a declined
      // or failed read-back is no read at all ("read-back unknown"). For a
      // successful read it is the decoded value when the register has one, and
      // the raw payload otherwise: a register whose value cannot be decoded (a
      // raw payload written by the Write Lab, for example) still had a fresh
      // read-back, and a byte-identical read-back is a match.
      const readBack = after.status === 'ok'
        ? (after.value !== null && after.value !== undefined ? after.value : (after.hex || ''))
        : null;
      const judged = POLICY.judgeWrite(write.acked, readBack, applied);
      const step = {
        at: new Date(), label, component, name, sent: toHex(payload) || '(empty)',
        mode, acked: write.acked, statusName: judged.statusName, ackStatus: write.statusName, applied: judged.applied,
        before: before ? before.display : '–', after: after ? after.display : '–',
      };
      if (!ctxCurrent(ctx)) return interrupted(true, write.acked);
      state.log.push(step);
      dlog('workshop', `${label}: acked=${write.acked} applied=${judged.applied}`, payload);
      emit('change');
      return step;
    } finally {
      if (acquiredHere) guard.release(owner);
    }
  }

  const Writers = {
    lightAvailable(on, owner) {
      return writeVerified('DriveUnit', 'BIKE_LIGHT_AVAILABLE', encodeBoolArg(on), (v) => v === on,
        on ? 'Mark bike light as installed' : 'Mark bike light as not installed', owner);
    },
    lightConfiguration(v, owner) {
      return writeVerified('DriveUnit', 'BIKE_LIGHT_CONFIGURATION', v === 0 ? [] : encodeEnumArg(v), (x) => x === v,
        `Set light configuration to ${v}`, owner);
    },
    lightPower(watt, owner) {
      // Validate first: only 1.0–18.0 W in 0.1 W steps, before any transport I/O.
      const v = POLICY.validateLightPower(watt);
      if (!v.ok) {
        const e = new Error(v.error);
        e.code = 'WRITE_BLOCKED';
        throw e;
      }
      POLICY.assertWritable('LIGHT_POWER');
      const raw = Math.round(v.value * 10);
      return writeVerified('DriveUnit', 'BIKE_LIGHT_POWER', encodeField1Varint(raw), (x) => Math.round((x || 0) * 10) === raw,
        `Set bike light power to ${(raw / 10).toFixed(1)} W`, owner);
    },
    lightSwitch(on, owner) {
      return writeVerified('DriveUnit', 'BIKE_LIGHT', encodeBoolArg(on), (v) => v === on,
        on ? 'Switch bike light on' : 'Switch bike light off', owner);
    },
    serviceDue({ timestamp, odometer }, owner) {
      const payload = encodeServiceDue({ timestamp, odometer });
      const del = payload.length === 0;
      return writeVerified('RemoteControl', 'SERVICE_DUE', payload,
        (v) => v && (v.timestamp || 0) === (timestamp || 0) && (v.odometer || 0) === (odometer || 0),
        del ? 'Clear service interval' : 'Set service interval', owner);
    },
    syncBikeId(targetComponent, uuidStr, owner) {
      const payload = encodeUuidPayload(uuidStr);
      const norm = String(uuidStr || '').toLowerCase();
      return writeVerified(targetComponent, 'BIKE_ID', payload,
        (v) => String(v || '').toLowerCase() === norm,
        `Sync System ID to ${targetComponent === 'RemoteControl' ? 'Control Unit' : 'Drive Unit'}`, owner);
    },
    // Registry-bound generic writer (advanced). Only ever targets a register the
    // policy does not reserve for a dedicated control. Registry read-only entries
    // are allowed but still require the typed register-name confirmation checked
    // in writeVerified (the bike will usually refuse them). The raw payload is
    // written as-is; when the register is readable the re-read must match,
    // otherwise the result stays unverified. One write per plan.
    generic(component, name, payloadBytes, owner) {
      const reason = genericTargetReason(component, name);
      if (reason) { const e = new Error(reason); e.code = 'WRITE_BLOCKED'; throw e; }
      const payload = Array.from(payloadBytes || []);
      const payloadHex = toHex(payload) || '(empty)';
      return writeVerified(component, name, payload, (_v, after) => after && after.hex === payloadHex,
        `Write raw payload to ${component}.${name}`, owner, { generic: true });
    },
  };

  // Races an approval decision against a timeout. A timeout (or a rejection)
  // counts as "not granted"; a resolution that arrives after the timeout is
  // ignored, and the timer is cleared as soon as the decision settles so no
  // dangling timer keeps the page (or the runner) alive.
  function requireDecision(decision, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v === true); };
      const timer = setTimeout(() => finish(false), timeoutMs);
      Promise.resolve(decision).then((v) => finish(v), () => finish(false));
    });
  }

  // Runs a list of step functions in order and stops at the first one that
  // was not applied. onStep is called before/after each step for progress UI.
  //
  // Per-write approval: in live mode every state-changing write needs its own
  // user approval, including each step of a multi-step plan. `options.approve`
  // is an async function called with { index, total, step } and must resolve
  // exactly true to authorize that one write. `options.requireApproval` can only
  // widen the requirement (POLICY.needsApproval): live always requires approval,
  // and true adds it in demo. If approval is required but no handler is supplied,
  // or the handler resolves false, the step and all later steps send nothing
  // (fail closed). When approval is required the step must declare `op` and
  // `bytes`; the grant is bound to those, so a write whose operation or payload
  // does not match the approved step is blocked at the writer boundary. After
  // awaiting the handler the session token and mode are re-validated before the
  // step runs.
  async function runPlan(steps, onStep, options) {
    options = options || {};
    const token = options.token !== undefined ? options.token : guard.snapshot();
    // The option may only widen the requirement, never switch it off: a live
    // session always requires approval, and options.requireApproval === true
    // adds the requirement in any mode.
    const requireApproval = POLICY.needsApproval(sessionMode(), options.requireApproval);
    const approve = typeof options.approve === 'function' ? options.approve : null;
    const approvalTimeoutMs = options.approvalTimeoutMs !== undefined
      ? Number(options.approvalTimeoutMs)
      : 120000;
    // The plan owner carries the approval contract: `requireApproval` declares
    // whether this plan's writes need per-write approval, and `approvedWrite` is
    // the one-shot grant consumed by the writer boundary. A grant is issued for
    // exactly one step, so a step that performs two writes blocks the second.
    const owner = { requireApproval: requireApproval, approvedWrite: false };
    if (!guard.tryAcquire(owner)) throw new Error('Another write plan is still running. Please wait for it to finish.');
    const results = [];
    const blockStep = (i, extra) => {
      const blocked = Object.assign({ applied: false, blocked: true, acked: false, statusName: 'blocked', label: steps[i].label }, extra);
      results.push(blocked);
      onStep && onStep({ index: i, phase: 'done', step: steps[i], result: blocked });
      return blocked;
    };
    try {
      for (let i = 0; i < steps.length; i++) {
        // Authorization and session identity are re-checked before every
        // mutation: a plan created before a switch/opt-out must not retain
        // authority, even if the new session is authorized.
        const mode = sessionMode();
        const stale = !guard.isCurrent(token);
        if (stale || !guard.canWrite(mode)) {
          const reason = stale
            ? 'The session or authorization changed after this plan was created. The plan was not executed.'
            : POLICY.authorizationReason(mode);
          blockStep(i, stale ? { sessionChanged: true, error: reason } : { error: reason });
          break;
        }
        // Per-write approval gate. Experimental opt-in is not approval.
        if (requireApproval) {
          if (!approve) {
            blockStep(i, { error: 'This write requires explicit per-write approval, but no approval handler is available.' });
            break;
          }
          let granted = false;
          try {
            granted = await requireDecision(
              approve({ index: i, total: steps.length, step: steps[i] }),
              approvalTimeoutMs
            );
          } catch (_) { granted = false; }
          // Re-validate the session after awaiting the handler: a session
          // change means blocked with zero mutation frames.
          if (!guard.isCurrent(token) || sessionMode() !== mode || !guard.canWrite(sessionMode())) {
            blockStep(i, { sessionChanged: true, error: 'The session changed while awaiting approval. Nothing was sent.' });
            break;
          }
          if (!granted) {
            blockStep(i, { declined: true, error: 'Approval was declined. Nothing was sent.' });
            break;
          }
        }
        // Bind the one-shot writer-boundary grant to exactly the step being
        // approved: the operation id, the target register (component/name/address)
        // and the payload hex the step declares it will write. A step that does
        // not declare both `op` and `bytes` cannot be approved safely, so it
        // fails closed with nothing sent. The registry-bound generic writer uses
        // the component/name/address fields to re-check its target at the
        // boundary; fixed-operation steps are checked against `POLICY.OP`.
        const grant = (steps[i].op && steps[i].bytes) ? {
          op: steps[i].op, component: steps[i].component, name: steps[i].name,
          address: steps[i].address, bytes: steps[i].bytes,
          // The typed register name itself, not a boolean: the writer boundary
          // compares it with the target register.
          typedName: typeof steps[i].typedName === 'string' ? steps[i].typedName : '',
        } : null;
        if (requireApproval && !grant) {
          blockStep(i, { error: 'This step does not declare the operation and payload it writes, so it cannot be approved safely. Nothing was sent.' });
          break;
        }
        owner.approvedWrite = grant || false;
        onStep && onStep({ index: i, phase: 'start', step: steps[i] });
        let r;
        try { r = await steps[i].run(owner); } catch (err) { r = { applied: false, error: err.message, label: steps[i].label, blocked: err.code === 'WRITE_BLOCKED', acked: false }; }
        results.push(r);
        onStep && onStep({ index: i, phase: 'done', step: steps[i], result: r });
        if (!r.applied) break;
      }
    } finally {
      guard.release(owner);
    }
    return results;
  }

  // ------------------------------------------------------------ connect
  async function connect() {
    if (!navigator.usb) throw new Error('This browser does not support WebUSB. Please use Chrome or Edge on desktop.');
    let device;
    try {
      device = await window.Bes3WebUsb.requestDevice();
    } catch (err) {
      if (!transport && !state.live) {
        state.mode = Object.keys(state.values).length ? 'file' : 'idle';
        emit('change');
      }
      throw err;
    }
    // Never replace a live transport without closing it. Disconnect only after
    // the device picker succeeds so cancelling the picker leaves an active
    // session untouched.
    if (state.live || transport) await disconnect();
    guard.reset();
    clearRemoteProbe();
    state.mode = 'connecting';
    emit('change');
    // Assign only after open() succeeds: a failed open must not leave a
    // half-open transport installed.
    const nextTransport = new window.Bes3WebUsb.Bes3WebUsbTransport(device);
    try {
      await nextTransport.open();
    } catch (err) {
      try { if (nextTransport.close) await nextTransport.close(); } catch (_) { /* ignore */ }
      state.mode = Object.keys(state.values).length ? 'file' : 'idle';
      emit('change');
      throw err;
    }
    transport = nextTransport;
    state.deviceName = device.productName || 'Bosch eBike';
    state.live = true;
    state.demo = false;
    state.simulatedExport = false;
    state.connectionLost = false;
    state.connectionLostReason = null;
    consecutiveFailures = 0;
    archiveSessionLog();
    state.log = [];
    state.log.push(versionLogEntry());
    dlog('workshop', `connected ${state.deviceName}`);
    connectedDevice = device;
    navigator.usb.addEventListener('disconnect', onUsbDisconnect);
    startKeepalive();
    await drain(150);
    await readAll();
  }

  // Only the connected device may end the session: unplugging an unrelated USB
  // device must not drop a healthy bike session.
  function onUsbDisconnect(event) {
    if (connectedDevice && event && event.device && event.device !== connectedDevice) return;
    handleTransportLoss('USB connection was disconnected');
  }
  function removeUsbDisconnectListener() {
    try { if (typeof navigator !== 'undefined' && navigator.usb && navigator.usb.removeEventListener) navigator.usb.removeEventListener('disconnect', onUsbDisconnect); } catch (_) { /* ignore */ }
    connectedDevice = null;
  }

  async function disconnect() {
    stopKeepalive();
    removeUsbDisconnectListener();
    guard.reset();
    clearRemoteProbe();
    try { if (transport && transport.close) await transport.close(); } catch (_) { /* ignore */ }
    transport = null;
    state.live = false;
    state.demo = false;
    state.simulatedExport = false;
    state.connectionLost = false;
    state.connectionLostReason = null;
    state.mode = Object.keys(state.values).length ? 'file' : 'idle';
    emit('change');
  }

  function archiveSessionLog() {
    if (!Array.isArray(state.log) || !state.log.length) return;
    const meaningful = state.log.filter((e) => e && !e.info);
    const unverified = meaningful.filter((e) => e.interrupted && e.transmitted);
    if (unverified.length) {
      state.lastUnverifiedWrite = { ...unverified[unverified.length - 1] };
    }
    if (meaningful.length) {
      state.logHistory.unshift({
        endedAt: new Date(),
        entries: state.log.map((e) => ({ ...e })),
      });
      if (state.logHistory.length > 10) state.logHistory.length = 10;
    }
  }

  async function closeReadout() {
    await disconnect();
    readRunId++;
    state.values = {};
    state.components = {};
    state.assistModes = [];
    state.issues = null;
    state.issuesScanned = false;
    state.issuesTruncated = false;
    state.deviceName = null;
    state.readAt = null;
    state.simulatedExport = false;
    state.remoteProbe = [];
    state.remoteProbeAt = null;
    archiveSessionLog();
    state.log = [];
    state.mode = 'idle';
    emit('change');
  }

  async function startDemo() {
    await disconnect();
    guard.reset();
    transport = window.Bes3WorkshopDemo.createFakeTransport();
    state.live = true;
    state.demo = true;
    state.simulatedExport = false;
    state.connectionLost = false;
    state.connectionLostReason = null;
    consecutiveFailures = 0;
    state.deviceName = 'Demo eBike (simulated)';
    archiveSessionLog();
    state.log = [];
    state.log.push(versionLogEntry());
    await readAll();
  }

  // Import validation. A readout file is untrusted input: every value is
  // rebuilt from scratch, so nothing from the file can reach the DOM or the
  // renderer unchecked. The limits keep a hostile file small and finite.
  const IMPORT_LIMITS = { values: 5000, issues: 500, modes: 50, array: 100, objectKeys: 50, string: 2048, hex: 2048, depth: 3 };
  const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
  function sanitizeText(v, max) {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }
  // An imported timestamp must be a real date before it replaces the current
  // readout: an Invalid Date makes a later export throw in toISOString().
  function importDate(value) {
    if (value === undefined || value === null || value === '') return new Date();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('The readout file has an invalid "generatedAt" date.');
    return date;
  }
  // Strict space-separated byte hex, as written by toHex(). Returns null for
  // malformed input so callers can fail closed instead of producing NaN bytes.
  function parseHexBytes(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text === '') return [];
    if (!/^[0-9a-fA-F]{2}(?:\s+[0-9a-fA-F]{2})*$/.test(text)) return null;
    return text.split(/\s+/).map((part) => parseInt(part, 16));
  }
  function sanitizeValue(v, depth) {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? v : null;
    if (t === 'boolean') return v;
    if (t === 'string') return v.slice(0, IMPORT_LIMITS.string);
    if (t !== 'object' || depth <= 0) return null;
    if (Array.isArray(v)) {
      const out = [];
      for (const item of v.slice(0, IMPORT_LIMITS.array)) out.push(sanitizeValue(item, depth - 1));
      return out;
    }
    const out = {};
    let n = 0;
    for (const key of Object.keys(v)) {
      if (n++ >= IMPORT_LIMITS.objectKeys) break;
      if (typeof key !== 'string' || key.length > 64) continue;
      if (UNSAFE_KEYS.indexOf(key) !== -1) continue;
      out[key] = sanitizeValue(v[key], depth - 1);
    }
    return out;
  }
  function sanitizeValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error('The readout file has no valid "values" object.');
    }
    const keys = Object.keys(values);
    if (keys.length > IMPORT_LIMITS.values) throw new Error('The readout file has too many registers.');
    const out = {};
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 200) continue;
      if (UNSAFE_KEYS.indexOf(key) !== -1) continue;
      const v = values[key];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const status = typeof v.status === 'string' ? v.status.slice(0, 32) : 'ok';
      const extra = {};
      if (typeof v.generic === 'string') extra.generic = sanitizeText(v.generic, 32);
      if (Number.isFinite(v.rawCount)) extra.rawCount = v.rawCount;
      out[key] = {
        status: status,
        display: sanitizeText(v.display, IMPORT_LIMITS.string),
        value: sanitizeValue(v.value, IMPORT_LIMITS.depth),
        hex: sanitizeText(v.hex, IMPORT_LIMITS.hex),
        ...extra,
      };
    }
    return out;
  }
  function sanitizeIssues(issues) {
    if (issues === null || issues === undefined) return null;
    if (!Array.isArray(issues)) throw new Error('The readout file has an invalid "issues" list.');
    const out = [];
    for (const i of issues.slice(0, IMPORT_LIMITS.issues)) {
      if (!i || typeof i !== 'object') continue;
      out.push({
        component: sanitizeText(i.component, 64),
        issueId: Number.isFinite(i.issueId) ? i.issueId : null,
        timestamp: Number.isFinite(i.timestamp) ? i.timestamp : null,
        activationCount: Number.isFinite(i.activationCount) ? i.activationCount : null,
      });
    }
    return out;
  }
  function sanitizeModes(modes) {
    if (modes === null || modes === undefined) return [];
    if (!Array.isArray(modes)) throw new Error('The readout file has an invalid "assistModes" list.');
    const out = [];
    for (const m of modes.slice(0, IMPORT_LIMITS.modes)) {
      if (!m || typeof m !== 'object') continue;
      const color = typeof m.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(m.color) ? m.color : null;
      out.push({
        configId: sanitizeText(m.configId, 32),
        name: sanitizeText(m.name, 64),
        color: color,
        active: m.active === true,
        distance: Number.isFinite(m.distance) ? m.distance : null,
        energy: Number.isFinite(m.energy) ? m.energy : null,
        udam: m.udam && typeof m.udam === 'object' ? sanitizeValue(m.udam, 1) : null,
      });
    }
    return out;
  }

  // Import a JSON report exported by the classic reader (offline viewing).
  function importReaderReport(json) {
    if (!json || !Array.isArray(json.results)) throw new Error('Unrecognized file format – expected a BES3 Reader JSON export (.json).');
    if (json.results.length > IMPORT_LIMITS.values) throw new Error('The readout file has too many entries.');
    const readAt = importDate(json.generatedAt);
    const modes = sanitizeModes(json.assistModes);
    const issues = sanitizeIssues(json.issues);
    guard.reset();
    clearRemoteProbe();
    state.values = {};
    state.components = {};
    for (const r of json.results) {
      if (!r || !r.component || !r.name) continue;
      const key = `${sanitizeText(r.component, 64)}.${sanitizeText(r.name, 64)}`;
      if (r.status !== 'ok') { state.values[key] = { status: sanitizeText(r.status, 32), display: '–', value: null, hex: '' }; continue; }
      const addr = addrOf(r.component, r.name);
      // Rebuild a payload when the export only has a display string.
      let payload = null;
      const m = typeof r.value === 'string' && r.value.match(/hex: ((?:[0-9a-f]{2} ?)+)/i);
      if (m) payload = m[1].trim().split(/\s+/).map((h) => parseInt(h, 16));
      else if (typeof r.value === 'string' && /\(hex: ((?:[0-9a-f]{2} ?)+)\)/i.test(r.value)) {
        payload = r.value.match(/\(hex: ((?:[0-9a-f]{2} ?)+)\)/i)[1].trim().split(/\s+/).map((h) => parseInt(h, 16));
      }
      if (payload) { state.values[key] = { status: 'ok', ...interpret(r.component, r.name, addr, payload) }; continue; }
      let value = r.rawValue !== undefined ? r.rawValue : r.value;
      let display = r.value;
      if (BOOL_KEYS.has(key)) { value = r.value === 'true' || r.rawValue === true; display = value ? 'true' : 'false'; }
      if (key === 'RemoteControl.SERVICE_DUE') {
        value = r.rawValue && typeof r.rawValue === 'object' ? r.rawValue : { timestamp: 0, odometer: 0 };
        display = value.timestamp || value.odometer ? 'set' : 'not set';
      }
      if (key === 'DriveUnit.BIKE_LIGHT_CONFIGURATION' && typeof r.value === 'string') {
        const n = parseInt(r.value, 10); value = Number.isNaN(n) ? null : n;
      }
      if (typeof display === 'string') display = display.replace(/\s*\[[A-Z0-9_]+=\d+\]$/, '');
      state.values[key] = { status: 'ok', display: sanitizeText(display === undefined || display === null ? '' : String(display), IMPORT_LIMITS.string), value: sanitizeValue(value, IMPORT_LIMITS.depth), hex: '' };
    }
    for (const c of Object.keys(READ_PLAN)) {
      const v = state.values[`${c}.PRODUCT_NAME`];
      state.components[c] = !!v && v.status === 'ok';
    }
    state.assistModes = modes;
    state.issues = issues;
    state.issuesScanned = Array.isArray(json.issues);
    state.issuesTruncated = Boolean(json.issuesTruncated);
    state.readAt = readAt;
    state.mode = 'file';
    state.live = false;
    state.demo = false;
    state.simulatedExport = false;
    state.deviceName = 'Saved Readout';
    emit('change');
  }

  // Anonymised exports: the personal identifiers (serial numbers, System ID,
  // key-lock number) are masked and the raw payload bytes are dropped. BLE peer
  // registers are treated as identifiers too: their address-like bytes, the
  // decoded hex text and the probe rows must not survive the anonymisation. The
  // shape of the file stays the same, so an anonymised export can still be
  // opened again.
  const BLE_PEER_REGISTERS = ['BLE_CENTRAL_DATABASE', 'DEVICE_DATABASE'];
  // Certificates carry a holder reference, serial and public key. They are
  // identifiers even though the display is not a single serial string.
  const ANONYMIZED_OBJECT_REGISTERS = ['DEVICE_CERTIFICATE'];
  function anonymizeBleRegister(v) {
    const count = v.value && typeof v.value === 'object' && Number.isFinite(v.value.count) ? v.value.count : 0;
    const text = `${count} BLE peer record${count === 1 ? '' : 's'} (payload removed)`;
    const value = v.value && typeof v.value === 'object'
      ? Object.assign({}, v.value, { text, hex: '' })
      : v.value;
    return Object.assign({}, v, { display: text, value, hex: '' });
  }
  function anonymizeValues(values) {
    const out = {};
    for (const key of Object.keys(values || {})) {
      const name = key.indexOf('.') !== -1 ? key.split('.').pop() : key;
      const v = values[key];
      if (BLE_PEER_REGISTERS.indexOf(name) !== -1 && v && typeof v === 'object') {
        out[key] = anonymizeBleRegister(v);
      } else if (ANONYMIZED_OBJECT_REGISTERS.indexOf(name) !== -1 && v && typeof v === 'object') {
        out[key] = Object.assign({}, v, {
          display: '[certificate redacted]',
          value: null,
          hex: '',
        });
      } else if (POLICY.ANONYMIZED_REGISTERS.indexOf(name) !== -1 && v && typeof v === 'object') {
        out[key] = Object.assign({}, v, {
          display: POLICY.maskIdentifier(v.display),
          value: typeof v.value === 'string' ? POLICY.maskIdentifier(v.value) : v.value,
          hex: '',
        });
      } else {
        out[key] = v;
      }
    }
    return out;
  }
  function anonymizeProbe(rows) {
    return (rows || []).map((r) => ({
      component: String(r.component == null ? '' : r.component),
      name: String(r.name == null ? '' : r.name),
      status: String(r.status == null ? '' : r.status),
      redacted: true,
    }));
  }
  function sanitizeProbe(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows.slice(0, IMPORT_LIMITS.values)) {
      if (!r || typeof r !== 'object') continue;
      const address = Number.isFinite(r.address) ? r.address : null;
      const display = sanitizeText(r.display, IMPORT_LIMITS.string);
      const hex = sanitizeText(r.hex, IMPORT_LIMITS.hex);
      out.push({
        component: sanitizeText(r.component, 64),
        name: sanitizeText(r.name, 64),
        status: sanitizeText(r.status, 32),
        address,
        display,
        hex,
        redacted: r.redacted === true || (address === null && display === '' && hex === ''),
      });
    }
    return out;
  }
  function anonymizeLog(log) {
    return (log || []).map((e) => ({
      at: e.at, label: e.label, mode: e.mode, applied: e.applied, acked: e.acked,
      blocked: e.blocked, interrupted: e.interrupted, statusName: e.statusName,
    }));
  }

  function exportState(options) {
    const anonymize = !!(options && options.anonymize === true);
    const source = exportSource();
    return {
      tool: 'BES3 Workshop',
      workshopVersion: appVersion(),
      generatedAt: (state.readAt || new Date()).toISOString(),
      source: source,
      // A demo export keeps its provenance when reopened: the session is
      // `file` then, but the data still came from the simulated bike.
      simulated: source === 'demo' || state.simulatedExport === true,
      anonymized: anonymize,
      values: anonymize ? anonymizeValues(state.values) : state.values,
      components: state.components,
      assistModes: state.assistModes,
      issues: state.issues,
      issuesTruncated: state.issuesTruncated,
      // The results of the read-only Mini Remote probe. An anonymised export
      // keeps only the register identity and status, not the bytes.
      remoteProbe: anonymize ? anonymizeProbe(state.remoteProbe) : (state.remoteProbe || []),
      remoteProbeAt: state.remoteProbeAt ? state.remoteProbeAt.toISOString() : null,
      // Optional read-only test-plan results are no longer part of this build.
      // Every exported log entry carries the mode it was produced in, so a
      // simulated run can never be mistaken for a real readout.
      log: anonymize ? anonymizeLog(state.log) : (state.log || []).map((e) => ({ ...e, mode: e.mode || source })),
    };
  }
  function importWorkshop(json) {
    if (!json || (json.tool !== 'BES3 Workshop')) return false;
    // Validate everything that can throw before replacing the current readout.
    const readAt = importDate(json.generatedAt);
    const values = sanitizeValues(json.values);
    const components = (json.components && typeof json.components === 'object' && !Array.isArray(json.components)) ? sanitizeValue(json.components, 2) : {};
    const modes = sanitizeModes(json.assistModes);
    const issues = sanitizeIssues(json.issues);
    const remoteProbe = sanitizeProbe(json.remoteProbe);
    let remoteProbeAt = null;
    if (json.remoteProbeAt) {
      const d = new Date(json.remoteProbeAt);
      if (!Number.isNaN(d.getTime())) remoteProbeAt = d;
    }
    guard.reset();
    clearRemoteProbe();
    // Every value is rebuilt from the file: nothing from an imported readout
    // reaches the renderer unchecked.
    state.values = values;
    for (const k of ['RemoteControl.BLE_CENTRAL_DATABASE', 'RemoteControl.DEVICE_DATABASE']) {
      const e = state.values[k];
      if (!e || e.status !== 'ok' || typeof e.hex !== 'string') continue;
      // An anonymised export intentionally has an empty hex and a "payload
      // removed" display. Re-decoding the empty string would overwrite that
      // truthful text with "no entries".
      if (e.hex.trim() === '') continue;
      const bytes = parseHexBytes(e.hex);
      if (!bytes) {
        e.status = 'invalid';
        e.display = 'invalid BLE payload (not hexadecimal)';
        e.value = null;
        e.hex = '';
        continue;
      }
      const info = decodeBlePeers(bytes);
      e.display = info.text;
      e.value = info;
    }
    state.components = components;
    state.assistModes = modes;
    state.issues = issues;
    state.issuesScanned = Array.isArray(json.issues);
    state.issuesTruncated = Boolean(json.issuesTruncated);
    archiveSessionLog();
    state.log = [];
    state.remoteProbe = remoteProbe;
    state.remoteProbeAt = remoteProbeAt;
    state.readAt = readAt;
    state.mode = 'file'; state.live = false; state.demo = false;
    // Old exports have no provenance fields; only an explicit simulated:true
    // flags the readout as demo data. Imports stay read-only either way.
    state.simulatedExport = json.simulated === true;
    state.deviceName = 'Saved Readout';
    emit('change');
    return true;
  }

  window.Bes3Workshop = {
    state, on, off, connect, disconnect, closeReadout, startDemo, readAll, readKey, Writers, runPlan, clearFaultMemory,
    probeRemoteRegisters, remoteProbeCandidates,
    importReaderReport, importWorkshop, exportState, setExperimental,
    util: { varint, encodeServiceDue, decodeServiceDue, encodeField1Varint, decodeField1Varint, encodeEnumArg, encodeStringArg, encodeUuidPayload, decodeUuidBytes, addrOf, entryOf, registryWritable, toHex, interpret },
    simulateConnectionLoss: () => handleTransportLoss('Simulated connection drop'),
    simulateSetExperimental: (on) => {
      if (!state.demo) throw new Error('simulateSetExperimental is only available in demo mode');
      guard.setExperimental(on);
    },
    get isLive() { return !!transport && state.live; },
    get sessionMode() { return sessionMode(); },
    get experimentalEnabled() { return guard.isExperimental(); },
    get canMutate() { return guard.canWrite(sessionMode()); },
    get authorizationToken() { return guard.snapshot(); },
    get busy() { return guard.isBusy(); },
  };
})();
