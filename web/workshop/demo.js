// BES3 Workshop – simulated bike for the demo mode.
// Speaks the same MCSP frame format as the real drive unit, so the demo runs
// through exactly the same engine code (reads, writes, re-reads, RPCs).
// Nothing here ever touches USB.
(function () {
  'use strict';
  const DATA = window.Bes3WorkshopDemoData;
  const hexToBytes = (h) => (h ? h.trim().split(/\s+/).filter(Boolean).map((x) => parseInt(x, 16)) : []);
  const A = (c, n) => window.Bes3Workshop.util.addrOf(c, n);

  // The demo can simulate the failure modes of a real bike so that every
  // result state can be seen without a device:
  //   ok         — the write is stored and acknowledged (the default)
  //   decline    — the bike declines the write
  //   unchanged  — the bike acknowledges the write but does not change the value
  //   noresponse — the bike never answers the write
  let demoMode = 'ok';
  const DEMO_MODES = ['ok', 'decline', 'unchanged', 'noresponse'];
  // How many mutating delete commands the simulated bike received. It proves
  // that a failing mutation is sent once and never retried.
  let deleteCalls = 0;

  // The response latency of the simulated bike. The harness sets it to 0 so the
  // regression suite runs fast; a test can set it to a delay to exercise the
  // slow path.
  let latencyMs = null;
  function responseLatency() {
    return latencyMs === null ? 8 + Math.random() * 20 : latencyMs;
  }

  function createFakeTransport() {
    const store = new Map(Object.entries(DATA.payloads).map(([k, v]) => [Number(k), hexToBytes(v)]));
    // The demo accepts writes to the registers the address registry marks
    // writable, plus the two System ID registers the dedicated writer uses.
    const registry = (window.Bes3AddressRegistry && window.Bes3AddressRegistry.ADDRESS_REGISTRY)
      ? window.Bes3AddressRegistry.ADDRESS_REGISTRY.addresses : [];
    const writable = new Set(registry.filter((e) => e.writable === true).map((e) => e.address));
    for (const [c, n] of [['RemoteControl', 'BIKE_ID'], ['DriveUnit', 'BIKE_ID']]) {
      const a = A(c, n);
      if (a != null) writable.add(a);
    }
    const queue = [];
    let closed = false;
    const timers = new Set();
    const STATS = A('DriveUnit', 'GET_ASSIST_MODE_STATISTICS');
    // Demo fault memory: 1 entry 0x112000 on RemoteControl.
    const DIAG_RC = A('RemoteControl', 'EXECUTE_INFORMATION_MANAGER_COMMAND_BOSCH');
    const vint = (v) => { const o = []; while (v > 127) { o.push((v % 128) | 128); v = Math.floor(v / 128); } o.push(v); return o; };
    const ld = (tag, b) => [tag, ...vint(b.length), ...b];
    let demoIssuesCleared = false;
    function demoIssue(arg) {
      const cmd = arg[1]; let n = 0;
      if (arg[2] === 0x18) n = arg[3];
      if (cmd === 1 || cmd === 2) { demoIssuesCleared = true; return []; } // DELETE_ISSUE / DELETE_ALL_ISSUES -> SUCCESS
      if (cmd === 4) return demoIssuesCleared ? [] : [0x20, 1]; // GET_ISSUE_COUNT
      if (cmd === 5 && n === 0 && !demoIssuesCleared) {
        const ts = Math.floor(Date.now() / 1000) - 6 * 3600;
        const frame = [...ld(0x12, [0x08, ...vint(ts * 2)]), 0x18, 4];
        const params = [0x08, 5, ...ld(0x12, [0x08, ...vint(0x112000)])];
        return [...ld(0x0a, frame), ...ld(0x12, params)];
      }
      return [0x18, 1]; // DOES_NOT_EXIST
    }
    const UDAM = A('DriveUnit', 'READ_UDAM_VALUES');
    const LIGHT = A('DriveUnit', 'BIKE_LIGHT');
    const LIGHT_AVAIL = A('DriveUnit', 'BIKE_LIGHT_AVAILABLE');
    const LIGHT_CFG = A('DriveUnit', 'BIKE_LIGHT_CONFIGURATION');

    function respond(addr, type, seq, payload, status) {
      const body = [(addr >> 8) & 0x7f, addr & 0xff, status ? 0x0e : 0x8e, 0x10, ((type & 0xf) << 4) | (seq & 0xf)];
      if (status) body.push(status);
      body.push(...payload);
      const frame = Uint8Array.from([0x30, body.length, ...body]);
      if (closed) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!closed) queue.push(frame);
      }, responseLatency());
      timers.add(timer);
    }
    function configIdFromArg(arg) {
      if (arg[0] !== 0x0a) return null;
      return String.fromCharCode(...arg.slice(2, 2 + arg[1]));
    }

    return {
      async open() { closed = false; },
      async init() { closed = false; },
      async close() {
        closed = true;
        queue.length = 0;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      },
      async doMcspWrite(frame) {
        const b = Array.from(frame).slice(2);
        const addr = ((b[2] & 0x7f) << 8) | b[3];
        const type = b[4] >> 4; const seq = b[4] & 0xf;
        const p = b.slice(5);
        if (type === 0) {
          if (store.has(addr)) respond(addr, 1, seq, store.get(addr));
          else respond(addr, 1, seq, [], 0x05);
        } else if (type === 2) {
          if (!writable.has(addr)) { respond(addr, 3, seq, [], 0x06); return; }
          if (demoMode === 'noresponse') return; // the bike never answers
          if (demoMode === 'decline') { respond(addr, 3, seq, [], 0x06); return; }
          // Like the real drive unit: switching the light on only sticks once the
          // light output is marked as installed AND a light setting is chosen.
          if (addr === LIGHT && p.length) {
            const avail = (store.get(LIGHT_AVAIL) || []).length > 0;
            const cfg = (store.get(LIGHT_CFG) || []).length > 0;
            if (!avail || !cfg) { respond(addr, 3, seq, []); return; }
          }
          // "unchanged": the bike acknowledges the write but keeps the old value.
          if (demoMode !== 'unchanged') store.set(addr, p);
          if (addr === LIGHT_AVAIL && !p.length) store.set(LIGHT, []);
          respond(addr, 3, seq, []); // real bike: SUCCESS with empty payload
        } else if (type === 4) {
          const id = configIdFromArg(p);
          // A declined delete command: the bike refuses the mutation.
          if (demoMode === 'decline' && (p[1] === 1 || p[1] === 2)) { deleteCalls++; respond(addr, 5, seq, [], 0x06); return; }
          if (addr === STATS && id !== null) respond(addr, 5, seq, hexToBytes(DATA.rpc.stats[id] || ''));
          else if (addr === UDAM && id !== null) respond(addr, 5, seq, hexToBytes(DATA.rpc.udam[id] || ''));
          else if (addr === DIAG_RC) respond(addr, 5, seq, demoIssue(p));
          else respond(addr, 5, seq, []); // keepalive / diagnostics: success, 0 issues
        }
      },
      async readNextFrame(maxPolls = 4, pollDelayMs = 4) {
        for (let i = 0; i < maxPolls; i++) {
          if (queue.length) return queue.shift();
          await new Promise((r) => setTimeout(r, pollDelayMs));
        }
        return null;
      },
    };
  }

  window.Bes3WorkshopDemo = {
    createFakeTransport,
    // The demo-only failure simulation: 'ok', 'decline', 'unchanged' or
    // 'noresponse'.
    modes: DEMO_MODES,
    mode: () => demoMode,
    setMode: (m) => { demoMode = DEMO_MODES.indexOf(m) === -1 ? 'ok' : m; return demoMode; },
    deleteCalls: () => deleteCalls,
    resetCounters: () => { deleteCalls = 0; },
    // The response latency of the simulated bike (null = the random default).
    setLatency: (ms) => { latencyMs = (ms === null || ms === undefined) ? null : Math.max(0, Number(ms) || 0); return latencyMs; },
    latency: () => latencyMs,
  };
})();
