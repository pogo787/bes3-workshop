// BES3 Workshop – UI
(function () {
  'use strict';
  const W = window.Bes3Workshop;
  const S = W.state;
  const POLICY = window.Bes3WritePolicy;
  // Presentation helpers shared with the PDF report (report-pdf.js loads first).
  const View = window.Bes3WorkshopPresentation;
  const OTHER_NOTE = View.OTHER_NOTE;
  const $ = (id) => document.getElementById(id);
  const NF1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const NF2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The local calendar date, not the UTC date: a date input in a negative
  // UTC-offset zone must not reject today after 19:00 local time.
  const localISODate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // A colour that comes from the bike (the assist-mode colours) is only allowed
  // into a style attribute when it is a plain hex colour; anything else falls
  // back to a neutral colour.
  const escColor = (v) => { const s = String(v == null ? '' : v).trim(); return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : 'var(--ink-3)'; };
  // A number for text output: no markup can survive it.
  const escNum = (v, fallback = '–') => { const n = Number(v); return Number.isFinite(n) ? String(n) : fallback; };

  // The application version, declared on the write policy (POLICY.VERSION), the
  // single source of truth, mirrored by docs/CHANGELOG.md.
  const versionInfo = () => POLICY.VERSION || { version: '0.0.0', date: '' };
  const versionLabel = () => 'Workshop v' + versionInfo().version;
  // Show the version in the static header and footer chrome, built here so no
  // markup or CSS needs to change.
  function injectVersionLabels() {
    const txt = versionLabel();
    const actions = document.querySelector('.topbar__actions');
    if (actions && !document.getElementById('verTop')) {
      const s = document.createElement('span');
      s.id = 'verTop'; s.className = 'muted'; s.style.fontSize = 'var(--text-xs)';
      s.textContent = txt;
      actions.insertBefore(s, actions.firstChild);
    }
    const legal = document.querySelector('.foot__legal');
    if (legal && !document.getElementById('verFoot')) {
      const s = document.createElement('span');
      s.id = 'verFoot'; s.textContent = ' · ' + txt;
      legal.appendChild(s);
    }
  }

  // ------------------------------------------------------------ data access
  const V = (k) => S.values[k] || null;
  const ok = (k) => !!(V(k) && V(k).status === 'ok');
  const val = (k) => {
    // Values come from the bike or from an imported file: they are coerced to a
    // primitive before they are used, so a malformed value can never break the
    // renderer.
    if (!ok(k)) return null;
    const v = V(k).value;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return v.length > 4096 ? v.slice(0, 4096) : v;
    if (typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.slice(0, 100);
    return null;
  };
  const disp = (k, fb = '–') => {
    if (!ok(k)) return fb;
    const d = V(k).display;
    if (d === '' || d === null || d === undefined) return fb;
    const s = typeof d === 'string' ? d : String(d);
    return s.length > 4096 ? s.slice(0, 4096) : s;
  };

  // Locale codes reported by the control unit -> readable language names (all other values are already English).
  const TR = {
    'en-GB': 'English (UK)', 'en-US': 'English (US)', 'de-DE': 'German', 'fr-FR': 'French', 'it-IT': 'Italian',
    'nl-NL': 'Dutch', 'es-ES': 'Spanish', 'pt-PT': 'Portuguese', 'da-DK': 'Danish', 'sv-SE': 'Swedish', 'nb-NO': 'Norwegian',
    'fi-FI': 'Finnish', 'pl-PL': 'Polish', 'cs-CZ': 'Czech', 'sk-SK': 'Slovak', 'sl-SI': 'Slovenian', 'hu-HU': 'Hungarian',
    'ja-JP': 'Japanese', 'zh-CN': 'Chinese', 'ko-KR': 'Korean',
  };
  const tr = (s) => (s == null ? s : TR[s] || s);

  function lightConfigLabel(v) {
    if (v === null || v === undefined) return '–';
    if (v === 0) return 'not set (0)';
    if (v === 2) return 'Remember last light state on power-up (2)';
    return `Setting ${v}`;
  }

  function summary() {
    const odo = val('DriveUnit.ODOMETER');
    const odoM = val('DriveUnit.ODOMETER_MOTOR');
    const sdEntry = V('RemoteControl.SERVICE_DUE');
    const sdValue = ok('RemoteControl.SERVICE_DUE') && sdEntry.value && typeof sdEntry.value === 'object' ? sdEntry.value : null;
    const sdTimestamp = sdValue && Number.isFinite(Number(sdValue.timestamp)) ? Number(sdValue.timestamp) : 0;
    const sdOdometer = sdValue && Number.isFinite(Number(sdValue.odometer)) ? Number(sdValue.odometer) : 0;
    const walkHex = ok('DriveUnit.WALK_ASSIST_CONFIGURATION') ? V('DriveUnit.WALK_ASSIST_CONFIGURATION').hex : '';
    let walk = null;
    if (walkHex) {
      const b = walkHex.split(' ').map((h) => parseInt(h, 16));
      let enabled = false; let speed = null; let i = 0;
      while (i < b.length) {
        const tag = b[i++]; const f = tag >> 3;
        let v = 0; let mul = 1; let x;
        do { x = b[i++]; v += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80 && i < b.length);
        if (f === 1) enabled = !!v; if (f === 2) speed = v / 100;
      }
      walk = { enabled, speed };
    }
    const comps = [
      { key: 'RemoteControl', type: 'Control Unit', hint: 'System Controller, LED Remote, Purion 200 or Kiox 400C', core: true },
      { key: 'MiniRemote', type: 'Remote', hint: 'Mini Remote (BRC3300) · optional, paired in addition to the control unit', core: true },
      { key: 'DriveUnit', type: 'Drive Unit', core: true },
      { key: 'Battery', type: 'Battery', core: true },
      { key: 'HeadUnit', type: 'Display', hint: 'e.g. Kiox 300, Kiox 500, Purion 400, Intuvia 100', core: true },
      { key: 'Battery2', type: 'Second Battery', hint: 'DualBattery / PowerMore range extender' },
      { key: 'ConnectModule', type: 'ConnectModule', hint: 'GPS tracking, eBike Alarm' },
      { key: 'AntiLockBrakeSystem', type: 'ABS', hint: 'Bosch eBike ABS' },
    ].map((c) => {
      if (c.key === 'MiniRemote') {
        // The upstream reader has no Mini Remote detection. Only the explicit
        // BRC3300 / Mini Remote marker may turn a BLE record into that claim;
        // any other peer stays a generic record.
        const central = V('RemoteControl.BLE_CENTRAL_DATABASE');
        const device = V('RemoteControl.DEVICE_DATABASE');
        const availability = V('RemoteControl.DEVICE_AVAILABILITY');
        const buttons = V('RemoteControl.AVAILABLE_BUTTONS');
        const ble = ok('RemoteControl.BLE_CENTRAL_DATABASE') ? central : ok('RemoteControl.DEVICE_DATABASE') ? device : null;
        const found = !!(ble && ble.value && ble.value.hasMiniRemote);
        const hasRecord = !!(ble && ble.value && ble.value.hasBleRecord);
        const raw = [
          ['BLE central database (0x2210)', central],
          ['Device database', device],
          ['Device availability', availability],
          ['Available buttons', buttons],
        ].map(([label, e]) => ({
          label,
          display: e ? e.display : 'not read',
          hex: e && typeof e.hex === 'string' && e.hex ? e.hex : '',
        }));
        const hint = found
          ? 'Mini Remote (BRC3300) · paired wireless remote; the BLE database contains the accessory marker'
          : hasRecord
            ? 'Mini Remote (BRC3300) · the BLE database has peer records, but none carries the BRC3300 / Mini Remote marker.'
            : 'Mini Remote (BRC3300) · the bike did not list it over USB. It pairs over Bluetooth and may not appear in the wired registers.';
        const note = found
          ? `${ble.value.count} entr${ble.value.count === 1 ? 'y' : 'ies'} in the BLE device database`
          : hasRecord
            ? `${ble.value.count} BLE peer record${ble.value.count === 1 ? '' : 's'}, no BRC3300 marker`
            : null;
        return { ...c, hint, present: found, name: found ? 'Paired wireless accessory' : 'Not visible over USB',
          code: null, part: null, serial: null, sw: null, hw: null, raw, note };
      }
      return {
      ...c,
      present: !!S.components[c.key],
      name: shortName(c.key, disp(`${c.key}.PRODUCT_NAME`, null)),
      code: val(`${c.key}.PRODUCT_CODE`) || null,
      part: disp(`${c.key}.PART_NUMBER`, null),
      serial: disp(`${c.key}.SERIAL_NUMBER`, null),
      sw: disp(`${c.key}.SOFTWARE_VERSION`, null),
      hw: disp(`${c.key}.HARDWARE_VERSION`, null),
    };
    });
    const duId = val('DriveUnit.BIKE_ID');
    const rcId = val('RemoteControl.BIKE_ID');
    const idConflict = !!(duId && rcId && String(duId).toLowerCase() !== String(rcId).toLowerCase());
    const issues = (S.issues || []).map((i) => (window.Bes3Issues ? window.Bes3Issues.enrich(i) : i));
    const modes = (S.assistModes || []).map((m, i) => ({ ...m, color: m.color || PALETTE[i % PALETTE.length] }));
    return {
      brand: disp('DriveUnit.OEM_BRAND_NAME', null),
      line: disp('DriveUnit.PRODUCT_LINE', null),
      category: tr(disp('DriveUnit.BIKE_CATEGORY', null)),
      odoKm: odo != null ? odo / 1000 : null,
      odoMotorKm: odoM != null ? odoM / 1000 : null,
      soc: val('Battery.STATE_OF_CHARGE'),
      soh: val('Battery.STATE_OF_HEALTH'),
      voltage: val('Battery.PRESENT_CELL_VOLTAGE'),
      cycles: val('Battery.NUMBER_OF_FULL_CHARGE_CYCLES'),
      deliveredWh: val('Battery.DELIVERED_WH_OVER_LIFETIME'),
      totalEnergyWh: val('Battery.TOTAL_ENERGY'),
      remainingWh: val('Battery.REMAINING_ENERGY'),
      tMin: val('Battery.MINIMUM_PACK_TEMPERATURE'),
      tMax: val('Battery.MAXIMUM_PACK_TEMPERATURE'),
      tNow: val('Battery.PRESENT_PACK_TEMPERATURE'),
      service: { set: !!(sdTimestamp || sdOdometer), timestamp: sdTimestamp, odometer: sdOdometer },
      issues, issuesScanned: S.issuesScanned, issuesTruncated: S.issuesTruncated,
      light: {
        available: val('DriveUnit.BIKE_LIGHT_AVAILABLE'),
        on: val('DriveUnit.BIKE_LIGHT'),
        config: val('DriveUnit.BIKE_LIGHT_CONFIGURATION'),
        powerW: val('DriveUnit.BIKE_LIGHT_POWER'),
      },
      speedClass: tr(disp('DriveUnit.REGIO_SPEED_CONFIGURATION', null)),
      maxAssist: val('DriveUnit.MAXIMUM_ASSISTANCE_SPEED'),
      legal: val('DriveUnit.MAXIMUM_LEGAL_BIKE_SPEED'),
      language: tr(disp('RemoteControl.LANGUAGE', null)),
      units: tr(disp('RemoteControl.UNITS', null)),
      time: val('RemoteControl.TIME'),
      tz: disp('RemoteControl.TIME_ZONE', null),
      lockFeature: val('RemoteControl.SYSTEM_LOCK_FEATURE_ENABLED'),
      locked: val('RemoteControl.SYSTEM_LOCKED'),
      keyLock: disp('DriveUnit.BATTERY_KEY_LOCK_NUMBER', null),
      gearing: tr(disp('DriveUnit.GEARING_SYSTEM', null)),
      gearRatio: val('DriveUnit.MAXIMUM_GEAR_RATIO'),
      wheelOem: val('DriveUnit.REAR_WHEEL_CIRCUMFERENCE_OEM'),
      wheelUser: val('DriveUnit.REAR_WHEEL_CIRCUMFERENCE_USER'),
      walk,
      startMode: tr(disp('DriveUnit.START_ASSIST_MODE_CONFIGURATION', null)),
      bikeId: disp('DriveUnit.BIKE_ID', null),
      oemBikeId: disp('DriveUnit.OEM_BIKE_ID', null),
      modelId: disp('DriveUnit.OEM_BIKE_MODEL_ID', null),
      tuning: val('DriveUnit.TUNING_DETECTION'),
      // Units derived by comparison with a Bosch DiagnosticTool report of the same bike:
      // operating times in hours. The cadence register counts half revolutions per
      // minute; the engine already converts the raw count to rpm, so it is used
      // as-is here.
      powerOnH: val('DriveUnit.POWER_ON_TIME'),
      supportH: val('DriveUnit.POWER_ON_TIME_WITH_MOTOR_SUPPORT'),
      cadence: val('DriveUnit.AVERAGE_RIDER_CADENCE'),
      comps, modes, duId, rcId, idConflict,
      eShift: val('RemoteControl.E_SHIFT_AVAILABLE'),
      battery2: S.components.Battery2 ? {
        soc: val('Battery2.STATE_OF_CHARGE'), soh: val('Battery2.STATE_OF_HEALTH'),
        cycles: val('Battery2.NUMBER_OF_FULL_CHARGE_CYCLES'), remainingWh: val('Battery2.REMAINING_ENERGY'),
      } : null,
      isSpeedPedelec: (val('DriveUnit.MAXIMUM_LEGAL_BIKE_SPEED') || 0) > 30,
      readAt: S.readAt || new Date(),
      source: S.demo ? 'demo' : S.mode === 'file' ? 'file' : 'live',
      simulated: S.demo === true || S.simulatedExport === true,
    };
  }
  const PALETTE = ['#9aa1aa', '#78be20', '#00a5d8', '#9643ed', '#e2373f', '#e8b100'];

  function shortName(comp, name) {
    if (!name) return null;
    return name.replace(/^Drive Unit\s+/i, '').replace(/^Battery\s+/i, '');
  }

  const fmtKm = (km) => (km == null ? '–' : `${NF1.format(km)} km`);
  const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '–');
  const fmtDateTime = (d) => d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtW = (w) => (w == null ? '–' : `${NF1.format(w)} W`);
  const yesNo = (b) => (b === null || b === undefined ? '–' : b ? 'Yes' : 'No');
  function serviceText(sv) {
    if (!sv || !sv.set) return 'Not set';
    const date = sv.timestamp ? fmtDate(sv.timestamp) : null;
    const km = sv.odometer ? `${NF0.format(sv.odometer / 1000)} km` : null;
    if (date && km) return `date: ${date}, distance: ${km}`;
    if (date) return `date: ${date} (no distance)`;
    if (km) return `${km} (no date)`;
    return 'Not set';
  }

  // ------------------------------------------------------------ icons
  const ICON = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    light: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    wrench: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    comp: {
      RemoteControl: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="3"/><path d="M12 6v4M10 8h4M10 16h4"/></svg>',
      DriveUnit: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12a8 6 0 0 1 16 0v1a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><circle cx="14" cy="12" r="2.5"/></svg>',
      Battery: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="4" width="10" height="18" rx="2"/><path d="M10 2h4M10 9h4M10 13h4M10 17h4"/></svg>',
      HeadUnit: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="10" rx="1"/></svg>',
      MiniRemote: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="5" width="8" height="14" rx="2"/><path d="M12 9v2M11 10h2M11 15h2"/></svg>',
    },
  };

  function bikeSvg() {
    const G = window.Bes3BikeGeometry;
    const wheel = (cx) => `<circle cx="${cx}" cy="118" r="50" stroke="var(--ink-3)" stroke-width="8" fill="none"/>
      <circle cx="${cx}" cy="118" r="42" stroke="var(--line)" stroke-width="2" fill="none"/>`;
    return `<svg viewBox="0 0 330 190" role="img" aria-label="eBike">
      ${wheel(70)}${wheel(260)}
      <g stroke="var(--ink)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none">
        ${G.tubes.map(([p, q]) => `<path d="M${p[0]} ${p[1]} L${q[0]} ${q[1]}"/>`).join('')}
      </g>
      <path d="M${G.batt[0][0]} ${G.batt[0][1]} L${G.batt[1][0]} ${G.batt[1][1]}" stroke="var(--primary)" stroke-width="13" stroke-linecap="round"/>
      <circle cx="${G.bb[0]}" cy="${G.bb[1]}" r="13" fill="var(--ink)"/>
      <circle cx="${G.bb[0]}" cy="${G.bb[1]}" r="5.5" fill="var(--primary)"/>
      <circle cx="70" cy="118" r="6" fill="var(--ink)"/><circle cx="260" cy="118" r="6" fill="var(--ink)"/>
    </svg>`;
  }

  function partImg(comp, code) {
    const P = window.Bes3PartImages;
    if (P && typeof P.resolve === 'function') return P.resolve(comp, code);
    const t = P && P[comp];
    if (!t || !code) return null;
    if (Object.prototype.hasOwnProperty.call(t, code)) return 'web/parts/' + t[code];
    const k = Object.keys(t).sort((a, b) => b.length - a.length).find((p) => code.startsWith(p));
    return k ? 'web/parts/' + t[k] : null;
  }

  // Shared component-photo control used on both the Overview and the report
  // tab. A button with an explicit state instead of a checkbox. Session-only,
  // OFF by default, and the note states that loading contacts the upstream host.
  let photoStatus = 'idle'; // idle | loading | loaded | failed
  function photoStatusText() {
    const P = window.Bes3PartImages;
    if (!P || typeof P.isRemoteOptIn !== 'function' || !P.isRemoteOptIn()) return 'Not loaded. Local vector icons are used.';
    if (photoStatus === 'loading') return 'Loading from cdn.jsdelivr.net…';
    if (photoStatus === 'loaded') return 'Loaded for this session.';
    if (photoStatus === 'failed') return 'Loading failed; the report uses vector icons.';
    return 'Not loaded. Local vector icons are used.';
  }
  function photoLoadControl(context) {
    const P = window.Bes3PartImages;
    if (!P || typeof P.isRemoteOptIn !== 'function') return '';
    const suffix = String(context || 'default');
    return `<div style="margin-top:10px">
      <p class="field__hint" style="margin:0 0 6px">Component photos are optional and stay session-only; they are OFF by default. Loading them contacts <span class="mono">cdn.jsdelivr.net</span> (an external request). Without them the Workshop uses local vector icons.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn btn--ghost btn--sm" data-act="loadPhotos" id="photoBtn-${esc(suffix)}"${photoStatus === 'loading' ? ' disabled' : ''}>${photoStatus === 'loaded' ? 'Reload component photos' : 'Load component photos'}</button>
        <span class="field__hint" id="photoState-${esc(suffix)}" role="status">${esc(photoStatusText())}</span>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ chrome
  let tab = 'read';
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'));
    ['read', 'write', 'report', 'registry', 'log'].forEach((v) => { $(`view-${v}`).hidden = v !== t || !hasData(); });
    $('view-start').hidden = hasData() || S.mode === 'reading' || S.mode === 'connecting';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Opening the Configure tab asks once per session for the consent to write.
    if (t === 'write') maybeAskConsent();
  }
  const hasData = () => Object.keys(S.values).length > 0 && S.mode !== 'reading';

  function connBanner() {
    let unverifiedNote = '';
    if (W.isLive && S.lastUnverifiedWrite) {
      const u = S.lastUnverifiedWrite;
      const target = `${u.component}.${u.name}`;
      const current = S.values[target] && S.values[target].display ? S.values[target].display : 'not read';
      unverifiedNote = `<div class="notice notice--warn conn-banner" role="alert">${ICON.warn}<div class="conn-banner__text"><strong>Unverified write from previous session:</strong> <span class="mono">${esc(target)}</span> (${esc(u.label || 'write')}) was transmitted before the connection dropped. Current value after reconnect: <strong>${esc(current)}</strong>.</div><button class="btn btn--ghost btn--sm" data-act="dismissUnverified">Dismiss</button></div>`;
    }
    if (S.simulatedExport) {
      return `${unverifiedNote}<div class="notice notice--warn conn-banner" role="alert">${ICON.warn}<div class="conn-banner__text"><strong>Simulated data (exported from demo mode).</strong> This readout was produced by the simulated demo bike; it does not describe a real eBike. Configuration stays locked.</div></div>`;
    }
    if (S.demo && W.isLive) return unverifiedNote;
    if (S.connectionLost) {
      const r = String(S.connectionLostReason || 'The eBike stopped responding').replace(/\.?$/, '.');
      return `${unverifiedNote}<div class="notice notice--bad conn-banner" role="alert">${ICON.warn}<div class="conn-banner__text"><strong>Connection lost.</strong> ${esc(r)} The last readout stays visible; configuration is locked until you reconnect.</div><button class="btn btn--primary btn--sm" data-act="reconnect">Reconnect</button></div>`;
    }
    if (!W.isLive && hasData() && S.mode === 'file') {
      return `${unverifiedNote}<div class="notice conn-banner">${ICON.info}<div class="conn-banner__text"><strong>Not connected.</strong> You are viewing a saved readout. Connect the eBike via USB for live values and configuration.</div><button class="btn btn--primary btn--sm" data-act="reconnect">Connect</button></div>`;
    }
    return unverifiedNote;
  }

  function renderChrome() {
    const busy = S.mode === 'reading' || S.mode === 'connecting';
    const writing = !!W.busy;
    const pill = $('connPill');
    let st = 'idle'; let txt = 'Not connected';
    if (S.mode === 'connecting') { st = 'busy'; txt = 'Connecting …'; }
    else if (S.mode === 'reading') { st = 'busy'; txt = 'Reading …'; }
    else if (S.demo && W.isLive) { st = 'demo'; txt = 'Demo · simulated'; }
    else if (W.isLive) { st = 'live'; txt = 'Connected'; }
    else if (S.connectionLost) { st = 'lost'; txt = 'Connection lost'; }
    else if (S.mode === 'file') { st = 'file'; txt = 'Saved readout'; }
    pill.dataset.state = st; $('connText').textContent = txt;
    $('tabs').hidden = !hasData();
    $('btnReread').hidden = !(W.isLive && hasData() && !busy && !writing);
    $('btnReread').disabled = busy || writing;
    const tr = $('btnTopReconnect'); if (tr) tr.hidden = W.isLive || !hasData() || busy;
    $('btnDisconnect').hidden = !(W.isLive || S.mode === 'file');
    $('btnDisconnect').textContent = W.isLive ? 'Disconnect' : 'Close';
    $('progress').hidden = !busy;
    const showStart = !hasData() && !busy;
    $('view-start').hidden = !showStart;
    ['read', 'write', 'report', 'registry', 'log'].forEach((v) => { $(`view-${v}`).hidden = !(hasData() && v === tab) && !(busy && v === 'read'); });
  }

  // ------------------------------------------------------------ READ view
  function renderReading() {
    const el = $('view-read');
    el.innerHTML = `<div class="reading"><h2>${S.demo ? 'Reading demo eBike' : 'Reading your eBike'}</h2>
      <p id="readingLabel" role="status">System data, assistance modes and fault memory · keep the cable connected</p></div>
      <div class="skeleton"><div class="sk" style="height:200px"></div>
      <div class="grid grid--kpi">${'<div class="sk" style="height:110px"></div>'.repeat(6)}</div>
      <div class="sk" style="height:260px"></div></div>`;
  }

  // The KPI card. `label`, `value`, `unit` and `meta` are text and are escaped;
  // `badge` and `extra` are trusted HTML fragments built by the app itself (a
  // chip or a meter), never device or file text.
  function kpi(label, value, unit, meta, badge, extra = '') {
    const isText = typeof value === 'string' && /[A-Za-zÄÖÜäöü]{4,}/.test(value);
    return `<div class="card kpi"><div class="kpi__head"><span class="card__label">${esc(label)}</span>${badge || ''}</div>
      <span class="kpi__value ${isText ? 'kpi__value--text' : ''}">${esc(value)}${unit ? `<span class="kpi__unit">${esc(unit)}</span>` : ''}</span>
      ${extra}${meta ? `<span class="kpi__meta">${esc(meta)}</span>` : ''}</div>`;
  }
  const CHIP_ICON = { 'chip--ok': 'check', 'chip--bad': 'x', 'chip--warn': 'warn' };
  // Container style for evidence chips: each chip sits on its own line under the
  // control's title/description, and the row wraps instead of overflowing.
  const CHIP_ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:6px;min-width:0';
  const chip = (txt, cls = '', title = '', style = '') => {
    const ic = CHIP_ICON[cls] ? ICON[CHIP_ICON[cls]].replace(/width="1[46]" height="1[46]"/, 'width="12" height="12"') : '';
    return `<span class="chip ${cls}"${title ? ` title="${esc(title)}"` : ''}${style ? ` style="${style}"` : ''}>${ic}${esc(txt)}</span>`;
  };
  // Wrap evidence chips in a full-width, wrapping row so they never overflow a
  // card. Returns '' when there are no chips.
  const chipsRow = (...items) => {
    const inner = items.filter(Boolean).join('');
    return inner ? `<div class="chips" style="${CHIP_ROW_STYLE}">${inner}</div>` : '';
  };
  // Short, fixed evidence labels for the visible chip. The full evidence note is
  // kept in the chip's title (tooltip) so the chip stays narrow and cannot
  // overflow its card. The policy metadata (evidence, evidenceNote) is unchanged.
  const EVIDENCE_SHORT = {
    'observed-working': 'Observed working',
    'untested': 'Untested',
    'known-issue': 'Known issue',
    'unavailable-live': 'Unavailable',
  };
  // Evidence chip sourced from the write policy. The card header carries the
  // single "Experimental" marker; each control row shows only that operation's
  // evidence label, so the two pieces of information are not repeated. The chip
  // may wrap and is capped at the container width.
  function opChip(opId) {
    const d = POLICY.describeOp(opId);
    if (!d) return '';
    const short = EVIDENCE_SHORT[d.evidence] || d.evidenceLabel || d.evidence;
    return chip(short, 'chip--warn', d.evidenceNote, 'max-width:100%;white-space:normal;overflow-wrap:anywhere');
  }
  const experimentalChip = () => chip('Experimental', 'chip--warn');

  function issueCard(i) {
    const sevCls = i.severity === 'CRITICAL_ERROR' || i.severity === 'ERROR' ? 'chip--bad' : i.severity === 'WARNING' ? 'chip--warn' : '';
    const hasText = i.title || i.description || i.measures;
    return `<article class="card issue">
      <div class="issue__head">
        <span class="issue__code mono">${esc(i.code || String(i.issueId))}</span>
        ${i.severityDe ? chip(i.severityDe, sevCls) : ''}
        <span class="issue__comp">${esc(i.componentDe || i.component)}</span>
        <span class="issue__meta">${i.timestamp ? `last ${fmtDateTime(new Date(i.timestamp * 1000))}` : ''}${i.activationCount != null ? ` · occurred ${escNum(i.activationCount)}×` : ''}</span>
      </div>
      ${hasText ? `<h3 class="issue__title">${esc(i.title || 'Error ' + i.code)}</h3>
        ${i.description ? `<p class="issue__p">${esc(i.description)}</p>` : ''}
        ${i.measures ? `<p class="issue__p"><strong>What to do:</strong> ${esc(i.measures).replace(/\n/g, '<br>')}</p>` : ''}`
      : `<p class="issue__p muted">No description is bundled for this code. The Bosch Help Center page for the code has the details, or you can load your own error catalog.</p>`}
      <div class="issue__foot">${i.helpUrl ? `<a href="${esc(i.helpUrl)}" target="_blank" rel="noopener">Error ${esc(i.code)} in the Bosch eBike Help Center</a>` : ''}${i.source ? `<span class="muted">Source: ${esc(i.source)}</span>` : ''}</div>
    </article>`;
  }
  function catalogBtn() {
    const info = window.Bes3Issues && window.Bes3Issues.catalogInfo();
    return info
      ? `<span class="muted" style="font-size:var(--text-xs)">Catalog: ${esc(info.name)} (${NF0.format(info.count)} codes)</span><button class="btn btn--ghost btn--sm" data-act="catalogClear">Remove</button>`
      : `<button class="btn btn--ghost btn--sm" data-act="catalogLoad" title="e.g. issues_en_Rider.json from your own copy of the eBike Flow app">Load error catalog</button>`;
  }

  // Raw registers behind a component card. Used by the Mini Remote card so the
  // exact USB read is visible instead of an unsupported "detected" claim.
  function rawDetails(c) {
    if (!c.raw || !c.raw.length) return '';
    const rows = c.raw.map((r) => `<span>${esc(r.label)}</span><span>${esc(r.display)}${r.hex && r.hex !== r.display ? ' · ' + esc(r.hex) : ''}</span>`).join('');
    return `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--ink-3);font-size:var(--text-xs)">Raw register values</summary><div class="comp__meta" style="margin-top:4px">${rows}</div></details>`;
  }

  // The read-only Mini Remote probe: read requests only, no writes.
  function remoteProbeBlock() {
    return `<div style="margin-top:8px"><button class="btn btn--ghost btn--sm" data-act="probeRemote">Probe remote registers</button>
      <p class="field__hint" style="margin:4px 0 0">Sends read requests only — one per register, no retries, nothing is written. The result may stay empty: the remote pairs over Bluetooth and does not have to appear in the wired registers.</p>
      ${remoteProbeTable()}</div>`;
  }

  // The results of the read-only Mini Remote probe. The block is its own
  // bounded scroll area: the probe can return more than a hundred rows, and a
  // long register name or hex value must never widen the component grid.
  function remoteProbeTable() {
    const rows = Array.isArray(S.remoteProbe) ? S.remoteProbe : [];
    if (!rows.length) return '';
    const counts = View.probeSummary(rows);
    const withValue = rows.filter(View.probeRowHasValue);
    const empty = rows.filter((r) => !View.probeRowHasValue(r));
    const rowHtml = (r) => {
      const address = Number.isFinite(r.address) ? `0x${r.address.toString(16)}` : 'address withheld';
      const value = r.redacted
        ? 'payload removed'
        : r.status === 'ok'
          ? String(r.display || '') + (r.hex ? ' · ' + String(r.hex) : '')
          : String(r.status);
      return `<tr>
      <td class="probe-register"><span class="mono">${esc(r.component + '.' + r.name)}</span><span class="probe-address mono">${esc(address)}</span></td>
      <td class="probe-value mono">${esc(value)}</td>
    </tr>`;
    };
    const emptyRows = empty.map(rowHtml).join('');
    return `<div class="probe-results" data-probe-results>
      <div class="probe-results__head">
        <span><strong>${escNum(counts.read)} of ${escNum(counts.total)}</strong> registers read</span>
        ${empty.length ? `<button class="btn btn--ghost btn--sm" data-act="probeEmpty" data-empty-count="${escNum(empty.length)}" aria-expanded="false" aria-controls="probeEmptyRows">Show ${escNum(empty.length)} empty</button>` : ''}
      </div>
      <table class="probe-table"><caption>Probe results: ${escNum(counts.read)} of ${escNum(counts.total)} registers returned a value${empty.length ? `; ${escNum(empty.length)} returned no value` : ''}.</caption>
        <thead><tr><th scope="col">Register</th><th scope="col">Value</th></tr></thead>
        <tbody>${withValue.map(rowHtml).join('')}</tbody>
        ${empty.length ? `<tbody id="probeEmptyRows" hidden>${emptyRows}</tbody>` : ''}
      </table>
    </div>`;
  }

  // Expand or collapse the empty probe rows without re-rendering the whole
  // readout, so the scroll position and the focus stay where the user left them.
  function toggleProbeEmpty(btn) {
    const target = document.getElementById(btn.getAttribute('aria-controls'));
    if (!target) return;
    const show = btn.getAttribute('aria-expanded') !== 'true';
    target.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    const count = btn.dataset.emptyCount || String(target.children.length);
    btn.textContent = show ? 'Hide empty' : `Show ${count} empty`;
  }

  function renderRead() {
    const el = $('view-read');
    if (S.mode === 'reading') return;
    const d = summary();
    const errCount = d.issues.length;
    const errLabel = d.issuesTruncated ? `${errCount}+` : String(errCount);
    const errChip = !d.issuesScanned ? chip('not checked') : errCount ? chip(errCount === 1 ? '1 entry' : `${errLabel} entries`, 'chip--bad') : chip('none', 'chip--ok');
    const lightChip = d.light.available ? (d.light.on ? chip('on', 'chip--beam') : chip('enabled', 'chip--ok')) : chip('not enabled', 'chip--warn');
    const allGood = d.issuesScanned && !errCount && !d.locked;
    const soc = d.soc;
    const socColor = soc == null ? 'var(--ink-3)' : soc < 20 ? 'var(--bad)' : soc < 40 ? 'var(--warn)' : 'var(--ok)';

    // The Mini Remote is optional and has no separate bus node. The existing
    // strict BRC3300 detection decides whether it is shown at all: no card, no
    // placeholder and no probe block on Overview when the marker is absent.
    const compCards = d.comps.filter((c) => c.key !== 'MiniRemote' || c.present).filter((c) => c.present || c.core).map((c) => {
      if (!c.present) {
        return `<div class="card comp comp--missing"><div class="comp__img">${ICON.comp[c.key] || ICON.comp.HeadUnit}</div>
          <div class="comp__body"><div class="comp__type">${esc(c.type)}</div><div class="comp__name">Not connected</div>${c.hint ? `<div class="comp__hint">${esc(c.hint)}</div>` : ''}${rawDetails(c)}</div></div>`;
      }
      const img = partImg(c.key, c.code);
      return `<div class="card comp"><div class="comp__img">${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.replaceWith(document.createRange().createContextualFragment(${esc(JSON.stringify(ICON.comp[c.key] || ''))}))">` : (ICON.comp[c.key] || ICON.comp.DriveUnit)}</div>
        <div class="comp__body"><div class="comp__type">${esc(c.type)}</div><div class="comp__name">${esc(c.name || c.key)}</div>
        ${c.note ? `<div class="comp__hint">${esc(c.note)}</div>` : `<div class="comp__meta"><span>Part no.</span><span>${esc(c.part || '–')}</span><span>Software</span><span>${esc(c.sw || '–')}</span>${c.code ? `<span>Type</span><span>${esc(c.code)}</span>` : ''}</div>`}${rawDetails(c)}</div></div>`;
    }).join('');
    const missingExtras = d.comps.filter((c) => !c.core && !c.present);

    // stats
    const allModes = d.modes || [];
    const modes = allModes.filter((m) => m.distance != null);
    const deactivated = allModes.filter((m) => m.active === false);
    const totDist = modes.reduce((a, m) => a + (m.distance || 0), 0);
    const totE = modes.reduce((a, m) => a + (m.energy || 0), 0);
    // Other is the part of the bike's own total that is not attributed to any
    // tracked mode. The two quantities use their own total and are skipped
    // independently when that total was not read. The thresholds match the
    // displayed rounding: 0.1 km for distance and 0.01 kWh for energy.
    const totalDistM = d.odoKm != null ? d.odoKm * 1000 : null;
    const otherD = View.otherShare(totalDistM, modes.map((m) => m.distance), 50);
    const otherE = View.otherShare(d.totalEnergyWh, modes.map((m) => m.energy), 5);
    const distModes = View.withOtherSegment(modes, otherD, 'distance');
    const energyModes = View.withOtherSegment(modes, otherE, 'energy');
    const distTotal = otherD.visible ? totalDistM : totDist;
    const energyTotal = otherE.visible ? d.totalEnergyWh : totE;
    const statsNote = otherD.visible || otherE.visible
      ? `<p class="field__hint stats__note"><span class="stats__note-swatch" aria-hidden="true"></span><span><strong>Other</strong> — ${esc(OTHER_NOTE)}</span></p>`
      : '';
    const stack = (items, key, total) => items.map((m) => {
      const v = key === 'eff' ? effOf(m) : (m[key] || 0);
      return `<span class="${m.other ? 'stack__other' : ''}" style="flex:${Math.max(v, total * 0.012)};background:${escColor(m.color)}" title="${esc(m.other ? OTHER_NOTE : m.name)}"></span>`;
    }).join('');
    const effOf = (m) => (m.distance ? (m.energy || 0) / (m.distance / 1000) : 0);
    const totEff = totDist ? totE / (totDist / 1000) : 0;
    const legend = (items, fmt) => items.map((m) => `<span class="${m.other ? 'legend__other' : ''}"${m.other ? ` title="${esc(OTHER_NOTE)}"` : ''}><i style="background:${escColor(m.color)}"></i>${esc(m.name)} <b>${fmt(m)}</b></span>`).join('');
    const otherEff = View.otherEfficiency(otherD, otherE);
    const effModes = modes.slice();
    if (otherEff.visible) effModes.push({ name: 'Other', color: View.OTHER_COLOR, other: true, distance: otherD.value, energy: otherE.value });
    const effTotal = effModes.reduce((a, m) => a + effOf(m), 0);

    const batteryCard = window.Bes3BatteryHealth ? window.Bes3BatteryHealth.render(d) : '';
    const modeRows = d.modes.filter((m) => m.udam).map((m) => `<tr>
      <td><span class="mode-name"><i style="background:${escColor(m.color)}"></i>${esc(m.name)}</span></td>
      <td class="num">${escNum(m.udam.assistLevel)} %</td><td class="num">${escNum(m.udam.accelerationResponse)} %</td>
      <td class="num">${m.udam.maximumBikeSpeed != null ? NF1.format(m.udam.maximumBikeSpeed / 100) + ' km/h' : '–'}</td>
      <td class="num">${escNum(m.udam.maximumMotorTorque)} Nm</td><td class="num">${escNum(m.udam.maximumMotorPower)} W</td></tr>`).join('');

    el.innerHTML = `${connBanner()}
      <div class="section">
        <div class="card bike">
          <div class="bike__main">
            <div>
              <div class="bike__brand">${esc(d.brand || 'Bosch Smart System')}${d.category ? ` · ${esc(d.category)}` : ''}</div>
              <h1 class="bike__name">${esc(d.line || 'E-Bike')}</h1>
              <p class="section__sub" style="margin-top:6px">Read on ${fmtDateTime(d.readAt)} · ${d.simulated ? 'demo data (simulated)' : d.source === 'file' ? 'from saved file' : 'live via USB'}</p>
            </div>
            <div class="bike__chips">
              ${allGood ? chip('All good', 'chip--ok') : d.issuesScanned ? chip('Needs attention', 'chip--warn') : ''}
              ${d.speedClass ? chip(d.speedClass) : ''}
              ${chip(`Light: ${d.light.available ? (d.light.on ? 'on' : 'enabled') : 'not enabled'}`, d.light.available ? 'chip--beam' : '')}
              ${d.locked ? chip('eBike Lock engaged', 'chip--bad') : ''}
            </div>
          </div>
          <div class="bike__art">${bikeSvg(d.modes)}</div>
        </div>
      </div>

      <div class="section">
        <div class="grid grid--kpi">
          ${kpi('Total distance', d.odoKm != null ? NF1.format(d.odoKm) : '–', ' km', d.odoMotorKm != null ? `Motor: ${fmtKm(d.odoMotorKm)}` : '')}
          ${kpi(d.battery2 ? 'Battery 1' : 'Battery', soc != null ? escNum(soc) : '–', ' %', d.battery2 ? `Battery 2: ${d.battery2.soc != null ? escNum(d.battery2.soc) + ' %' : '–'}` : d.remainingWh != null ? `${NF0.format(d.remainingWh)} Wh remaining` : '', '', soc != null ? `<div class="meter"><span style="width:${escNum(soc, '0')}%;background:${socColor}"></span></div>` : '')}
          ${kpi('Battery health', d.soh != null ? d.soh : '–', ' %', d.cycles != null ? `${NF1.format(d.cycles)} full charge cycles` : '')}
          ${kpi('Service interval', serviceText(d.service), '', d.service.set ? 'stored reminder' : 'no reminder active')}
          ${kpi('Bike light', d.light.available ? fmtW(d.light.powerW) : 'Off', '', d.light.available ? `Light currently ${d.light.on ? 'on' : 'off'}` : 'Light output not enabled', lightChip)}
          ${kpi('Fault memory', !d.issuesScanned ? '–' : errCount ? errLabel : 'None', !d.issuesScanned || !errCount ? '' : errCount === 1 ? ' entry' : ' entries', !d.issuesScanned ? (d.source === 'file' ? 'live connection only' : 'not read') : d.issuesTruncated ? 'truncated at 40 per component' : errCount ? 'details below' : 'no stored errors', errChip)}
        </div>
      </div>

      <div class="section">
        <div class="section__head"><div><h2 class="section__title">Components</h2><p class="section__sub">Detected system components with part number and software version</p></div>${photoLoadControl('overview')}</div>
        <div class="grid grid--comp">${compCards}</div>
        ${missingExtras.length ? `<p class="section__sub" style="margin-top:12px">Not installed: ${missingExtras.map((c) => `${esc(c.type)} (${esc(c.hint)})`).join(' · ')}</p>` : ''}
      </div>

      ${batteryCard}

      ${d.issuesScanned || errCount ? `<div class="section" id="issues"><div class="section__head"><div><h2 class="section__title">Fault memory ${experimentalChip()}</h2>
          <p class="section__sub">${errCount ? `${esc(errLabel)} stored entr${errCount === 1 ? 'y' : 'ies'}${d.issuesTruncated ? ' (capped at 40 per component)' : ''} · error codes as shown in the Bosch apps` : 'No stored errors'}</p></div>
          <div class="log-actions">${W.canMutate && errCount ? `<button class="btn btn--ghost btn--sm" data-act="clearIssues" title="Experimental: sends DELETE_ALL_ISSUES / DELETE_ISSUE RPCs">Clear fault memory (experimental)</button>${chipsRow(opChip('CLEAR_ISSUES'))}` : ''}${catalogBtn()}</div></div>
        ${errCount ? `<div class="issues">${d.issues.map(issueCard).join('')}</div>` : ''}
      </div>` : ''}

      ${modes.length ? `<div class="section">
        <div class="section__head"><div><h2 class="section__title">Ride statistics</h2><p class="section__sub">Split by assistance mode, since first use</p></div></div>
        <div class="card">
          <div class="stat"><div class="stat__head"><span class="stat__title">Distance ridden</span><span class="stat__total">${NF1.format(distTotal / 1000)} km</span></div>
            <div class="stack">${stack(distModes, 'distance', distTotal)}</div><div class="legend">${legend(distModes, (m) => `${NF1.format((m.distance || 0) / 1000)} km`)}</div></div>
          <div class="stat"><div class="stat__head"><span class="stat__title">Energy consumption</span><span class="stat__total">${NF2.format(energyTotal / 1000)} kWh</span></div>
            <div class="stack">${stack(energyModes, 'energy', energyTotal)}</div><div class="legend">${legend(energyModes, (m) => `${NF2.format((m.energy || 0) / 1000)} kWh`)}</div></div>
          <div class="stat"><div class="stat__head"><span class="stat__title">Average consumption</span><span class="stat__total">${NF2.format(totEff)} Wh/km</span></div>
            <div class="stack">${stack(effModes, 'eff', effTotal)}</div><div class="legend">${legend(effModes, (m) => `${NF2.format(effOf(m))} Wh/km`)}</div></div>
          ${statsNote}
          ${deactivated.length ? `<div class="stat"><div class="stat__head"><span class="stat__title">Deactivated modes</span><span class="stat__total">${escNum(deactivated.length)}</span></div>
            <div class="legend">${deactivated.map((m) => `<span><i style="background:${escColor(m.color)}"></i>${esc(m.name)} <b>no statistics</b></span>`).join('')}</div>
            <p class="field__hint">These mode slots exist on the bike, but it reports no configuration id for them, so their statistics cannot be read over USB (every statistics call is keyed by that id). They are listed, not guessed.</p></div>` : ''}
        </div></div>` : ''}

      <div class="section grid grid--2">
        <div class="card">
          <div class="section__head"><h2 class="section__title">Configuration</h2></div>
          <div class="kv-group"><h4>Speed</h4><dl class="kv">
            <dt>Speed class</dt><dd>${esc(d.speedClass || '–')}</dd>
            <dt>Legal maximum speed</dt><dd>${d.legal != null ? NF1.format(d.legal) + ' km/h' : '–'}</dd>
            <dt>Assistance cut-off speed</dt><dd>${d.maxAssist != null ? NF1.format(d.maxAssist) + ' km/h' : '–'}</dd></dl></div>
          <div class="kv-group"><h4>Bike light</h4><dl class="kv">
            <dt>Light installed</dt><dd>${yesNo(d.light.available)}</dd>
            <dt>Light configuration</dt><dd>${esc(lightConfigLabel(d.light.config))}</dd>
            <dt>Light power rating</dt><dd>${fmtW(d.light.powerW)}</dd>
            <dt>Light currently</dt><dd>${d.light.on == null ? '–' : d.light.on ? 'on' : 'off'}</dd></dl></div>
          <div class="kv-group"><h4>Walk assist &amp; drivetrain</h4><dl class="kv">
            <dt>Walk assist enabled</dt><dd>${d.walk ? yesNo(d.walk.enabled) : '–'}</dd>
            <dt>Walk assist speed</dt><dd>${d.walk && d.walk.speed ? NF1.format(d.walk.speed) + ' km/h' : '–'}</dd>
            <dt>Start mode</dt><dd>${esc(d.startMode || '–')}</dd>
            <dt>Gearing system</dt><dd>${esc(d.gearing || '–')}${d.eShift ? ' · eShift' : ''}</dd>
            <dt>Max. gear ratio</dt><dd>${d.gearRatio != null ? NF2.format(d.gearRatio) : '–'}</dd>
            <dt>Rear wheel circumference (OEM / user)</dt><dd>${d.wheelOem != null ? NF0.format(d.wheelOem) : '–'} / ${d.wheelUser != null ? NF0.format(d.wheelUser) : '–'} mm</dd></dl></div>
        </div>
        <div class="card">
          <div class="section__head"><h2 class="section__title">Battery &amp; system</h2></div>
          <div class="kv-group"><h4>${d.battery2 ? 'Battery 1' : 'Battery'}</h4><dl class="kv">
              <dt>State of charge</dt><dd>${soc != null ? escNum(soc) + ' %' : '–'}</dd>
            <dt>Voltage</dt><dd>${d.voltage != null ? NF1.format(d.voltage) + ' V' : '–'}</dd>
            <dt>Full charge cycles</dt><dd>${d.cycles != null ? NF1.format(d.cycles) : '–'}</dd>
            <dt>Energy delivered (lifetime)</dt><dd>${d.deliveredWh != null ? NF1.format(d.deliveredWh / 1000) + ' kWh' : '–'}</dd>
            <dt>Temperature min. / max.</dt><dd>${d.tMin != null ? NF1.format(d.tMin) : '–'} / ${d.tMax != null ? NF1.format(d.tMax) : '–'} °C</dd></dl></div>
          ${d.battery2 ? `<div class="kv-group"><h4>Battery 2</h4><dl class="kv">
            <dt>State of charge</dt><dd>${d.battery2.soc != null ? escNum(d.battery2.soc) + ' %' : '–'}</dd>
            <dt>Battery health</dt><dd>${d.battery2.soh != null ? escNum(d.battery2.soh) + ' %' : '–'}</dd>
            <dt>Full charge cycles</dt><dd>${d.battery2.cycles != null ? NF1.format(d.battery2.cycles) : '–'}</dd></dl></div>` : ''}
          <div class="kv-group"><h4>General settings</h4><dl class="kv">
            <dt>Display language</dt><dd>${esc(d.language || '–')}</dd>
            <dt>Units</dt><dd>${esc(d.units || '–')}</dd>
            <dt>Date / time on bike</dt><dd>${d.time ? fmtDateTime(new Date(d.time * 1000)) : '–'}</dd>
            <dt>Time zone</dt><dd>${esc(d.tz || '–')}</dd></dl></div>
          <div class="kv-group"><h4>Security &amp; identifiers</h4><dl class="kv">
            <dt>eBike Lock feature</dt><dd>${yesNo(d.lockFeature)}</dd>
            <dt>eBike Lock engaged</dt><dd>${yesNo(d.locked)}</dd>
            <dt>Battery key lock number</dt><dd class="mono">${esc(d.keyLock || '–')}</dd>
            <dt>eBike ID</dt><dd class="mono">${esc(d.oemBikeId || '–')}</dd>
            <dt>System ID (drive unit / control unit)</dt><dd class="mono">${d.duId || d.rcId ? (d.idConflict ? `<span style="color:var(--bad)">mismatch detected</span>` : d.duId && d.rcId ? 'matching' : 'incomplete') : '–'}</dd></dl></div>
        </div>
      </div>

      ${modeRows ? `<div class="section"><div class="section__head"><div><h2 class="section__title">Assistance modes</h2><p class="section__sub">Current parameters per mode</p></div></div>
        <div class="card table-wrap"><table class="t"><thead><tr><th>Mode</th><th class="num">Assistance</th><th class="num">Dynamics</th><th class="num">Max. speed</th><th class="num">Max. torque</th><th class="num">Max. power</th></tr></thead><tbody>${modeRows}</tbody></table></div></div>` : ''}


    `;
  }

  // ------------------------------------------------------------ WRITE view
  const draft = { light: null, service: { option: 'year', date: '', km: '' }, advanced: { target: '', payload: '', search: '', components: null, rawOpen: false, cursor: -1 } };
  // Staged changes are UI state only. They are never sent until Apply, and a
  // session change clears them before the new session can be written.
  const pending = [];
  let pendingLampConfirmed = false;

  // The Write Lab draft is cleared whenever the session changes: a payload or a
  // typed register name must never survive a disconnect, a connection loss, a
  // demo switch or the opening of a saved readout.
  function resetWriteLabDraft() {
    draft.advanced.target = '';
    draft.advanced.payload = '';
    draft.advanced.search = '';
    draft.advanced.components = null;
    draft.advanced.cursor = -1;
  }
  function clearPending() {
    pending.length = 0;
    pendingLampConfirmed = false;
  }
  function pendingKey(step) { return step.component + '.' + step.name; }
  function pendingTier(step) {
    return step.op === 'GENERIC_WRITE' ? POLICY.genericTier(step.component, step.name).tier : 'dedicated';
  }
  function pendingWarning(step, tier) {
    if (step.op === 'BIKE_ID') return 'The System ID write is experimental and untested. A matching read-back does not prove that an ID conflict is resolved.';
    if (step.op === 'SERVICE_DUE' && /^Clear/i.test(step.label)) return 'Clearing the service interval means no service reminder will appear. Regular maintenance is still required.';
    if (step.op === 'GENERIC_WRITE' && tier === 'registry-readonly') return 'Read-only in registry. Type the full register name once per Apply batch. The bike will usually refuse this write.';
    if (step.op === 'GENERIC_WRITE' && tier === 'high-impact') return 'High-impact register. Type the full register name once per Apply batch. Nothing is retried and nothing is rolled back.';
    if (step.op === 'GENERIC_WRITE' && step.unreadable) return 'Write-only register. It cannot be read back, so the result will be unverified. Nothing is retried and nothing is rolled back.';
    if (step.op === 'GENERIC_WRITE') return 'Unverified register. The payload is written as-is and re-read; nothing is retried and nothing is rolled back.';
    return '';
  }
  function pendingItem(step, source) {
    const info = approvalInfo(step);
    const tier = pendingTier(step);
    const op = POLICY.describeOp(step.op === 'GENERIC_WRITE' ? 'GENERIC_WRITE' : step.op);
    return {
      key: pendingKey(step), source, step,
      op: step.op, component: step.component, name: step.name,
      address: info.address,
      label: step.label,
      oldDisplay: info.current,
      newDisplay: step.intended != null ? step.intended : intendedDisplay(step),
      bytes: step.bytes || '(empty)',
      tier,
      evidence: op ? op.evidenceLabel : 'Untested',
      evidenceNote: op ? op.evidenceNote : '',
      risky: tier === 'high-impact' || tier === 'registry-readonly',
      warning: pendingWarning(step, tier),
    };
  }
  function stageSteps(source, steps) {
    const keys = new Set(steps.map(pendingKey));
    for (const step of steps) {
      const item = pendingItem(step, source);
      const i = pending.findIndex((p) => p.key === item.key);
      if (i === -1) pending.push(item); else pending[i] = item;
    }
    // A light-card plan replaces the card's previous steps as one unit. Other
    // sources (the Write Lab in particular) add one row per explicit stage.
    if (source === 'light') {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].source === 'light' && !keys.has(pending[i].key)) pending.splice(i, 1);
      }
    }
    pendingLampConfirmed = false;
    renderWrite();
    toast(`${steps.length} change${steps.length === 1 ? '' : 's'} staged — nothing has been sent`);
  }
  function pendingLightEnables() {
    return pending.some((p) => {
      if (p.op === 'LIGHT_AVAILABLE' || p.op === 'LIGHT_SWITCH') return p.step.value === true;
      return p.op === 'LIGHT_CONFIG' || p.op === 'LIGHT_POWER';
    });
  }
  function removePending(key) {
    const i = pending.findIndex((p) => p.key === key);
    if (i === -1) return;
    pending.splice(i, 1);
    pendingLampConfirmed = false;
    renderWrite();
    toast('Staged change removed — nothing sent');
  }
  function editPending(key) {
    const item = pending.find((p) => p.key === key);
    if (!item) return;
    if (item.op !== 'GENERIC_WRITE') {
      toast('Remove this change and stage it again from its card');
      return;
    }
    draft.advanced.target = item.key;
    draft.advanced.payload = item.step.value || item.step.bytes || '';
    removePending(key);
    toast('Loaded into Write Lab — adjust the payload and stage it again');
  }
  function discardPending() {
    if (!pending.length) return;
    clearPending();
    renderWrite();
    toast('Staged changes discarded — nothing sent');
  }
  function pendingPanel() {
    if (!pending.length) return '';
    const lamp = pendingLightEnables();
    const warnings = Array.from(new Set(pending.map((p) => p.warning).filter(Boolean)));
    const disabled = !W.canMutate || (lamp && !pendingLampConfirmed);
    return `<article class="card wcard wcard--full" id="pendingChanges" aria-labelledby="pendingTitle">
      <header class="wcard__head">
        <span class="wcard__icon wcard__icon--primary">${ICON.check}</span>
        <div><h2 class="wcard__title" id="pendingTitle">Pending changes (${escNum(pending.length)})</h2>
          <p class="wcard__sub">Nothing here has been sent. Review every row, then Apply the whole batch. Each write is re-read; the batch stops at the first unverified step and is never retried or rolled back.</p></div>
      </header>
      <div class="wcard__body">
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Register</th><th>Change</th><th>Payload</th><th>Tier</th><th>Evidence</th><th></th></tr></thead>
          <tbody>${pending.map((p) => `<tr data-pending-key="${esc(p.key)}">
            <td class="mono">${esc(p.key)}<br><span class="muted">${esc(p.address)}</span></td>
            <td>${esc(p.oldDisplay)} <span class="arrow">→</span> <strong>${esc(p.newDisplay)}</strong></td>
            <td class="mono">${esc(p.bytes)}</td>
            <td>${esc(p.tier)}</td>
            <td>${esc(p.evidence)}</td>
            <td style="white-space:nowrap"><button class="btn btn--ghost btn--sm" data-pending-edit="${esc(p.key)}" ${p.op === 'GENERIC_WRITE' ? '' : 'disabled'}>Edit</button>
              <button class="btn btn--ghost btn--sm" data-pending-remove="${esc(p.key)}">Remove</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${warnings.map((w) => `<div class="notice notice--warn">${ICON.warn}<div>${esc(w)}</div></div>`).join('')}
        ${lamp ? `<div class="notice notice--beam">${ICON.warn}<div><strong>Please confirm:</strong> front and rear light are approved for the Bosch Smart System (12 V), properly connected, and rated for your lamps' combined load.</div></div>
          <label class="check"><input type="checkbox" id="pendingLampConfirm" ${pendingLampConfirmed ? 'checked' : ''}> I have checked the manufacturer's specifications of my lights.</label>` : ''}
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn--primary" data-act="pendingApply" ${disabled ? 'disabled' : ''}>Apply ${escNum(pending.length)} change${pending.length === 1 ? '' : 's'}</button>
          <button class="btn btn--ghost" data-act="pendingDiscard">Discard all</button>
          <span class="field__hint">${W.canMutate ? (lamp && !pendingLampConfirmed ? 'Confirm the lamp safety checkbox to apply.' : 'Apply sends this visible batch once.') : 'Experimental writes are not enabled.'}</span>
        </div>
      </div>
    </article>`;
  }
  // Write Lab register list: every registry entry the policy does not block,
  // including read-only entries (listed for reference and never written).
  // Components are listed in the same order as the original reader.
  const WRITE_LAB_COMPONENTS = [
    ['DriveUnit', 'Drive Unit'],
    ['Battery', 'Battery'],
    ['Battery2', 'Battery 2'],
    ['RemoteControl', 'Remote'],
    ['HeadUnit', 'Head Unit'],
    ['ConnectModule', 'Connect Module'],
    ['AntiLockBrakeSystem', 'ABS'],
    ['MobileApp', 'Mobile App'],
    ['BoschDiagnoseApp', 'Diagnose App'],
    ['CanTestNode', 'CAN Test Node'],
  ];
  function registryEntries() {
    const reg = window.Bes3AddressRegistry;
    return reg && reg.ADDRESS_REGISTRY && Array.isArray(reg.ADDRESS_REGISTRY.addresses)
      ? reg.ADDRESS_REGISTRY.addresses : [];
  }
  // The Write Lab targets are the registry entries the policy does not block.
  // The list and the tier of every entry are cached; the cache is dropped when
  // the registry itself changes, so a render never walks the 895 entries again.
  let genericTargetsCache = null;
  function genericTargets() {
    const entries = registryEntries();
    if (genericTargetsCache && genericTargetsCache.entries === entries) return genericTargetsCache.list;
    const seen = new Set();
    const out = [];
    const tiers = POLICY.genericTierMap();
    for (const entry of entries) {
      if (!entry || !entry.component || !entry.name) continue;
      const key = genericTargetKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      const tier = tiers.get(key);
      if (tier && tier.tier === 'blocked') continue;
      out.push(entry);
    }
    genericTargetsCache = { entries, list: out };
    return out;
  }
  function genericTargetKey(t) { return t.component + '.' + t.name; }
  function entryReadable(entry) {
    return !(entry && entry.readable === false);
  }
  function writeLabComponentList() {
    const entries = genericTargets();
    return WRITE_LAB_COMPONENTS.filter(([c]) => entries.some((e) => e.component === c));
  }
  function writeLabActiveComponents() {
    const present = writeLabComponentList().map(([c]) => c);
    if (!Array.isArray(draft.advanced.components)) return new Set(present);
    return new Set(draft.advanced.components.filter((c) => present.indexOf(c) !== -1));
  }
  // The visible list depends only on the component filter and the search text.
  // It is computed once per render and once per keystroke, never twice for the
  // same filter.
  let writeLabFilteredCache = null;
  function writeLabFiltered() {
    const active = writeLabActiveComponents();
    const q = String(draft.advanced.search || '').trim().toLowerCase();
    const key = Array.from(active).sort().join(',') + '|' + q;
    if (writeLabFilteredCache && writeLabFilteredCache.key === key) return writeLabFilteredCache.list;
    const list = genericTargets()
      .filter((e) => active.has(e.component))
      .filter((e) => !q || `${e.label} ${e.name} ${e.component} 0x${e.address.toString(16)}`.toLowerCase().indexOf(q) !== -1)
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    writeLabFilteredCache = { key, list };
    return list;
  }
  function writeLabOptionText(e) {
    const t = POLICY.genericTier(e.component, e.name);
    const tags = [];
    if (t.tier === 'high-impact') tags.push('high impact');
    if (t.tier === 'registry-readonly') tags.push('read-only');
    if (!entryReadable(e)) tags.push('write-only');
    return `${e.label} — ${e.component}.${e.name} (0x${e.address.toString(16)})${tags.length ? ' — ' + tags.join(', ') : ''}`;
  }
  // The visible result list is the picker. It is updated in place while typing
  // so the search field keeps focus; selecting an item is a deliberate click or
  // Enter, which then rebuilds the card.
  function writeLabResultsHtml(entries, selectedKey, cursor) {
    if (!entries.length) {
      return `<div class="field__hint" id="wlNoMatch" role="status">No matching register. Clear the search or the component filter.</div>`;
    }
    return entries.map((e, i) => {
      const key = genericTargetKey(e);
      const selected = key === selectedKey;
      const active = i === cursor;
      return `<button type="button" role="option" id="wlOpt${i}" aria-selected="${selected ? 'true' : 'false'}" data-wlkey="${esc(key)}" class="preset" style="text-align:left;width:100%;white-space:normal;line-height:1.35;${selected ? 'border-color:var(--primary);' : ''}${active ? 'outline:2px solid var(--primary);outline-offset:-2px;' : ''}">${esc(writeLabOptionText(e))}</button>`;
    }).join('');
  }
  function bindWriteLabResults() {
    document.querySelectorAll('[data-wlkey]').forEach((b) => {
      b.onclick = () => selectWriteLabEntry(b.dataset.wlkey);
    });
  }
  function refreshWriteLabResults() {
    const box = $('wlResults');
    if (!box) return;
    box.innerHTML = writeLabResultsHtml(writeLabFiltered(), draft.advanced.target, draft.advanced.cursor);
    const search = $('wlSearch');
    if (search) {
      const active = draft.advanced.cursor >= 0 ? box.children[draft.advanced.cursor] : null;
      if (active && active.id) search.setAttribute('aria-activedescendant', active.id);
      else search.removeAttribute('aria-activedescendant');
      search.setAttribute('aria-expanded', 'true');
    }
    bindWriteLabResults();
    updateWriteLabAvailability();
  }
  function selectWriteLabEntry(key) {
    draft.advanced.target = key;
    draft.advanced.payload = '';
    draft.advanced.cursor = -1;
    renderWrite();
    const s = $('wlSearch');
    if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  function writeLabEntry() {
    const key = draft.advanced.target;
    if (!key) return null;
    return writeLabFiltered().find((e) => genericTargetKey(e) === key) || null;
  }
  function writeLabReasons(entry) {
    const tier = entry ? POLICY.genericTier(entry.component, entry.name).tier : null;
    const cur = entry ? S.values[genericTargetKey(entry)] : null;
    // The order of the missing prerequisites is decided by one pure policy
    // function (POLICY.writeLabNextStep), so the UI and the tests agree.
    const next = POLICY.writeLabNextStep({
      sessionOpen: W.isLive || S.demo,
      experimentalEnabled: W.experimentalEnabled,
      hasTarget: !!entry,
      targetReadable: entry ? entryReadable(entry) : false,
      targetRead: !!(cur && cur.status === 'ok'),
      payloadValid: POLICY.validateHexPayload(draft.advanced.payload).ok,
      // The typed register-name gate is asked once at Apply, not while staging.
      typedNameRequired: false,
      typedNameConfirmed: true,
    });
    return next.step ? [next.label] : [];
  }
  function updateWriteLabAvailability() {
    const el = $('view-write');
    if (!el) return;
    const entry = writeLabEntry();
    const reasons = writeLabReasons(entry);
    const btn = $('wlWrite');
    // The button is never a dead end: clicking it runs the guided flow, which
    // explains and performs the next missing step. It is only disabled when no
    // session is open (file mode never allows writes).
    if (btn) { btn.disabled = !(W.isLive || S.demo); btn.title = reasons.join('; '); }
    const why = $('wlReasons');
    if (why) why.textContent = reasons.length ? 'Next: ' + reasons.join(' → ') : 'All conditions met.';
  }
  function writeLabFriendlyInput(entry) {
    if (!entry) return '';
    const kind = entry.kind;
    if (kind === 'bool') {
      return `<label class="check"><input type="checkbox" id="wlBool"> Value (boolean)</label>`;
    }
    if (kind === 'uint' || kind === 'normFactor') {
      return `<label class="form" style="gap:6px"><span class="field__label" style="margin:0">Value (${kind === 'normFactor' ? 'number' + (entry.unit ? ', ' + entry.unit : '') : 'number'})</span>
        <input class="input" id="wlNumber" type="number" step="${kind === 'normFactor' ? 'any' : '1'}" autocomplete="off" placeholder="…"></label>`;
    }
    if (kind === 'string') {
      return `<label class="form" style="gap:6px"><span class="field__label" style="margin:0">Value (text)</span>
        <input class="input" id="wlText" type="text" autocomplete="off" placeholder="e.g. en"></label>`;
    }
    if (kind === 'enum') {
      return `<label class="form" style="gap:6px"><span class="field__label" style="margin:0">Value (known enum)</span>
        <select class="select" id="wlEnum"><option value="">— choose a value —</option>${Object.entries(entry.enumTable || {}).filter(([k]) => k !== '-1').map(([k, v]) => `<option value="${esc(k)}">${esc(v.label || v.name)} (${esc(k)})</option>`).join('')}</select></label>`;
    }
    if (kind === 'unixTimestamp') {
      return `<label class="form" style="gap:6px"><span class="field__label" style="margin:0">Value (date and time)</span>
        <input class="input" id="wlTime" type="datetime-local"></label>`;
    }
    return '';
  }
  const PRESETS = [1.0, 2.4, 5.2, 6.0, 8.0, 12.0, 15.0, 18.0];

  function lightDraftFromState() {
    const l = summary().light;
    return {
      available: l.available === true,
      availableTouched: false,
      powerW: l.powerW,              // read-only display; may be null (unknown)
      config: l.config,              // no invented default; may be null/0
      configTouched: false,
      switchOn: false,               // explicit opt-in, initially off
      touched: false,
    };
  }

  function lightPlanResult() {
    const cur = summary().light;
    const dr = draft.light;
    const desired = {
      available: dr.available,
      availableTouched: dr.availableTouched,
      switchOn: dr.switchOn,
      config: dr.config,
      configTouched: dr.configTouched,
      powerW: dr.powerW,
      powerWTouched: dr.powerWTouched || (dr.powerW !== cur.powerW),
    };
    const result = POLICY.planLight(
      {
        available: cur.available === undefined ? null : cur.available,
        on: cur.on === undefined ? null : cur.on,
        config: cur.config === undefined ? null : cur.config,
        powerW: cur.powerW === undefined ? null : cur.powerW,
      },
      {
        available: desired.available,
        availableTouched: desired.availableTouched,
        switchOn: desired.switchOn,
        config: desired.config,
        configTouched: desired.configTouched,
        powerW: desired.powerW,
        powerWTouched: desired.powerWTouched,
      }
    );
    return result;
  }

  function runFor(op, value) {
    if (op === POLICY.OP.LIGHT_AVAILABLE.id) return (owner) => W.Writers.lightAvailable(value, owner);
    if (op === POLICY.OP.LIGHT_CONFIG.id) return (owner) => W.Writers.lightConfiguration(value, owner);
    if (op === POLICY.OP.LIGHT_SWITCH.id) return (owner) => W.Writers.lightSwitch(value, owner);
    if (op === POLICY.OP.LIGHT_POWER.id) return (owner) => W.Writers.lightPower(value, owner);
    throw new Error('Blocked operation: ' + op);
  }
  function lightSteps() {
    return lightPlanResult().steps.map((s) => ({ label: s.label, bytes: s.bytes, op: s.op, component: s.component, name: s.name, address: s.address, value: s.value, run: runFor(s.op, s.value) }));
  }

  function requireAuthorized() {
    if (W.canMutate) return true;
    const reason = (W.isLive || S.demo)
      ? 'Experimental writes are not enabled for this session. Open the Configure tab and enable them for this session.'
      : 'There is no live connection. Connect the eBike or start the demo before making changes.';
    modal({ title: 'Writes are disabled', body: `<p>${esc(reason)}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
    return false;
  }

  function serviceTarget() {
    const d = summary();
    const o = draft.service.option;
    const odoM = (d.odoKm || 0) * 1000;
    if (o === 'year') {
      const t = new Date(); t.setFullYear(t.getFullYear() + 1); t.setHours(12, 0, 0, 0);
      return { timestamp: Math.floor(t.getTime() / 1000), odometer: 0 };
    }
    if (o === 'km') return { timestamp: 0, odometer: Math.round(odoM + 1500 * 1000) };
    if (o === 'custom') {
      const ts = draft.service.date ? Math.floor(new Date(draft.service.date + 'T12:00:00').getTime() / 1000) : 0;
      const km = parseFloat(String(draft.service.km).replace(',', '.'));
      return { timestamp: ts, odometer: Number.isFinite(km) && km > 0 ? Math.round(odoM + km * 1000) : 0 };
    }
    return { timestamp: 0, odometer: 0 };
  }
  function serviceTargetText(t) {
    return serviceText({ set: !!(t.timestamp || t.odometer), timestamp: t.timestamp, odometer: t.odometer });
  }

  // The demo notice, with the demo-only failure simulation: it lets the user
  // see every result state (confirmed, declined, acknowledged but unchanged,
  // no answer) without a device.
  function demoNoticeHtml() {
    const demo = window.Bes3WorkshopDemo;
    const modes = demo && demo.modes ? demo.modes : ['ok'];
    const current = demo && demo.mode ? demo.mode() : 'ok';
    const labels = {
      ok: 'Writes succeed (the default)',
      decline: 'The bike declines every write',
      unchanged: 'The bike acknowledges but does not change the value',
      noresponse: 'The bike never answers a write',
    };
    return `<div class="notice">${ICON.info}<div><strong>Demo mode:</strong> All actions run against a simulated bike. Nothing is sent to a real eBike.</div></div>
      <div class="form" style="gap:6px"><label style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Simulated bike behaviour
        <select class="select" id="demoMode" style="max-width:320px">${modes.map((m) => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(labels[m] || m)}</option>`).join('')}</select></label>
        <span class="field__hint">Demo only. The setting applies to the next write.</span></div>`;
  }

  function renderWrite() {
    const el = $('view-write');
    const live = W.isLive;
    const canEdit = W.canMutate;
    const d = summary();
    if (!draft.light || !draft.light.touched) draft.light = lightDraftFromState();
    // The System ID write is only offered when the drive unit reports a
    // well-formed UUID; anything else would fail in the encoder.
    const duIdValid = !!d.duId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(d.duId);
    const dr = draft.light;
    const powerEditable = canEdit && d.light.powerW !== null;
    const planRes = lightPlanResult();
    const steps = planRes.steps;
    const demoNote = S.demo ? `<div class="section" style="display:grid;gap:12px">${demoNoticeHtml()}</div>` : '';

    const sv = d.service;
    const tgt = serviceTarget();
    const so = draft.service.option;
    const nextYear = (() => { const t = new Date(); t.setFullYear(t.getFullYear() + 1); return t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); })();

    const expOn = W.experimentalEnabled;
    const sessionOpen = live || S.demo;
    const authNotice = sessionOpen ? (expOn
      ? `<div class="notice notice--ok">${ICON.check}<div><strong>Experimental writes enabled for this session.</strong> Staged changes are shown for review before anything is sent; each write is re-read afterwards when the register can be read back. The authorization clears on disconnect, connection loss, or when a saved readout is opened.</div></div>`
      : `<div class="notice notice--warn" role="alert">${ICON.warn}<div><strong>Experimental writes are disabled.</strong> The Configure controls stay read-only until you enable them for this session. <button class="btn btn--primary btn--sm" data-act="expConsent">Enable experimental writes</button></div></div>`) : '';

    const filtered = writeLabFiltered();
    let advEntry = writeLabEntry();
    if (!advEntry && filtered.length) {
      advEntry = filtered[0];
      // The target changed: a payload or a typed name drafted for another
      // register must never follow it.
      draft.advanced.target = genericTargetKey(advEntry);
      draft.advanced.payload = '';
      }
    if (!advEntry) draft.advanced.target = '';
    const advUnreadable = !!advEntry && !entryReadable(advEntry);
    const advCur = advEntry ? S.values[genericTargetKey(advEntry)] : null;
    const advCurrent = advUnreadable ? 'write-only — cannot be read back'
      : advCur && advCur.status === 'ok' ? advCur.display : 'not read — read the bike first';
    const advReasons = writeLabReasons(advEntry);
    const activeComponents = writeLabActiveComponents();
    const compChips = writeLabComponentList().map(([c, label]) => `<button class="preset" data-wlcomp="${esc(c)}" aria-pressed="${activeComponents.has(c)}" style="${activeComponents.has(c) ? '' : 'opacity:.5'}">${esc(label)}</button>`).join('');
    const resultsHtml = writeLabResultsHtml(filtered, draft.advanced.target, draft.advanced.cursor);
    const friendly = writeLabFriendlyInput(advEntry);
    const writeLabCard = `<article class="card wcard wcard--full" aria-labelledby="advTitle">
      <header class="wcard__head">
        <span class="wcard__icon wcard__icon--primary">${ICON.wrench}</span>
        <div><h2 class="wcard__title" id="advTitle">Write Lab ${chip('Experimental · Untested', 'chip--warn')}</h2>
          <p class="wcard__sub">Stage one registry register at a time. Pick a component and a register, enter a value and press Write. The target always comes from the address registry, never from a typed address. Staged changes are applied as one visible batch; each write is re-read when the register is readable, never retried and never rolled back. A matching read-back is not proof that a change is safe or persistent.</p></div>
      </header>
      <div class="wcard__body">
        <div style="display:grid;gap:12px">
          <div>
            <div class="field__label" style="margin:0 0 6px">Components</div>
            <div class="presets" id="wlComponents">${compChips || '<span class="field__hint">No registry registers.</span>'}</div>
          </div>
          <label class="form" style="gap:6px"><span class="field__label" style="margin:0">Search a field by name</span>
            <input class="input" id="wlSearch" type="search" role="combobox" autocomplete="off" placeholder="Search a field by name…" value="${esc(draft.advanced.search)}" aria-controls="wlResults" aria-autocomplete="list" aria-expanded="true" aria-haspopup="listbox"${draft.advanced.cursor >= 0 ? ` aria-activedescendant="wlOpt${draft.advanced.cursor}"` : ''}></label>
          <div class="form" style="gap:6px">
            <div class="field__label" style="margin:0">Register</div>
            <div id="wlResults" role="listbox" aria-label="Matching registers" style="display:grid;gap:4px;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:var(--r);padding:4px">${resultsHtml}</div>
            <span class="field__hint">Use the arrow keys and Enter, or click a register. ${filtered.length} match${filtered.length === 1 ? '' : 'es'}.</span>
          </div>
          <div class="status-row" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
            <div class="status-cell" style="min-width:0"><div class="status-cell__k">Selected register</div><div class="status-cell__v mono" style="overflow-wrap:anywhere">${advEntry ? esc(advEntry.component + '.' + advEntry.name) : '–'}</div></div>
            <div class="status-cell" style="min-width:0"><div class="status-cell__k">Current value</div><div class="status-cell__v mono" style="overflow-wrap:anywhere">${esc(advCurrent)}</div></div>
            <div class="status-cell" style="min-width:0"><div class="status-cell__k">Registry kind</div><div class="status-cell__v mono">${esc(advEntry ? (advEntry.kind || 'unknown') : '–')}</div></div>
          </div>
          ${friendly}
          <details id="wlRawDetails" ${draft.advanced.rawOpen ? 'open' : ''}>
            <summary class="field__label" style="cursor:pointer;display:list-item">Raw payload (hex, max 64 bytes)</summary>
            <label class="form" style="gap:6px;margin-top:8px"><span class="field__label" style="margin:0">Raw payload</span>
              <input class="input mono" id="wlPayload" placeholder="e.g. 08 01" autocomplete="off" value="${esc(draft.advanced.payload)}" ${canEdit ? '' : 'disabled'}></label>
            <p class="field__hint">Choosing a value fills the raw payload; the raw payload is what is written and, when the register is readable, re-read.</p>
          </details>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn--primary btn--sm" id="wlWrite" data-act="advWrite" ${canEdit ? '' : 'disabled'}>Write register</button>
            <span class="field__hint" id="wlReasons">${advReasons.length ? 'Next: ' + esc(advReasons.join(' → ')) : 'All conditions met.'}</span>
          </div>
        </div>
      </div>
    </article>`;

    el.innerHTML = `${connBanner()}
      ${demoNote ? `<div class="section" style="display:grid;gap:12px">${demoNote}</div>` : ''}
      ${authNotice}
      ${pendingPanel()}
      <div class="section writer">
        <article class="card wcard" aria-labelledby="lightTitle">
          <header class="wcard__head">
            <span class="wcard__icon wcard__icon--beam">${ICON.light}</span>
            <div><h2 class="wcard__title" id="lightTitle">Bike light ${experimentalChip()}</h2>
              <p class="wcard__sub">Switch the light at runtime, mark the output installed, or set the startup mode. Each is a separate, explicit choice.</p></div>
          </header>
          <div class="wcard__body">
            <div class="status-row" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
              <div class="status-cell" style="min-width:0"><div class="status-cell__k">Light output</div><div class="status-cell__v">${d.light.available === null ? 'unknown' : d.light.available ? `<span style="color:var(--ok)">${ICON.check}</span>enabled` : 'disabled'}</div></div>
              <div class="status-cell" style="min-width:0"><div class="status-cell__k">Light</div><div class="status-cell__v">${d.light.on == null ? 'unknown' : d.light.on ? `<span style="color:var(--beam-ink)">${ICON.check}</span>on` : 'off'}</div></div>
              <div class="status-cell" style="min-width:0"><div class="status-cell__k">Light power</div><div class="status-cell__v mono" style="overflow-wrap:anywhere">${fmtW(d.light.powerW)}</div></div>
              <div class="status-cell" style="min-width:0"><div class="status-cell__k">Startup mode</div><div class="status-cell__v mono" style="overflow-wrap:anywhere">${esc(lightConfigLabel(d.light.config))}</div></div>
            </div>

            ${d.light.available === null ? `<div class="notice notice--warn">${ICON.warn}<div><strong>Light output state could not be read.</strong> Availability and startup-mode writes cannot be validated on this bike, so none will be offered.</div></div>` : ''}

            <div class="switch-row">
              <div style="flex:1 1 auto;min-width:0"><div class="switch-row__t">Enable light output</div><div class="switch-row__d">Off = mark the light as not installed and switch it off</div>${chipsRow(opChip('LIGHT_AVAILABLE'))}</div>
              <label class="switch" style="flex:0 0 auto"><input type="checkbox" id="lAvail" ${dr.available ? 'checked' : ''} ${canEdit ? '' : 'disabled'} aria-label="Enable light output"><span></span></label>
            </div>
            ${!dr.available && d.isSpeedPedelec ? `<div class="notice notice--warn">${ICON.warn}<div><strong>Speed pedelec detected (legal max. ${NF0.format(d.legal)} km/h).</strong> Lighting is legally required on S-pedelecs in most countries. Do not disable it for road use.</div></div>` : ''}

            <label class="check"><input type="checkbox" id="lSwitchOn" ${dr.switchOn ? 'checked' : ''} ${canEdit ? '' : 'disabled'}> Also switch the light on now (optional, function test)</label>
            ${chipsRow(opChip('LIGHT_SWITCH'))}

            <details ${dr.available ? 'open' : 'hidden'}>
              <summary class="field__label" style="cursor:pointer;display:list-item">Light power rating &amp; startup mode</summary>
              <div style="display:grid;gap:14px;margin-top:10px">
                <div>
                  <div class="field__label"><span>Light power rating (0x1822)</span><span class="muted" style="font-weight:500">1.0 – 18.0 W${d.light.powerW === null ? '' : ` · reported ${fmtW(d.light.powerW)}`}</span></div>
                  <div class="watt">
                    <input type="range" id="lPowerRange" min="1" max="18" step="0.1" value="${dr.powerW != null ? escNum(dr.powerW) : ''}" ${powerEditable ? '' : 'disabled'} aria-label="Power in watts">
                    <div class="watt__num"><input type="number" id="lPower" min="1" max="18" step="0.1" value="${dr.powerW != null ? escNum(Number(dr.powerW).toFixed(1)) : ''}" ${powerEditable ? '' : 'disabled'} aria-label="Power in watts"><span>W</span></div>
                  </div>
                  <div class="presets">${PRESETS.map((p) => `<button class="preset" data-preset="${p}" aria-pressed="${dr.powerW != null && Math.abs(p - dr.powerW) < 0.05}" ${powerEditable ? '' : 'disabled'}>${NF1.format(p)} W</button>`).join('')}</div>
                  <p class="field__hint">${d.light.powerW === null
                    ? 'The current light power could not be read on this bike, so a power write is not offered.'
                    : 'Known issue (observed not working): writing <span class="mono">0x1822</span> is reported not to change the active light power or lamp output on tested bikes, even when the write is acknowledged or read back. Nothing is retried or rolled back. Never set more than your lamps are rated for.'}</p>
                  ${chipsRow(opChip('LIGHT_POWER'))}
                </div>
                <label class="form" style="gap:6px"><span class="field__label" style="margin:0">Light startup mode (0x1821)</span>
                  <select class="select" id="lConfig" ${canEdit ? '' : 'disabled'}>
                    <option value="" ${dr.configTouched ? '' : 'selected'}>— choose a mode (leave unchanged) —</option>
                    ${[1, 2, 3].map((v) => `<option value="${v}" ${dr.configTouched && dr.config === v ? 'selected' : ''}>${v === 2 ? '2 – On power-up: remember last light state (documented)' : `${v} – Experimental / meaning not documented`}</option>`).join('')}
                  </select>
                  <span class="field__hint">Only mode <span class="mono">2</span> ("remember last light state on power-up") is confirmed; modes <span class="mono">1</span> and <span class="mono">3</span> are undocumented experimental values. A mode must be chosen explicitly before it can be written.</span>
                  ${chipsRow(opChip('LIGHT_CONFIG'))}
                </label>
              </div>
            </details>

            ${planRes.error ? `<div class="notice notice--bad">${ICON.warn}<div><strong>Cannot write:</strong> ${esc(planRes.error)}</div></div>` : ''}

            ${steps.length ? `<div class="diff" aria-label="Planned changes">
              <div class="diff__row diff__row--head"><span>Planned write</span><span>Register</span><span></span><span>Payload</span></div>
              ${steps.map((s) => `<div class="diff__row changed"><span>${esc(s.label)}</span><span class="from mono">0x${(s.address || 0).toString(16)}</span><span class="arrow">→</span><span class="to">${esc(s.bytes)}</span></div>`).join('')}
            </div>` : (planRes.error ? '' : `<div class="notice notice--ok">${ICON.check}<div>Nothing to write — the bike already matches your selection.</div></div>`)}
          </div>
          <footer class="wcard__foot">
            ${d.light.available ? `<button class="btn btn--ghost btn--sm" data-act="lightToggle" ${canEdit ? '' : 'disabled'}>Switch light ${d.light.on ? 'off' : 'on'}</button>${chipsRow(opChip('LIGHT_SWITCH'))}` : ''}
            <span class="spacer"></span>
            <button class="btn ${dr.available || !d.light.available ? 'btn--beam' : 'btn--danger'}" data-act="lightApply" ${canEdit && steps.length && !planRes.error ? '' : 'disabled'}>${dr.available ? (d.light.available ? 'Write changes' : 'Enable light') : d.light.available ? 'Disable light' : 'Nothing to write'}</button>
          </footer>
        </article>

        <article class="card wcard" aria-labelledby="svcTitle">
          <header class="wcard__head">
            <span class="wcard__icon wcard__icon--primary">${ICON.wrench}</span>
            <div><h2 class="wcard__title" id="svcTitle">Service interval ${experimentalChip()}</h2>
              <p class="wcard__sub">Set the next service reminder or clear the stored interval.</p>${chipsRow(opChip('SERVICE_DUE'))}</div>
          </header>
          <div class="wcard__body">
            <div class="status-row" style="grid-template-columns:1fr 1fr">
              <div class="status-cell"><div class="status-cell__k">Currently stored</div><div class="status-cell__v">${esc(serviceText(sv))}</div></div>
              <div class="status-cell"><div class="status-cell__k">Odometer</div><div class="status-cell__v mono">${fmtKm(d.odoKm)}</div></div>
            </div>
            <div class="options" role="radiogroup" aria-label="Service reminder">
              ${opt('year', 'In one year', `Reminder on ${nextYear}`, so)}
              ${opt('km', 'After another 1,500 km', `Reminder at ${NF0.format((d.odoKm || 0) + 1500)} km`, so)}
              <label class="opt"><input type="radio" name="svc" value="custom" ${so === 'custom' ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
                <div><div class="opt__t">Custom</div><div class="opt__d">Date and/or additional kilometres – whichever comes first</div></div>
                ${so === 'custom' ? `<div class="opt__extra"><label>Date<input class="input" type="date" id="svcDate" value="${esc(draft.service.date)}" min="${localISODate()}"></label>
                  <label>additional km<input class="input" type="number" id="svcKm" min="1" step="1" placeholder="e.g. 2000" value="${esc(draft.service.km)}"></label></div>` : ''}
              </label>
              ${opt('delete', 'Clear service interval', 'No service reminder will appear until a new interval is set', so, 'opt--danger')}
            </div>
            <p class="field__hint" id="svcPresetNote">Setting a date or a distance replaces the other stored value. Use the custom option to store both.</p>
            <div class="diff"><div class="diff__row diff__row--head"><span>Value</span><span>Current</span><span></span><span>New</span></div>
              ${diffRow('Reminder', serviceText(sv), serviceTargetText(tgt))}</div>
            <p class="field__hint">A reminder does not replace maintenance. One year and 1,500 km are presets only; follow your bike manufacturer's service schedule.</p>
          </div>
          <footer class="wcard__foot"><span class="spacer"></span>
            <span class="field__hint" id="svcReasons">${serviceReasons(tgt).length ? 'Next: ' + esc(serviceReasons(tgt).join(' → ')) : 'All conditions met.'}</span>
            <button class="btn ${so === 'delete' ? 'btn--danger' : 'btn--primary'}" data-act="svcApply" ${canEdit && serviceValid(tgt) ? '' : 'disabled'}>${so === 'delete' ? 'Clear interval' : 'Write interval'}</button>
          </footer>
        </article>
        <article class="card wcard wcard--full" aria-labelledby="idTitle">
          <header class="wcard__head">
            <span class="wcard__icon wcard__icon--primary">${ICON.shield}</span>
            <div><h2 class="wcard__title" id="idTitle">ID conflict &amp; System ID sync ${experimentalChip()}</h2>
              <p class="wcard__sub">ID comparison is read-only. Writing the control unit's System ID is experimental and has not been verified on real hardware.</p>
              <p class="wcard__sub">Compares the Bosch System ID (<span class="mono">BIKE_ID</span>) stored in the drive unit and the control unit – relevant after replacing a component (e.g. errors 112001 / 112002).</p></div>
          </header>
          <div class="wcard__body">
            <div class="status-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
              <div class="status-cell"><div class="status-cell__k">Drive unit (0x182c)</div><div class="status-cell__v mono" style="font-size:var(--text-xs);word-break:break-all">${esc(d.duId || 'not read')}</div></div>
              <div class="status-cell"><div class="status-cell__k">Control unit (0x2184)</div><div class="status-cell__v mono" style="font-size:var(--text-xs);word-break:break-all">${esc(d.rcId || 'not read')}</div></div>
              <div class="status-cell"><div class="status-cell__k">Status</div><div class="status-cell__v">${!d.duId || !d.rcId ? 'incomplete' : d.idConflict ? `<span style="color:var(--bad)">${ICON.warn}</span>conflict detected` : `<span style="color:var(--ok)">${ICON.check}</span>matching`}</div></div>
            </div>
            ${d.idConflict
              ? `<div class="notice notice--bad">${ICON.warn}<div><strong>System ID mismatch:</strong> the drive unit (<span class="mono">${esc(d.duId)}</span>) and the control unit (<span class="mono">${esc(d.rcId)}</span>) carry different System IDs. You can copy the drive unit's System ID into the control unit.</div></div>`
              : d.duId && d.rcId ? `<div class="notice notice--ok">${ICON.check}<div><strong>No ID conflict between drive unit and control unit:</strong> both report the same System ID. Matching IDs alone do not establish the cause of an error, and no rewrite is required merely because the values match.</div></div>`
              : `<div class="notice notice--warn">${ICON.warn}<div><strong>Comparison incomplete:</strong> at least one of the two System IDs could not be read on this bike / firmware version.</div></div>`}
            <div class="notice">${ICON.info}<div><strong>Technical background:</strong> none of the open-source references document a ready-made Bosch "resolve ID conflict" command. They do document the two <span class="mono">BIKE_ID</span> registers (<span class="mono">0x182c</span> in the drive unit, <span class="mono">0x2184</span> in the control unit) and the control unit's configuration backup (<span class="mono">0x219d–0x219f</span>). This tool writes the 16-byte UUID as protobuf (<span class="mono">0a 12 0a 10 …</span>) and re-reads it to verify whether the bike accepts the change over USB without a dealer certificate. Experimental — untested.</div></div>
          </div>
          <footer class="wcard__foot">
            <span class="field__hint" style="margin:0;flex:1 1 auto;min-width:0">Target: set control unit (<span class="mono">0x2184</span>) to the drive unit's ID</span>
            ${chipsRow(opChip('BIKE_ID'))}
            <span class="spacer"></span>
            <button class="btn ${d.idConflict ? 'btn--primary' : 'btn--ghost'} btn--sm" data-act="idSyncRc" ${canEdit && duIdValid ? '' : 'disabled'}>Experimental: write drive-unit ID to control unit</button>
          </footer>
        </article>
        ${writeLabCard}
      </div>`;
    bindWrite();
  }
  function serviceValid(t) {
    const o = draft.service.option;
    if (o === 'delete') return true;
    return !!(t.timestamp || t.odometer);
  }
  // The unmet reasons behind the Service interval button. The conditions are
  // exactly the ones serviceValid() uses; this only explains them, like the
  // Write Lab does next to its Write button. Clear is always offered when the
  // session may write; it reads the current reminder first.
  function serviceReasons(t) {
    const reasons = [];
    if (!W.canMutate) reasons.push('Experimental writes are not enabled for this session.');
    const o = draft.service.option;
    if (o === 'delete') {
      return reasons;
    }
    if (!t.timestamp && !t.odometer) {
      reasons.push(o === 'custom' ? 'Enter a valid date, an additional distance, or both.' : 'Choose a valid reminder option.');
    } else if (o === 'custom') {
      const kmText = String(draft.service.km == null ? '' : draft.service.km).trim();
      const km = parseFloat(kmText.replace(',', '.'));
      if (kmText && !(Number.isFinite(km) && km > 0)) reasons.push('The additional distance must be a positive number.');
      if (draft.service.date && Number.isNaN(new Date(draft.service.date + 'T12:00:00').getTime())) reasons.push('The date is not valid.');
    }
    return reasons;
  }
  function opt(v, t, d, cur, cls = '') {
    return `<label class="opt ${esc(cls)}"><input type="radio" name="svc" value="${esc(v)}" ${cur === v ? 'checked' : ''} ${W.canMutate ? '' : 'disabled'}><div><div class="opt__t">${esc(t)}</div><div class="opt__d">${esc(d)}</div></div></label>`;
  }
  function diffRow(k, from, to) {
    return `<div class="diff__row ${from !== to ? 'changed' : ''}"><span>${esc(k)}</span><span class="from">${esc(from)}</span><span class="arrow">→</span><span class="to">${esc(to)}</span></div>`;
  }

  function bindWrite() {
    const lamp = $('pendingLampConfirm');
    if (lamp) lamp.onchange = () => { pendingLampConfirmed = lamp.checked; renderWrite(); };
    document.querySelectorAll('[data-pending-remove]').forEach((b) => { b.onclick = () => removePending(b.dataset.pendingRemove); });
    document.querySelectorAll('[data-pending-edit]').forEach((b) => { b.onclick = () => editPending(b.dataset.pendingEdit); });
    const dr = draft.light;
    const avail = $('lAvail'); if (avail) avail.onchange = () => { dr.available = avail.checked; dr.availableTouched = true; dr.touched = true; renderWrite(); };
    const cfg = $('lConfig'); if (cfg) cfg.onchange = () => {
      if (cfg.value === '') { dr.configTouched = false; dr.config = summary().light.config; }
      else { dr.config = Number(cfg.value); dr.configTouched = true; }
      dr.touched = true; renderWrite();
    };
    const sw = $('lSwitchOn'); if (sw) sw.onchange = () => { dr.switchOn = sw.checked; dr.touched = true; renderWrite(); };
    const setPower = (w, rerender = true) => {
      w = Math.min(18, Math.max(1, Math.round(w * 10) / 10));
      dr.powerW = w; dr.powerWTouched = true; dr.touched = true;
      if (rerender) renderWrite();
    };
    const range = $('lPowerRange');
    if (range) {
      range.oninput = () => { $('lPower').value = parseFloat(range.value).toFixed(1); };
      range.onchange = () => setPower(parseFloat(range.value));
    }
    const num = $('lPower'); if (num) num.onchange = () => { const w = parseFloat(String(num.value).replace(',', '.')); if (Number.isFinite(w)) setPower(w); else renderWrite(); };
    document.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => setPower(parseFloat(b.dataset.preset)); });
    document.querySelectorAll('input[name="svc"]').forEach((r) => { r.onchange = () => { draft.service.option = r.value; renderWrite(); }; });
    const sd = $('svcDate'); if (sd) sd.onchange = () => { draft.service.date = sd.value; renderWrite(); };
    const sk = $('svcKm'); if (sk) sk.onchange = () => { draft.service.km = sk.value; renderWrite(); };
    // Write Lab: component chips, live search, register picker, friendly value
    // editors and the raw payload.
    const wlRawDetails = $('wlRawDetails');
    if (wlRawDetails) wlRawDetails.ontoggle = () => { draft.advanced.rawOpen = wlRawDetails.open; };
    const demoMode = $('demoMode');
    if (demoMode) demoMode.onchange = () => {
      if (window.Bes3WorkshopDemo) window.Bes3WorkshopDemo.setMode(demoMode.value);
      renderWrite();
    };
    document.querySelectorAll('[data-wlcomp]').forEach((b) => {
      b.onclick = () => {
        const c = b.dataset.wlcomp;
        const active = writeLabActiveComponents();
        // Single-select filter: clicking the only active component clears the
        // filter (null means all components), so no chip is a dead end.
        draft.advanced.components = (active.size === 1 && active.has(c)) ? null : [c];
        draft.advanced.target = '';
        draft.advanced.payload = '';
            draft.advanced.cursor = -1;
        renderWrite();
      };
    });
    const wlSearch = $('wlSearch');
    if (wlSearch) {
      wlSearch.oninput = () => {
        draft.advanced.search = wlSearch.value;
        draft.advanced.cursor = -1;
        refreshWriteLabResults();
      };
      wlSearch.onkeydown = (ev) => {
        const list = writeLabFiltered();
        if (!list.length) return;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const step = ev.key === 'ArrowDown' ? 1 : -1;
          let c = draft.advanced.cursor;
          c = c < 0 ? (step > 0 ? 0 : list.length - 1) : (c + step + list.length) % list.length;
          draft.advanced.cursor = c;
          refreshWriteLabResults();
          const box = $('wlResults');
          const item = box && box.children[c];
          if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          const e = list[draft.advanced.cursor >= 0 ? draft.advanced.cursor : 0];
          if (e) selectWriteLabEntry(genericTargetKey(e));
        } else if (ev.key === 'Escape') {
          draft.advanced.search = '';
          wlSearch.value = '';
          draft.advanced.cursor = -1;
          refreshWriteLabResults();
        }
      };
    }
    bindWriteLabResults();
    const wlRaw = $('wlPayload');
    const setRaw = (bytes) => {
      const hex = bytes && bytes.length ? W.util.toHex(bytes) : '';
      draft.advanced.payload = hex;
      if (wlRaw) wlRaw.value = hex;
      updateWriteLabAvailability();
    };
    if (wlRaw) wlRaw.oninput = () => { draft.advanced.payload = wlRaw.value; updateWriteLabAvailability(); };
    const wlBool = $('wlBool');
    if (wlBool) wlBool.onchange = () => setRaw(wlBool.checked ? [0x08, 0x01] : [0x08, 0x00]);
    const wlNumber = $('wlNumber');
    if (wlNumber) wlNumber.oninput = () => {
      if (wlNumber.value.trim() === '') return;
      const n = Number(wlNumber.value);
      if (!Number.isFinite(n)) return;
      const entry = writeLabEntry();
      const raw = entry && entry.kind === 'normFactor' ? Math.round(n * (entry.factor || 1)) : Math.round(n);
      setRaw(W.util.encodeEnumArg(raw));
    };
    const wlText = $('wlText');
    if (wlText) wlText.oninput = () => setRaw(W.util.encodeStringArg(wlText.value));
    const wlEnum = $('wlEnum');
    if (wlEnum) wlEnum.onchange = () => { if (wlEnum.value !== '') setRaw(W.util.encodeEnumArg(Number(wlEnum.value))); };
    const wlTime = $('wlTime');
    if (wlTime) wlTime.onchange = () => {
      const t = Date.parse(wlTime.value);
      if (Number.isFinite(t)) setRaw(W.util.encodeField1Varint(Math.floor(t / 1000)));
    };
    updateWriteLabAvailability();
  }

  // ------------------------------------------------------------ apply flows
  async function applyLight() {
    const planRes = lightPlanResult();
    if (planRes.error) {
      await modal({ title: 'Cannot write', body: `<p>${esc(planRes.error)}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    const steps = lightSteps();
    if (!steps.length) return;
    if (!requireAuthorized()) return;
    stageSteps('light', steps);
    draft.light = null;
    renderWrite();
  }

  // Guided Write Lab flow. The Write button calls this: it performs the normal
  // gates one step at a time (consent, read-first, payload validation) and
  // stages the change. The typed register-name gate is asked once at Apply.
  async function guidedAdvancedWrite() {
    if (!(W.isLive || S.demo)) {
      await modal({ title: 'Connect first', body: '<p>Connect the eBike or start the demo before writing a register.</p>', actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    if (!W.experimentalEnabled) {
      // The session consent is the one opt-in the Write Lab needs.
      if (!(await experimentalConfirm())) return;
      W.setExperimental(true);
      renderWrite();
    }
    const entry = writeLabEntry();
    if (!entry) {
      await modal({ title: 'Choose a register', body: '<p>Search for a register and select one from the result list first.</p>', actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    let cur = S.values[genericTargetKey(entry)];
    if (entryReadable(entry) && (!cur || cur.status !== 'ok')) {
      const read = await modal({
        title: 'Read the register first',
        body: `<p>The current value of <span class="mono">${esc(entry.component + '.' + entry.name)}</span> must be read before it can be written. This step only reads; it sends no write.</p>`,
        actions: [{ label: 'Cancel', value: false, cls: 'btn--ghost' }, { label: 'Read now', value: true, cls: 'btn--primary' }],
      });
      if (!read) return;
      const got = await W.readKey(entry.component, entry.name);
      if (!got) {
        await modal({ title: 'Read failed', body: '<p>The register could not be read. Nothing was written.</p>', actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
        return;
      }
      renderWrite();
      cur = S.values[genericTargetKey(entry)];
    }
    if (!POLICY.validateHexPayload(draft.advanced.payload).ok) {
      await modal({ title: 'Enter a valid value', body: '<p>Enter a raw hex payload, for example <span class="mono">08 01</span>, before writing.</p>', actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    await applyGenericWrite();
  }

  // Write Lab staging. The target must be a registry register the policy does
  // not block and its raw payload must be valid hex. Readable targets must
  // already have been read. The typed register name is attached at Apply, once
  // per batch, so the writer-boundary check still sees the exact target; the
  // raw re-read payload must match when the register is readable.
  async function applyGenericWrite() {
    try {
      if (!requireAuthorized()) return;
      const entry = writeLabEntry();
      const rawEl = $('wlPayload');
      if (rawEl) draft.advanced.payload = rawEl.value;
      const reasons = writeLabReasons(entry);
      if (!entry || reasons.length) {
        await modal({ title: 'Cannot stage', body: `<p>${esc(reasons.join(' · ') || 'Choose a writable register from the address registry.')}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
        return;
      }
      const key = genericTargetKey(entry);
      const cur = S.values[key];
      const v = POLICY.validateHexPayload(draft.advanced.payload);
      if (!v.ok) {
        await modal({ title: 'Enter a valid value', body: `<p>${esc(v.error || 'Enter a raw hex payload, for example 08 01.')}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
        return;
      }
      const unreadable = !entryReadable(entry);
      const curText = cur && cur.display ? cur.display : (unreadable ? 'not readable' : 'not read');
      const step = {
        label: `Write raw payload to ${entry.component}.${entry.name}`,
        bytes: v.hex,
        op: 'GENERIC_WRITE', component: entry.component, name: entry.name, address: entry.address,
        // The typed register name is attached at Apply, once per batch, so the
        // engine's writer-boundary check still sees the exact target.
        typedName: '', unreadable,
        intended: `raw ${v.hex}`, value: v.hex, currentDisplay: curText,
        run: (owner) => W.Writers.generic(entry.component, entry.name, v.bytes, owner),
      };
      stageSteps('lab', [step]);
    } finally {
        renderWrite();
    }
  }

  async function applyService() {
    if (!requireAuthorized()) return;
    const tgt = serviceTarget();
    const del = draft.service.option === 'delete';
    if (del) {
      // Clear needs the current value to be known before the clear is staged.
      // This is a read-only read; the staged clear still goes through the normal
      // Pending changes flow, approval and read-back.
      const cur = S.values['RemoteControl.SERVICE_DUE'];
      if (!cur || cur.status !== 'ok') {
        try { await W.readKey('RemoteControl', 'SERVICE_DUE'); } catch (_) { /* the normal write gates still apply */ }
      }
    }
    const bytes = W.util.toHex(W.util.encodeServiceDue(tgt)) || '(empty)';
    const step = {
      label: del ? 'Clear service interval' : `Set service interval: ${serviceTargetText(tgt)}`,
      bytes,
      op: 'SERVICE_DUE', component: 'RemoteControl', name: 'SERVICE_DUE',
      address: W.util.addrOf('RemoteControl', 'SERVICE_DUE'),
      intended: del ? 'cleared (no reminder)' : serviceTargetText(tgt), value: tgt,
      run: (owner) => W.Writers.serviceDue(tgt, owner),
    };
    stageSteps('service', [step]);
    renderWrite();
  }

  // The Mini Remote probe: reads only. It never writes and never asks for
  // approval, because it sends no mutation.
  async function runRemoteProbe() {
    if (!(W.isLive || S.demo)) {
      await modal({ title: 'Connect first', body: '<p>Connect the eBike or start the demo before probing the remote registers.</p>', actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    const count = W.remoteProbeCandidates ? W.remoteProbeCandidates().length : 0;
    const go = await modal({
      title: 'Probe remote registers',
      body: `<p>This sends <strong>read requests only</strong> for ${count} registry registers whose name or label mentions the remote, the BLE stack, buttons, pairing or the eShift. Every register is read once, nothing is written, and nothing is retried.</p>
        <p>The result may stay empty: the Mini Remote pairs over Bluetooth and does not have to appear in the wired registers.</p>`,
      actions: [{ label: 'Cancel', value: false, cls: 'btn--ghost' }, { label: 'Probe now', value: true, cls: 'btn--primary' }],
    });
    if (!go) return;
    try {
      const results = await W.probeRemoteRegisters();
      toast(`${results.length} registers read`);
    } catch (err) {
      await modal({ title: 'Probe failed', body: `<p>${esc((err && err.message) || String(err))}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
    }
    // The probe button lives in the Registry browser now. Show its results on
    // the Overview, where the probe table is rendered.
    if (tab !== 'read') setTab('read');
    else renderRead();
  }

  async function applyClearIssues() {
    if (!requireAuthorized()) return;
    if (W.sessionMode !== 'demo') {
      await modal({
        title: 'Live fault clearing unavailable',
        body: `<p>Clearing fault memory on a connected eBike is temporarily disabled: it batches several RPC mutations (delete-all plus per-entry deletes), which cannot be approved as individual writes. Reading the fault memory is unaffected.</p><p><strong>No data was sent.</strong></p>`,
        actions: [{ label: 'OK', value: true, cls: 'btn--primary' }],
      });
      return;
    }
    const token = W.authorizationToken;
    const d = summary();
    // The exact number of mutating RPC frames this action sends: one delete-all
    // plus one delete per stored entry, per component tier.
    const rpcCount = Math.max(1, d.issues.length + 1);
    const go = await modal({
      title: 'Clear fault memory (experimental)',
      body: `<p>This sends <span class="mono">DELETE_ALL_ISSUES (08 02)</span> and per-entry <span class="mono">DELETE_ISSUE (08 01 …)</span> RPC calls to <span class="mono">EXECUTE_INFORMATION_MANAGER_COMMAND</span> on components with stored errors, then re-reads the fault memory.</p>
        <div class="notice notice--warn">${ICON.warn}<div><strong>This is a batch of ${rpcCount} mutating RPC calls under one confirmation</strong> (one delete-all plus one delete per stored entry). Each call is sent once and never retried; the batch stops when the session changes. Live fault clearing stays disabled.</div></div>
        <div class="notice notice--warn">${ICON.warn}<div><strong>Experimental.</strong> On many firmware versions, clearing fault memory over USB without a dealer session is ignored or declined by the bike (the RPC returns empty/declined and the entries remain). Re-reading immediately verifies whether the entries were actually cleared.</div></div>`,
      actions: [{ label: 'Cancel', value: false, cls: 'btn--ghost' }, { label: `Send ${rpcCount} delete calls`, value: true, cls: 'btn--primary' }],
    });
    if (!go) return;
    const step = {
      label: `Clear ${d.issues.length} fault memory entr${d.issues.length === 1 ? 'y' : 'ies'}`,
      bytes: '08 02',
      op: 'CLEAR_ISSUES', component: 'Fault memory', name: 'EXECUTE_INFORMATION_MANAGER_COMMAND', address: null,
      intended: 'all stored entries removed',
      run: (owner) => W.clearFaultMemory(owner),
    };
    await runStepsModal('Clearing fault memory', [step], () => 'Fault memory cleared and verified by re-read.', token);
    renderRead();
  }

  async function applyIdSync() {
    if (!requireAuthorized()) return;
    const d = summary();
    if (!d.duId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(d.duId)) {
      await modal({ title: 'System ID cannot be written', body: '<p>The drive unit did not report a valid System ID, so there is nothing that could be written to the control unit.</p>', actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    const bytes = W.util.toHex(W.util.encodeUuidPayload(d.duId));
    const step = {
      label: `Write System ID to control unit (0x2184)`,
      bytes,
      op: 'BIKE_ID', component: 'RemoteControl', name: 'BIKE_ID',
      address: W.util.addrOf('RemoteControl', 'BIKE_ID'),
      intended: d.duId, value: d.duId,
      run: (owner) => W.Writers.syncBikeId('RemoteControl', d.duId, owner),
    };
    stageSteps('id', [step]);
    renderWrite();
  }

  async function lightToggle() {
    if (!requireAuthorized()) return;
    const on = !summary().light.on;
    const step = {
      label: on ? 'Switch light on' : 'Switch light off', bytes: on ? '08 01' : '(empty)',
      op: 'LIGHT_SWITCH', component: 'DriveUnit', name: 'BIKE_LIGHT',
      address: W.util.addrOf('DriveUnit', 'BIKE_LIGHT'), value: on,
      run: (owner) => W.Writers.lightSwitch(on, owner),
    };
    stageSteps('light-toggle', [step]);
    renderWrite();
  }

  // One typed gate per Apply batch. Every risky register gets its own input;
  // Continue is enabled only when all full names match. The same names are
  // copied to the steps so the engine's writer-boundary check still runs.
  function typedBatchPrompt(items) {
    return new Promise((resolve) => {
      const body = `<p>Type each full register name exactly to confirm this batch. The names are checked again at the writer boundary.</p>
        ${items.map((p, i) => `<label class="form" style="gap:6px"><span class="field__label mono">${esc(p.key)}</span>
          <input class="input mono" id="batchTyped${i}" autocomplete="off" spellcheck="false" placeholder="${esc(p.key)}"></label>`).join('')}`;
      modal({
        title: 'Confirm high-impact registers',
        body,
        actions: [
          { label: 'Cancel', value: false, cls: 'btn--ghost' },
          { label: 'Continue', value: true, cls: 'btn--primary', id: 'batchTypedGo', disabled: true },
        ],
        onOpen: () => {
          const inputs = items.map((_, i) => $('batchTyped' + i));
          const go = $('batchTypedGo');
          const upd = () => {
            go.disabled = !inputs.every((input, i) => input && input.value.trim() === items[i].key);
          };
          inputs.forEach((input) => { if (input) input.oninput = upd; });
          upd();
          if (inputs[0] && inputs[0].focus) inputs[0].focus();
        },
      }).then(resolve);
    });
  }

  async function applyPending() {
    if (!pending.length) return;
    if (!requireAuthorized()) return;
    // Revalidate the raw payloads immediately before the batch. The engine still
    // re-checks the policy and the grant at the writer boundary.
    for (const p of pending) {
      if (p.op !== 'GENERIC_WRITE') continue;
      const v = POLICY.validateHexPayload(p.step.value);
      if (!v.ok) {
        await modal({ title: 'Cannot apply', body: `<p>${esc(v.error || 'The staged payload is invalid.')}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
        return;
      }
      p.step.value = v.hex;
      p.step.bytes = v.hex;
      p.step.run = (owner) => W.Writers.generic(p.component, p.name, v.bytes, owner);
    }
    const risky = pending.filter((p) => p.risky);
    if (risky.length) {
      const confirmed = await typedBatchPrompt(risky);
      if (!confirmed) return;
      for (const p of risky) p.step.typedName = p.key;
    }
    if (pendingLightEnables() && !pendingLampConfirmed) {
      await modal({ title: 'Lamp safety not confirmed', body: `<p>Tick the lamp safety checkbox before applying a light change.</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
      return;
    }
    const token = W.authorizationToken;
    const steps = pending.map((p) => p.step);
    const results = await runStepsModal(`Applying ${steps.length} change${steps.length === 1 ? '' : 's'}`, steps, () => (
      S.demo ? 'The simulated bike matched every staged value.' : 'Every staged value was re-read from the eBike and matched.'
    ), token);
    if (Array.isArray(results)) {
      const applied = new Set();
      results.forEach((r, i) => { if (r && r.applied && steps[i]) applied.add(pendingKey(steps[i])); });
      for (let i = pending.length - 1; i >= 0; i--) if (applied.has(pending[i].key)) pending.splice(i, 1);
    }
    // A later retry of an unapplied row is a new batch and asks again.
    for (const p of pending) p.step.typedName = '';
    pendingLampConfirmed = false;
    renderWrite();
  }

  function approvalInfo(step) {
    const op = step.op ? POLICY.describeOp(step.op) : null;
    const component = step.component || (op ? op.component : '–');
    let addrNum = step.address != null ? step.address : (op ? op.address : null);
    // SERVICE_DUE and BIKE_ID have no fixed policy address (the policy uses
    // null for operations that are not a single register). Resolve the real
    // register from the address registry so the approval never shows "null".
    if (addrNum == null && op && op.component && op.name) {
      const regAddr = W.util.addrOf(op.component, op.name);
      if (regAddr != null) addrNum = regAddr;
    }
    const address = addrNum != null ? ('0x' + addrNum.toString(16)) : (op && op.name ? op.name : 'RPC');
    const light = summary().light;
    let current = '–';
    if (step.op === 'LIGHT_AVAILABLE') current = light.available === null ? 'unknown' : (light.available ? 'enabled' : 'disabled');
    else if (step.op === 'LIGHT_SWITCH') current = light.on == null ? 'unknown' : (light.on ? 'on' : 'off');
    else if (step.op === 'LIGHT_CONFIG') current = lightConfigLabel(light.config);
    else if (step.op === 'LIGHT_POWER') current = fmtW(light.powerW);
    else if (step.op === 'SERVICE_DUE') current = serviceText(summary().service);
    else if (step.op === 'BIKE_ID') current = summary().rcId || 'not read';
    else if (step.op === 'CLEAR_ISSUES') { const n = (summary().issues || []).length; current = `${n} stored entr${n === 1 ? 'y' : 'ies'}`; }
    else if (step.op === 'GENERIC_WRITE') {
      const cached = S.values[component + '.' + step.name];
      current = step.currentDisplay != null ? step.currentDisplay
        : (cached && cached.status === 'ok' ? cached.display : 'not read');
    }
    const intended = step.intended != null ? step.intended : intendedDisplay(step);
    let generic = null;
    if (step.op === 'GENERIC_WRITE') {
      const e = W.util.entryOf(component, step.name);
      generic = { kind: e ? (e.kind || 'unknown') : 'unknown', confirmed: e ? e.confirmed === true : false, tier: POLICY.genericTier(component, step.name).tier };
    }
    return { label: step.label, component, address, payload: step.bytes || '(empty)', current, intended, effect: effectDisplay(step), generic };
  }

  function intendedDisplay(step) {
    if (step.op === 'LIGHT_AVAILABLE') return step.value ? 'enabled' : 'disabled';
    if (step.op === 'LIGHT_SWITCH') return step.value ? 'on' : 'off';
    if (step.op === 'LIGHT_CONFIG') return lightConfigLabel(step.value);
    if (step.value != null) return String(step.value);
    return step.label;
  }

  function effectDisplay(step) {
    switch (step.op) {
      case 'LIGHT_AVAILABLE': return 'Marks the 12 V light output as installed or not installed in the drive unit.';
      case 'LIGHT_SWITCH': return 'Switches the bike light on or off immediately.';
      case 'LIGHT_CONFIG': return 'Sets the light behaviour at power-up.';
      case 'LIGHT_POWER': return 'Sets the 12 V light output power rating (experimental; 1.0–18.0 W).';
      case 'SERVICE_DUE': return 'Sets or clears the service reminder in the control unit.';
      case 'BIKE_ID': return 'Writes the drive unit System ID into the control unit.';
      case 'CLEAR_ISSUES': return 'Deletes stored fault-memory entries (simulation only).';
      case 'GENERIC_WRITE': return 'Writes a raw payload to the selected registry register.';
      default: return 'Applies the change described above.';
    }
  }

  async function runStepsModal(title, steps, successText, token) {
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    // The user already approved the visible batch in the pending panel. This
    // flag only lets a modal close stop the *remaining* steps; it never turns
    // the approval on. The engine still issues one grant per step.
    let batchApproved = true;
    modal({
      title,
      body: `<ol class="stepper" id="runSteps">${steps.map((s) => `<li data-s="idle"><span class="ic"></span><span>${esc(s.label)}</span><span class="res"></span></li>`).join('')}</ol>
        <div id="runResult"></div>`,
      actions: [
        { label: 'Cancel', value: false, cls: 'btn--ghost', id: 'runCancel' },
        { label: 'Please wait …', value: true, cls: 'btn--primary', id: 'runClose', disabled: true },
      ],
      onClose: () => { batchApproved = false; resolveDone(); },
    });
    const lis = () => Array.from(document.querySelectorAll('#runSteps li'));
    // One approval covers the visible batch. A demo run rehearses the same
    // engine gate as a live run.
    const options = { approve: () => Promise.resolve(batchApproved), requireApproval: true };
    if (token !== undefined) options.token = token;
    let results = [];
    let planError = null;
    try {
      results = await W.runPlan(steps, ({ index, phase, result }) => {
        const li = lis()[index]; if (!li) return;
        if (phase === 'start') li.dataset.s = 'run';
        else {
          li.dataset.s = result.applied ? 'ok' : 'fail';
          li.querySelector('.ic').innerHTML = result.applied ? ICON.check : ICON.x;
          li.querySelector('.res').textContent = result.applied ? `verified: ${result.after}`
            : result.declined ? 'declined — nothing sent'
              : result.sessionChanged ? 'blocked — session changed'
                : result.blocked ? 'blocked — not authorized'
                  : (result.error || `not applied (${result.statusName || 'no response'})`);
        }
      }, options);
    } catch (err) {
      // A plan can throw before it sends anything (for example when another
      // write plan still holds the lock). The modal must not stay on
      // "Please wait …" and the error has to be visible.
      planError = (err && err.message) ? err.message : String(err);
    }
    lis().forEach((li, i) => { if (i >= results.length) { li.dataset.s = 'skip'; li.querySelector('.res').textContent = 'skipped'; } });
    const allOk = !planError && results.length === steps.length && results.every((r) => r.applied);
    const failed = results.find((r) => !r.applied);
    const okHead = S.demo ? 'Confirmed in simulation.' : 'Confirmed by read-back.';
    const okTail = S.demo ? 'The simulated bike matched every requested value.' : 'Every value was re-read from the eBike and matched.';
    $('runResult').innerHTML = planError
      ? `<div class="notice notice--bad">${ICON.warn}<div><strong>Nothing was written.</strong> ${esc(planError)}</div></div>`
      : allOk
        ? `<div class="notice notice--ok">${ICON.check}<div><strong>${okHead}</strong> ${esc(successText() || okTail)}</div></div>`
        : `<div class="notice notice--bad">${ICON.warn}<div><strong>${failed && failed.declined ? 'Declined:' : failed && failed.sessionChanged ? 'Session changed:' : failed && failed.blocked ? 'Blocked:' : failed && failed.interrupted ? 'Unverified:' : 'Not confirmed:'}</strong> ${esc(failed ? failed.label : '')}. ${failed && failed.blocked ? esc(failed.error || 'Experimental writes are not enabled.') : failed && failed.interrupted ? esc(failed.reason || 'The session changed during the write, so the result is unverified.') : failed && failed.acked ? 'The eBike acknowledged the write, but re-reading did not confirm the value. Acknowledgment alone is not proof of application.' : 'The read-back did not confirm the value, so whether the eBike applied it is unknown.'} ${failed && failed.interrupted && failed.transmitted === false ? '' : 'No further steps were sent.'} See the session log for details.</div></div>`;
    const btn = $('runClose'); if (btn) { btn.disabled = false; btn.textContent = 'Done'; }
    const cancelBtn = $('runCancel'); if (cancelBtn) cancelBtn.remove();
    toast(allOk ? (S.demo ? 'Confirmed in simulation' : 'Confirmed by read-back') : (planError ? 'Nothing was written' : failed && failed.declined ? 'Write declined — nothing sent' : failed && failed.sessionChanged ? 'Blocked — session changed' : failed && failed.blocked ? 'Blocked — not authorized' : 'Change not confirmed'));
    await done;
    render();
    return results;
  }

  // ------------------------------------------------------------ REPORT
  const reportOpts = { ref: '', notes: '', anonymize: false };
  let reportUrl = null;
  function renderReport() {
    const el = $('view-report');
    el.innerHTML = `${connBanner()}<div class="section report">
      <div class="card">
        <h2 class="section__title">Diagnostic report</h2>
        <p class="section__sub" style="margin-bottom:20px">Multi-page A4 PDF: overview, ride statistics, components &amp; battery, configuration, assistance modes and software versions.</p>
        <div class="form">
          <label>Customer reference<input class="input" id="rRef" placeholder="e.g. name, job number or frame number" value="${esc(reportOpts.ref)}"></label>
          <label>Notes<textarea id="rNotes" placeholder="e.g. light enabled, 6.0 W">${esc(reportOpts.notes)}</textarea></label>
          <label class="check"><input type="checkbox" id="rAnon" ${reportOpts.anonymize ? 'checked' : ''}> Anonymize identifiers (serial numbers, IDs, key lock number)</label>
          ${photoLoadControl('report')}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <button class="btn btn--primary" data-act="pdfDownload">Download PDF</button>
            <button class="btn btn--ghost" data-act="pdfPreview">Refresh preview</button>
          </div>
        </div>
      </div>
      <div class="report__preview" id="pdfPreview"><div class="report__empty">Generating preview …</div></div>
    </div>`;
    $('rRef').oninput = (e) => { reportOpts.ref = e.target.value; };
    $('rNotes').oninput = (e) => { reportOpts.notes = e.target.value; };
    $('rAnon').onchange = (e) => { reportOpts.anonymize = e.target.checked; previewPdf(); };
    previewPdf();
  }
  function buildPdf() {
    return window.Bes3WorkshopReport.build(summary(), { ...reportOpts, helpers: { fmtDate, fmtDateTime, serviceText, lightConfigLabel, partImg, NF0, NF1, NF2 } });
  }
  function previewPdf() {
    const box = $('pdfPreview'); if (!box) return;
    try {
      const doc = buildPdf();
      if (reportUrl) URL.revokeObjectURL(reportUrl);
      reportUrl = URL.createObjectURL(doc.output('blob'));
      box.innerHTML = `<iframe title="Diagnostic report preview" src="${reportUrl}#view=FitH"></iframe>`;
    } catch (err) {
      console.error(err);
      box.innerHTML = `<div class="report__empty">Preview unavailable: ${esc(err.message)}</div>`;
    }
  }
  function downloadPdf() {
    try {
      const doc = buildPdf();
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      doc.save(`eBike-Diagnostic-Report-${stamp}.pdf`);
      toast('Diagnostic report saved');
    } catch (err) {
      console.error(err);
      toast(`Report could not be saved: ${err && err.message ? err.message : err}`);
    }
  }

  // ------------------------------------------------------------ LOG
  const yn = (v) => (v === 'true' ? 'on' : v === 'false' ? 'off' : v);
  // The export options of the log view. The default is the same as the PDF
  // report: nothing is anonymised until the user asks for it.
  const exportOpts = { anonymize: false };
  function renderLogRow(s) {
    return s.info
      ? `<tr><td class="mono">${esc(s.at.toLocaleTimeString('en-GB'))}</td><td>${esc(s.label)}</td><td></td><td></td><td>${chip('session start')}</td></tr>`
      : `<tr>
      <td class="mono">${esc(s.at.toLocaleTimeString('en-GB'))}</td><td>${esc(s.label)}</td><td><span class="bytes">${esc(s.sent)}</span></td>
      <td class="mono">${esc(yn(s.before))} → ${esc(yn(s.after))}</td>
      <td>${s.interrupted ? chip('unverified — interrupted', 'chip--bad') : s.blocked ? chip('blocked', 'chip--bad') : s.applied ? chip('verified', 'chip--ok') : chip(s.acked ? 'not confirmed' : 'rejected', 'chip--bad')}</td></tr>`;
  }
  function renderLogHistory() {
    if (!Array.isArray(S.logHistory) || !S.logHistory.length) return '';
    return `<div class="section"><div class="section__head"><div><h3 class="section__title">Previous sessions (${escNum(S.logHistory.length)})</h3><p class="section__sub">Preserved across reconnects so interrupted or unverified writes stay visible</p></div></div>`
      + S.logHistory.map((p) => {
        const rows = (p.entries || []).slice().reverse().map(renderLogRow).join('');
        return `<div class="card table-wrap" style="margin-bottom:12px"><table class="t"><thead><tr><th>Time</th><th>Action</th><th>Sent</th><th>Before → After</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }).join('') + `</div>`;
  }
  function renderRegistry() {
    const el = $('view-registry');
    if (!window.Bes3RegistryBrowser) {
      el.innerHTML = '<div class="section"><p class="section__sub">The read-only registry browser is not loaded.</p></div>';
      return;
    }
    el.innerHTML = window.Bes3RegistryBrowser.render();
    window.Bes3RegistryBrowser.mount(el);
  }

  function renderLog() {
    const el = $('view-log');
    const rows = S.log.slice().reverse().map(renderLogRow).join('');
    el.innerHTML = `${connBanner()}<div class="section">
      <div class="section__head"><div><h2 class="section__title">Session log</h2><p class="section__sub">Every change in this session, with payload sent and re-read result</p></div>
        <div class="log-actions"><button class="btn btn--ghost btn--sm" data-act="saveJson">Save readout (.json)</button><button class="btn btn--ghost btn--sm" data-act="debugLog">Download debug log</button>
        <label class="check"><input type="checkbox" id="exportAnon" ${exportOpts.anonymize ? 'checked' : ''}> Anonymise identifiers</label></div>
        <p class="field__hint" style="margin:6px 0 0">Full JSON contains serial numbers, the System ID, the key-lock number, raw register payload bytes, Mini Remote probe bytes/addresses and BLE peer-database records; the full debug log contains write payloads. "Anonymise identifiers" masks those identifiers, clears the raw bytes of identifier and BLE peer registers, reduces each probe row to component/name/status, and removes payload and read-back bytes from the log. The anonymised JSON can still be opened.</p>
      </div>
      <div class="card table-wrap">${rows ? `<table class="t"><thead><tr><th>Time</th><th>Action</th><th>Sent</th><th>Before → After</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted" style="padding:8px 4px">No changes in this session yet.</p>'}</div>
    </div>${renderLogHistory()}`;
    const anon = $('exportAnon');
    if (anon) anon.onchange = () => { exportOpts.anonymize = anon.checked; };
  }

  // ------------------------------------------------------------ modal & toast
  // One modal at a time in a single DOM slot. The bookkeeping lives in the
  // DOM-free stack (POLICY.createModalStack): when a second modal opens while
  // one is pending, the pending one is cancelled (resolved with false) instead
  // of being left pending forever.
  const modalStack = POLICY.createModalStack();
  // The element that had the focus before a modal opened: it gets the focus
  // back when the modal closes.
  let modalPreviousFocus = null;
  // Risk acceptance is kept in memory for this page load only. It is never
  // written to localStorage/sessionStorage and is intentionally not remembered
  // across reloads.
  let riskAccepted = false;
  function modal({ title, body, actions, onOpen, onClose }) {
    return new Promise((resolve) => {
      const state = { resolve, onClose, actions };
      modalStack.open(state);
      if (!modalPreviousFocus) modalPreviousFocus = document.activeElement;
      $('modalTitle').textContent = title;
      $('modalBody').innerHTML = body;
      $('modalActions').innerHTML = actions.map((a, i) => `<button class="btn ${a.cls || 'btn--ghost'}" data-i="${i}" ${a.id ? `id="${a.id}"` : ''} ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>`).join('');
      $('modal').hidden = false;
      const close = (v) => {
        if (!modalStack.close(state, v)) return;
        $('modal').hidden = true;
        // The focus goes back to the control that opened the dialog.
        const back = modalPreviousFocus;
        modalPreviousFocus = null;
        if (back && back.focus && document.contains(back)) back.focus();
      };
      // Escape uses the same local close as the action buttons, so it also
      // hides the dialog, restores focus and runs onClose (which stops any
      // remaining batch steps). Calling the stack directly would skip that.
      state.close = close;
      $('modalActions').querySelectorAll('button').forEach((b) => { b.onclick = () => close(actions[Number(b.dataset.i)].value); });
      onOpen && onOpen();
      const first = $('modalActions').querySelector('button:not([disabled])'); if (first) first.focus();
    });
  }
  // Tab stays inside the open dialog: the modal promises to be modal, so the
  // focus must not wander behind it.
  document.addEventListener('keydown', (e) => {
    const cur = modalStack.current();
    if (!cur) {
      // Escape discards staged changes when no dialog is open. The Write Lab
      // search field keeps its own Escape behavior (clear the search).
      if (e.key === 'Escape' && pending.length && !(document.activeElement && document.activeElement.id === 'wlSearch')) {
        e.preventDefault();
        discardPending();
      }
      return;
    }
    if (e.key === 'Escape') {
      const b = $('modalActions').querySelector('button:not([disabled])');
      // Escape closes a modal that offers a cancel action. Use the local close
      // so the dialog is hidden, focus is restored and onClose stops the
      // remaining batch steps.
      if (b && cur.actions[Number(b.dataset.i)].value === false && typeof cur.close === 'function') cur.close(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = Array.from($('modal').querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
  }

  // ------------------------------------------------------------ main render
  function render() {
    renderChrome();
    if (S.mode === 'reading') { if (!$('readingLabel')) renderReading(); return; }
    if (!hasData()) return;
    if (tab === 'read') renderRead();
    if (tab === 'write') renderWrite();
    if (tab === 'report') renderReport();
    if (tab === 'registry') renderRegistry();
    if (tab === 'log') renderLog();
  }

  W.on('change', render);
  W.on('progress', ({ done, total, label }) => {
    const pct = Math.min(100, (done / total) * 100);
    $('progressBar').style.width = `${pct}%`;
    $('progress').setAttribute('aria-valuenow', String(Math.round(pct)));
    const l = $('readingLabel'); if (l) l.textContent = label === 'complete' ? 'Complete' : `Reading ${label.replace(/_/g, ' ').toLowerCase()} …`;
  });
  W.on('disconnect', () => { onSessionChange(); toast('Disconnected from eBike'); });
  W.on('connectionlost', ({ reason }) => { onSessionChange(); toast(`Connection lost: ${reason}`); });
  // A renderer that throws must not freeze the view silently.
  W.on('error', (err) => {
    console.error(err);
    toast('The view could not be updated: ' + ((err && err.message) || 'unknown error'));
  });

  // A blocking risk-acceptance gate shown on every page load, before the rest of
  // the Workshop becomes usable. It is never remembered: the acceptance box
  // starts unticked on every load. There is no Cancel; Continue is the only
  // action and it stays disabled until the box is ticked. Acceptance lives in
  // memory for this page load only (see riskAccepted above).
  function riskWarning() {
    return modal({
      title: 'BES3 Workshop — use at your own risk',
      body: `<div class="notice notice--warn">${ICON.warn}<div><strong>Independent, unofficial tool.</strong> BES3 Workshop is not affiliated with, endorsed by, or supported by Bosch. It talks to your eBike using a protocol reverse-engineered from Bosch's own official software.</div></div>
        <p>Connecting reads data; some actions can <strong>write</strong> settings. A write can change your bike's configuration or leave it in an unexpected state, and it may void your warranty.</p>
        <ul>
          <li>Only use this on <strong>your own bike</strong>.</li>
          <li>Use is <strong>at your own risk</strong> and must be <strong>legal where you live</strong>.</li>
          <li>Writes are experimental, staged for review, applied as one visible batch, never retried, and never rolled back.</li>
        </ul>
        <label class="check" style="font-weight:600"><input type="checkbox" id="riskAccept"> I understand and accept these terms.</label>
        <p class="muted" style="font-size:var(--text-xs);margin-top:12px">${versionLabel()} · ${versionInfo().date}</p>`,
      actions: [
        { label: 'Continue', value: true, cls: 'btn--primary', id: 'riskContinue', disabled: true },
      ],
      onOpen: () => {
        const cb = $('riskAccept'); const go = $('riskContinue');
        if (cb && go) cb.onchange = () => { go.disabled = !cb.checked; };
      },
    });
  }

  // Resolves true once the user has accepted the warning during this page load.
  // Subsequent calls (for example Connect or Demo) resolve immediately; if the
  // warning was never accepted they show the same blocking modal again.
  function ensureRiskAccepted() {
    if (riskAccepted) return Promise.resolve(true);
    return riskWarning().then((ok) => { if (ok) riskAccepted = true; return ok; });
  }

  // A shorter notice shown before entering demo mode. Demo uses a simulated
  // eBike, so no USB device is opened and nothing is sent to real hardware.
  function demoNotice() {
    return modal({
      title: 'Demo mode',
      body: `<div class="notice">${ICON.info}<div><strong>Demo mode uses a simulated eBike.</strong> No USB device is opened and nothing is sent to real hardware — reads and writes run against synthetic data.</div></div>
        <p>This is an experimental protocol-research tool, not affiliated with Bosch. Use is at your own risk.</p>`,
      actions: [
        { label: 'Cancel', value: false, cls: 'btn--ghost' },
        { label: 'Start demo', value: true, cls: 'btn--primary' },
      ],
    });
  }

  // A second, distinct confirmation before enabling the experimental write
  // opt-in. Enabling it only allows the controls to stage writes; the visible
  // batch still needs Apply.
  function experimentalConfirm() {
    return modal({
      title: 'Enable experimental writes?',
      body: `<div class="notice notice--warn">${ICON.warn}<div><strong>Experimental.</strong> Enabling this lets the Configure controls request hardware-changing writes.</div></div>
        <ul>
          <li>Every staged change is shown with its <strong>register, old and new value, payload, tier and evidence</strong> before the batch is applied.</li>
          <li><strong>Nothing is retried</strong> automatically.</li>
          <li><strong>Nothing is rolled back</strong> if a change is unwanted.</li>
        </ul>
        <p>The authorization lasts only for this session and clears on disconnect, connection loss, or opening a saved readout.</p>`,
      actions: [
        { label: 'Cancel', value: false, cls: 'btn--ghost' },
        { label: 'Enable experimental writes', value: true, cls: 'btn--primary' },
      ],
    });
  }

  // The session consent is asked once per session: when the Configure tab is
  // opened and the session may not write yet. Cancelling keeps the Configure
  // controls read-only and the banner offers the same dialog again. The
  // authorization itself still clears on disconnect, connection loss, opening a
  // saved readout and a demo switch; the dialog is asked again afterwards.
  let consentAsked = false;
  async function askExperimentalConsent(force) {
    if (!(W.isLive || S.demo)) return false;
    if (W.experimentalEnabled) return true;
    if (consentAsked && !force) return false;
    consentAsked = true;
    const ok = await experimentalConfirm();
    if (ok) { W.setExperimental(true); renderWrite(); }
    return ok;
  }
  function maybeAskConsent() {
    if (!(W.isLive || S.demo)) return;
    if (W.experimentalEnabled) return;
    if (consentAsked) return;
    askExperimentalConsent(false).catch(() => {});
  }
  // A new session (disconnect, connection loss, demo switch, saved readout)
  // clears the draft and allows the consent dialog to appear again.
  function onSessionChange() {
    resetWriteLabDraft();
    clearPending();
    consentAsked = false;
  }

  async function doConnect(keepCurrentTab = false) {
    const accepted = await ensureRiskAccepted();
    if (!accepted) return;
    try { if (!keepCurrentTab && !hasData()) tab = 'read'; await W.connect(); toast('eBike connected and read'); }
    catch (err) {
      if (S.mode === 'connecting' || S.mode === 'reading') S.mode = Object.keys(S.values).length ? 'file' : 'idle';
      render();
      // The doctor only classifies the error and the state the UI already has;
      // it never opens a device or sends a frame.
      const body = window.Bes3ConnectionDoctor
        ? window.Bes3ConnectionDoctor.render(err, S)
        : `<p>${esc((err && err.message) || String(err))}</p><p>Tips: Is the eBike switched on? Are you using a USB <strong>data</strong> cable? Are other diagnostic tabs closed? On Windows a WinUSB driver may be required (see README).</p>`;
      await modal({ title: 'Connection failed', body, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
    }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-go],[data-act],[data-nav]');
    if (!t) return;
    try {
      if (t.dataset.tab) setTab(t.dataset.tab);
      else if (t.dataset.go) setTab(t.dataset.go);
      else if (t.dataset.nav === 'start') { e.preventDefault(); if (hasData()) setTab('read'); }
      else if (t.dataset.act) {
        const a = t.dataset.act;
        if (a === 'lightApply') await applyLight();
        else if (a === 'svcApply') await applyService();
        else if (a === 'lightToggle') await lightToggle();
        else if (a === 'pendingApply') await applyPending();
        else if (a === 'pendingDiscard') discardPending();
        else if (a === 'pdfDownload') downloadPdf();
        else if (a === 'pdfPreview') previewPdf();
        else if (a === 'loadPhotos') {
          const P = window.Bes3PartImages;
          if (P && typeof P.preloadPdfImages === 'function') {
            photoStatus = 'loading';
            P.setRemoteOptIn(true);
            render();
            try {
              const res = await P.preloadPdfImages(summary().comps);
              photoStatus = res && res.loaded > 0 ? 'loaded' : 'failed';
            } catch (_) {
              photoStatus = 'failed';
            }
            render();
          }
        }
        else if (a === 'connect') await doConnect(false);
        else if (a === 'reconnect') await doConnect(true);
        else if (a === 'idSyncRc') await applyIdSync();
        else if (a === 'clearIssues') await applyClearIssues();
        else if (a === 'advWrite') await guidedAdvancedWrite();
        else if (a === 'probeRemote') await runRemoteProbe();
        else if (a === 'probeEmpty') toggleProbeEmpty(t);
        else if (a === 'expConsent') await askExperimentalConsent(true);
        else if (a === 'debugLog' && window.Bes3DebugLog) window.Bes3DebugLog.download({ anonymize: exportOpts.anonymize });
        else if (a === 'dismissUnverified') { S.lastUnverifiedWrite = null; render(); }
        else if (a === 'catalogLoad') $('catalogInput').click();
        else if (a === 'catalogClear') { window.Bes3Issues.clearUserCatalog(); render(); toast('Custom error catalog removed'); }
        else if (a === 'saveJson') {
          const blob = new Blob([JSON.stringify(W.exportState({ anonymize: exportOpts.anonymize }), null, 2)], { type: 'application/json' });
          const u = URL.createObjectURL(blob); const link = document.createElement('a');
          link.href = u; link.download = `bes3-workshop-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
        }
      }
    } catch (err) {
      // A failed action must never leave an unhandled rejection behind: the
      // user gets a modal with the reason instead of a click that does nothing.
      console.error(err);
      await modal({ title: 'Action failed', body: `<p>${esc((err && err.message) || String(err))}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
    }
  });
  $('btnConnect').onclick = () => doConnect(false);
  const trBtn = $('btnTopReconnect'); if (trBtn) trBtn.onclick = () => doConnect(true);
  $('btnDemo').onclick = async () => { if (!(await ensureRiskAccepted())) return; if (!(await demoNotice())) return; onSessionChange(); tab = 'read'; await W.startDemo(); toast('Demo eBike read'); };
  $('btnReread').onclick = async () => {
    if (S.mode === 'reading' || S.mode === 'connecting' || W.busy) return;
    try {
      draft.light = null;
      clearPending();
      await W.readAll();
      toast('Re-read complete');
    } catch (err) {
      console.error(err);
      await modal({ title: 'Re-read failed', body: `<p>${esc((err && err.message) || String(err))}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] });
    }
  };
  $('btnDisconnect').onclick = async () => {
    if (W.isLive) { await W.disconnect(); toast('Disconnected – data stays visible'); }
    else { onSessionChange(); await W.closeReadout(); render(); }
  };
  $('btnOpenFile').onclick = () => $('fileInput').click();
  $('fileInput').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      // A readout file is untrusted input: cap the size before it is read.
      if (f.size > 8 * 1024 * 1024) throw new Error('The file is larger than 8 MB and is not a BES3 Workshop readout.');
      const json = JSON.parse(await f.text());
      if (!W.importWorkshop(json)) W.importReaderReport(json);
      onSessionChange();
      tab = 'read'; render(); toast('Readout opened');
    } catch (err) { modal({ title: 'Cannot read file', body: `<p>${esc(err.message)}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] }); }
    e.target.value = '';
  };
  $('catalogInput').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const n = window.Bes3Issues.setUserCatalog(f.name, JSON.parse(await f.text()));
      render(); toast(`Error catalog loaded: ${NF0.format(n)} codes`);
    } catch (err) { modal({ title: 'Cannot read catalog', body: `<p>${esc(err.message)}</p>`, actions: [{ label: 'OK', value: true, cls: 'btn--primary' }] }); }
    e.target.value = '';
  };
  $('btnTheme').onclick = () => {
    const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { localStorage.setItem('bes3-workshop-theme', n); } catch (_) { /* ignore */ }
  };
  if (!navigator.usb) { $('usbWarn').hidden = false; $('btnConnect').disabled = true; }
  window.addEventListener('beforeunload', (e) => { if (W.isLive && !S.demo) { e.preventDefault(); e.returnValue = ''; } });

  window.Bes3WorkshopUI = { summary, render, setTab };
  // Load the private-tree embedded PDF images lazily. index.html must not name
  // that file because the public tree excludes it; a missing file is ignored
  // and the report uses the vector fallback.
  if (window.Bes3PartImages && typeof window.Bes3PartImages.loadEmbeddedPdfImages === 'function') {
    window.Bes3PartImages.loadEmbeddedPdfImages()
      .then((ok) => { if (ok) render(); })
      .catch(() => {});
  }
  injectVersionLabels();
  // The risk warning is shown before the rest of the UI is enabled. Continue is
  // the only action, so this promise stays pending (and the modal stays up)
  // until the user accepts.
  (async () => {
    if (!(await ensureRiskAccepted())) return;
    render();
  })();
})();
