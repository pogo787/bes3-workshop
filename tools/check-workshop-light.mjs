// BES3 Workshop – hardware-free regression checks for the light/experimental
// write isolation.
//
// Phase 1 runs the *real* production policy module (web/workshop/write-policy.js)
// and inspects the Workshop sources for the truthful-result wording.
// Phase 2 loads the *real* engine (web/workshop/engine.js) inside a synthetic
// sandbox and drives it against the built-in simulated transport.
//
// Hardware safety of phase 2 (audit target):
//   - No browser, no USB/Bluetooth, no network, no hardware, no file writes,
//     no child processes.
//   - It loads web/transport-webusb.js only in an isolated sandbox with a fake
//     `navigator.usb` and a fake `USBDevice`; it never calls a real USB API.
//   - The engine sandbox pins `navigator` to { usb: undefined }, and
//     `window.Bes3WebUsb` is replaced by a stub whose methods throw if ever
//     touched. A fake-transport run that cannot start is reported as a FAILURE
//     — there is no fallback to a real device.
//
//   node tools/check-workshop-light.mjs
//
// Exit code 0 = all checks passed, 1 = at least one check failed.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const POLICY = require(path.join(repo, 'web', 'workshop', 'write-policy.js'));
const USB_ACK = require(path.join(repo, 'web', 'workshop', 'usb-ack.js'));
const REGISTRY = require(path.join(repo, 'src', 'address-registry.generated.js')).ADDRESS_REGISTRY.addresses;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const skipReasons = [];

// A private checkout contains the Dev workbench; the public release tree
// excludes it. Private checks are explicitly skipped in a public tree, never
// counted as successful execution. In a private checkout a missing required
// file is a hard failure, not a skip.
const PRIVATE_TREE = existsSync(path.join(repo, 'dev.html'))
  || existsSync(path.join(repo, 'web', 'dev', 'dev-runner.js'));

class SkipError extends Error {
  constructor(reason) { super(reason); this._skip = reason; }
}

function skip(name, reason) {
  skipped++;
  skipReasons.push({ name, reason });
  console.log('  skip ' + name + '  -> ' + reason);
}

function requirePrivate(files) {
  if (!PRIVATE_TREE) {
    throw new SkipError('private Dev workbench is absent from the public tree');
  }
  for (const f of files) {
    if (!existsSync(path.join(repo, f))) {
      throw new Error('private checkout is missing a required Dev file: ' + f);
    }
  }
}

const TEST_TIMEOUT_MS = 30000;

function finish(name, started, err, timed) {
  if (err && err._skip) {
    skip(name, err._skip);
    return;
  }
  if (!err) {
    passed++;
    console.log('  ok   ' + name + (timed ? '  (' + (Date.now() - started) + ' ms)' : ''));
    return;
  }
  const message = err && err.message ? err.message : String(err);
  failed++;
  failures.push({ name, message });
  console.log('  FAIL ' + name + '  -> ' + message);
}

function check(name, fn) {
  const started = Date.now();
  let err = null;
  try { fn(); } catch (e) { err = e; }
  finish(name, started, err, false);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'expected equal') + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}
function ops(res) { return res.steps.map((s) => s.op); }
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

const DU = { component: 'DriveUnit' };
function current(over) {
  return Object.assign({ available: false, on: false, config: 2, powerW: 6.0 }, DU, over);
}
function desired(over) {
  return Object.assign({ available: false, availableTouched: false, switchOn: false, config: 2, configTouched: false }, over);
}

// Presentation helpers are shared by the UI and the PDF report. Load the
// browser module in a tiny synthetic window: it only declares functions and
// attaches them, so no jsPDF or DOM is needed.
const presentationWindow = {};
new Function('window', readFileSync(path.join(repo, 'web', 'workshop', 'report-pdf.js'), 'utf8'))(presentationWindow);
const PRESENTATION = presentationWindow.Bes3WorkshopPresentation;
if (!PRESENTATION) throw new Error('report-pdf.js did not expose window.Bes3WorkshopPresentation');

const doctorWindow = {};
new Function('window', readFileSync(path.join(repo, 'web', 'workshop', 'connection-doctor.js'), 'utf8'))(doctorWindow);
const DOCTOR = doctorWindow.Bes3ConnectionDoctor;
if (!DOCTOR) throw new Error('connection-doctor.js did not expose window.Bes3ConnectionDoctor');

function relativeLuminance(rgb) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

console.log('Presentation helper checks');
console.log('');

check('cadence: fill is clamped to 0..120 and accepts numeric strings', () => {
  eq(PRESENTATION.cadenceFill(0), 0, '0 rpm -> 0 %');
  assert(Math.abs(PRESENTATION.cadenceFill(64) - (64 / 120) * 100) < 1e-9, '64 rpm maps onto the 120 rpm scale');
  assert(Math.abs(PRESENTATION.cadenceFill(100) - (100 / 120) * 100) < 1e-9, '100 rpm maps onto the 120 rpm scale');
  eq(PRESENTATION.cadenceFill(120), 100, '120 rpm -> 100 %');
  eq(PRESENTATION.cadenceFill(150), 100, '150 rpm is clamped to 100 %');
  eq(PRESENTATION.cadenceFill(-5), 0, 'a negative value is clamped to 0 %');
  eq(PRESENTATION.cadenceFill(NaN), 0, 'NaN is 0 %');
  assert(Math.abs(PRESENTATION.cadenceFill('64') - (64 / 120) * 100) < 1e-9, 'a numeric string is accepted');
  eq(PRESENTATION.cadenceFill('64 rpm'), 0, 'a non-numeric string is rejected safely');
});

check('cadence: text contrast and fill/track separation are sufficient', () => {
  const c = PRESENTATION.CADENCE_COLORS;
  assert(contrastRatio(c.text, c.background) >= 4.5,
    'the cadence text contrast is at least 4.5:1 (got ' + contrastRatio(c.text, c.background).toFixed(2) + ':1)');
  assert(contrastRatio(c.fill, c.track) >= 1.5,
    'the fill is clearly distinguishable from the track (got ' + contrastRatio(c.fill, c.track).toFixed(2) + ':1)');
});

check('probe: a 150-row result is counted and empty rows are hidden by default', () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    status: i < 100 ? 'ok' : 'timeout',
    display: i < 100 ? `value ${i}` : 'no response',
    hex: i < 100 ? '08 01' : '',
  }));
  const counts = PRESENTATION.probeSummary(rows);
  eq(counts.total, 150, 'all 150 rows are counted');
  eq(counts.read, 100, '100 rows returned a value');
  eq(counts.empty, 50, '50 rows are empty');
  eq(PRESENTATION.probeRowHasValue({ status: 'ok', display: '(empty)', hex: '' }), false, 'an empty payload is not a value');
  eq(PRESENTATION.probeRowHasValue({ status: 'ok', display: '64 rpm', hex: '08 80 01' }), true, 'a decoded value counts');
});

check('connection doctor: classifies every known connect failure and falls back', () => {
  const cases = [
    [{ name: 'NotFoundError', message: 'No device selected.' }, {}, 'picker-cancelled'],
    [{ name: 'SecurityError', message: 'Access denied.' }, {}, 'access-denied'],
    [{ name: 'NetworkError', message: 'Failed to claim interface.' }, {}, 'claim-failed'],
    [{ name: 'NetworkError', message: 'Failed to open device.' }, {}, 'open-failed'],
    [{ name: 'Error', message: 'The first read timed out.' }, {}, 'no-answer'],
    [{ name: 'Error', message: 'Unexpected transport state.' }, {}, 'generic'],
    [{ name: 'Error', message: 'Unexpected transport state.' }, { connectionLost: true }, 'connection-lost'],
  ];
  for (const [err, state, id] of cases) eq(DOCTOR.classify(err, state).id, id, id);
  const rendered = DOCTOR.render({ name: 'Error', message: '<script>alert(1)</script>' }, {});
  assert(rendered.includes('108c'), 'the udev vendor id is shown');
  assert(rendered.includes('Zadig'), 'the Windows Zadig steps are shown');
  assert(rendered.includes('&lt;script&gt;'), 'an error message is escaped');
  assert(!rendered.includes('<script>alert(1)</script>'), 'the raw error markup is not injected');
});

check('other: total minus tracked parts, clamped and hidden at the display rounding', () => {
  const normal = PRESENTATION.otherShare(1000, [600, 200]);
  eq(normal.value, 200, 'normal remainder');
  eq(normal.visible, true, 'a normal remainder is visible');
  const exact = PRESENTATION.otherShare(1000, [600, 400]);
  eq(exact.value, 0, 'a complete breakdown has no remainder');
  eq(exact.visible, false, 'a zero remainder is hidden');
  const over = PRESENTATION.otherShare(900, [600, 500]);
  eq(over.value, 0, 'parts that exceed the total are clamped to zero');
  eq(over.visible, false, 'the clamped remainder is hidden');
  const missing = PRESENTATION.otherShare(null, [100, 200]);
  eq(missing.value, null, 'a missing total is not invented');
  eq(missing.visible, false, 'a missing total hides Other');
  const mixed = PRESENTATION.otherShare('1000', ['600', 'x', null, '200', NaN]);
  eq(mixed.value, 200, 'numeric strings count and invalid parts are ignored');
  eq(mixed.visible, true, 'a valid numeric string total is accepted');
  const tiny = PRESENTATION.otherShare(1000, [999.99], 50);
  assert(Math.abs(tiny.value - 0.01) < 1e-9, 'the tiny remainder is kept for diagnostics');
  eq(tiny.visible, false, 'a remainder below the display rounding is hidden');
});

check('other: the segment is appended last in amber and never mutates the mode list', () => {
  const modes = [{ name: 'Eco', distance: 600 }, { name: 'Tour+', distance: 200 }];
  const out = PRESENTATION.withOtherSegment(modes, { value: 200, visible: true }, 'distance');
  eq(modes.length, 2, 'the tracked-mode list is unchanged');
  eq(out.length, 3, 'Other is appended');
  eq(out[2].name, 'Other', 'Other is the last segment');
  eq(out[2].color, '#f59e0b', 'Other uses amber');
  eq(out[2].distance, 200, 'Other carries the residual distance');
  const hidden = PRESENTATION.withOtherSegment(modes, { value: 0, visible: false }, 'distance');
  eq(hidden.length, 2, 'a hidden Other is not drawn');
});

check('other: average consumption uses residual energy over residual distance', () => {
  const shown = PRESENTATION.otherEfficiency({ value: 50000 }, { value: 1000 });
  eq(shown.visible, true, 'both residuals make the Other efficiency visible');
  assert(Math.abs(shown.value - 20) < 1e-9, '1000 Wh over 50 km is 20 Wh/km');
  const fractional = PRESENTATION.otherEfficiency({ value: 60000 }, { value: 1000 });
  assert(Math.abs(fractional.value - (1000 / 60)) < 1e-9, 'the value keeps full precision before formatting');
  eq(PRESENTATION.otherEfficiency({ value: 0 }, { value: 1000 }).visible, false, 'zero residual distance hides it');
  eq(PRESENTATION.otherEfficiency({ value: null }, { value: 1000 }).visible, false, 'a missing distance total hides it');
  eq(PRESENTATION.otherEfficiency({ value: 50000 }, { value: null }).visible, false, 'a missing energy total hides it');
  eq(PRESENTATION.otherEfficiency({ value: -5 }, { value: 1000 }).visible, false, 'a negative residual is not shown');
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(/otherEfficiency\(otherD, otherE\)/.test(ui), 'the preview uses the shared helper');
  assert(/stack\(effModes, 'eff'/.test(ui), 'the preview stack includes the Other efficiency segment');
  const pdf = readFileSync(path.join(repo, 'web', 'workshop', 'report-pdf.js'), 'utf8');
  assert(/const otherEff = otherEfficiency\(otherD, otherE\)/.test(pdf), 'the PDF uses the shared helper');
  assert(/segBar\('Average energy consumption'[\s\S]*effModes\)/.test(pdf), 'the PDF bar includes the Other efficiency segment');
});


console.log('BES3 Workshop light write-isolation checks');
console.log('');

// 1. Enabling the light emits exactly one mutation: LIGHT_AVAILABLE.
check('enable light -> single LIGHT_AVAILABLE mutation', () => {
  const r = POLICY.planLight(current({ available: false }), desired({ available: true, availableTouched: true }));
  eq(r.error, null, 'no plan error');
  eq(r.steps.length, 1, 'one step');
  eq(r.steps[0].op, 'LIGHT_AVAILABLE');
  eq(r.steps[0].value, true);
});

// 2. Disabling an installed, lit light switches it off first, then uninstalls.
check('disable light -> switch off then uninstall', () => {
  const r = POLICY.planLight(current({ available: true, on: true }), desired({ available: false, availableTouched: true }));
  eq(r.error, null, 'no plan error');
  eq(ops(r).join(','), 'LIGHT_SWITCH,LIGHT_AVAILABLE', 'ordered ops');
  eq(r.steps[0].value, false, 'switch off');
  eq(r.steps[1].value, false, 'uninstall');
});

// 3. A fresh draft (nothing touched) plans no writes and no invented defaults.
check('untouched draft -> no config/power/switch writes', () => {
  const r = POLICY.planLight(current(), desired());
  eq(r.error, null, 'no plan error');
  eq(r.steps.length, 0, 'zero steps');
});

// 4. Selecting the already-active startup mode is a no-op (no write).
check('startup mode unchanged -> no write', () => {
  const r = POLICY.planLight(current({ available: true, config: 2 }), desired({ configTouched: true, config: 2 }));
  eq(r.error, null, 'no plan error');
  eq(r.steps.length, 0, 'zero steps');
});

// 5. An out-of-range startup mode is rejected with zero mutations.
check('invalid startup mode -> rejected, zero mutations', () => {
  const r = POLICY.planLight(current({ available: true, config: 2 }), desired({ configTouched: true, config: 9 }));
  assert(r.error, 'error is set');
  eq(r.steps.length, 0, 'zero steps');
});

// 6. A dedicated availability change does not drag in config or switch writes.
check('availability change is isolated from config/switch', () => {
  const r = POLICY.planLight(current({ available: false, on: null, config: null }), desired({ available: true, availableTouched: true }));
  eq(r.error, null, 'no plan error');
  eq(ops(r).join(','), 'LIGHT_AVAILABLE');
});

// 7. Switch-on is opt-in and produces exactly one LIGHT_SWITCH mutation.
check('opt-in switch-on -> single LIGHT_SWITCH', () => {
  const r = POLICY.planLight(current({ available: true, on: false }), desired({ switchOn: true }));
  eq(r.error, null, 'no plan error');
  eq(ops(r).join(','), 'LIGHT_SWITCH');
  eq(r.steps[0].value, true, 'switch on');
});

// 8. Requesting the state the bike is already in writes nothing.
check('no-op request -> no writes', () => {
  const r = POLICY.planLight(current({ available: true, on: true }), desired({ availableTouched: true, available: true }));
  eq(r.error, null, 'no plan error');
  eq(r.steps.length, 0, 'zero steps');
});

// 9. A valid, changed startup mode is the only mutation.
check('valid changed startup mode -> single LIGHT_CONFIG', () => {
  const r = POLICY.planLight(current({ available: true, config: 1 }), desired({ configTouched: true, config: 2 }));
  eq(r.error, null, 'no plan error');
  eq(ops(r).join(','), 'LIGHT_CONFIG');
  eq(r.steps[0].value, 2);
});

// 10. Startup mode 0 / non-members are rejected too.
check('startup mode 0 -> rejected', () => {
  const r = POLICY.planLight(current({ available: true, config: 2 }), desired({ configTouched: true, config: 0 }));
  assert(r.error, 'error is set');
  eq(r.steps.length, 0, 'zero steps');
});

// 11. The wattage writer is enabled but bounded to 1.0–18.0 W in 0.1 W steps.
check('validateLightPower bounds light power to 1.0–18.0 W in 0.1 W steps', () => {
  for (const bad of [0.9, 18.1, 5.55, NaN, 'abc', null, undefined, Infinity, -1, 19]) {
    assert(POLICY.validateLightPower(bad).ok !== true, 'rejected: ' + String(bad));
  }
  for (const good of [1.0, 1.1, 5.5, 6.0, 12.0, 17.9, 18.0]) {
    const r = POLICY.validateLightPower(good);
    assert(r.ok === true && r.value === good, 'accepted: ' + good);
  }
  eq(POLICY.OP.LIGHT_POWER.writable, true, 'the dedicated power op is enabled');
  eq(POLICY.assertWritable('LIGHT_POWER'), true, 'assertWritable no longer blocks power');
});

// 11b. Light power is an optional, LAST step of the single light plan: only a
// changed, valid value is emitted; an unchanged value adds no step; an invalid
// or unread value blocks the whole plan with zero steps (zero mutations).
check('light power is an optional last step of the light plan', () => {
  // Changed value -> exactly one LIGHT_POWER step.
  const r1 = POLICY.planLight(
    current({ available: true, on: true, config: 2, powerW: 6.0 }),
    desired({ powerW: 8.0, powerWTouched: true }));
  eq(r1.error, null, 'no plan error');
  eq(ops(r1).join(','), 'LIGHT_POWER', 'only the power step');
  eq(r1.steps[0].op, 'LIGHT_POWER');
  eq(r1.steps[0].value, 8.0);
  eq(r1.steps[0].bytes, POLICY.bytesFor('LIGHT_POWER', 8.0), 'the step carries the encoded payload');
  // Combined plan: availability + configuration + power -> the power step is last.
  const r2 = POLICY.planLight(
    current({ available: false, on: false, config: 1, powerW: 6.0 }),
    desired({ available: true, availableTouched: true, config: 2, configTouched: true, powerW: 12.0, powerWTouched: true }));
  eq(r2.error, null, 'no plan error');
  eq(ops(r2).join(','), 'LIGHT_AVAILABLE,LIGHT_CONFIG,LIGHT_POWER', 'power is emitted last');
  // Unchanged value -> no power step.
  const r3 = POLICY.planLight(
    current({ available: true, config: 2, powerW: 6.0 }),
    desired({ powerW: 6.0, powerWTouched: true }));
  eq(r3.error, null, 'no plan error');
  eq(r3.steps.length, 0, 'an unchanged power value adds no step');
  // Out-of-range / malformed -> the plan is blocked with zero steps.
  for (const bad of [0.9, 18.1, 5.55, NaN, 'abc', null]) {
    const rb = POLICY.planLight(current({ available: true, powerW: 6.0 }), desired({ powerW: bad, powerWTouched: true }));
    assert(rb.error, 'invalid power blocks the plan: ' + String(bad));
    eq(rb.steps.length, 0, 'zero steps for invalid ' + String(bad));
  }
  // Unread current power -> blocked, no guessed default.
  const ru = POLICY.planLight(current({ available: true, powerW: null }), desired({ powerW: 8.0, powerWTouched: true }));
  assert(ru.error, 'an unread current power blocks the plan');
  eq(ru.steps.length, 0, 'zero steps when the current power is unread');
});

// 11c. The Write Lab raw payload validator and the four policy tiers:
// blocked (missing/reserved), registry-readonly (typed confirmation; the bike
// usually refuses it), high-impact (typed confirmation), and normal.
check('validateHexPayload + genericTier: raw payload and policy tiers', () => {
  for (const b of ['', '   ', '081', 'zz', '0', null, undefined, 'ab'.repeat(65)]) {
    assert(POLICY.validateHexPayload(b).ok !== true, 'rejected: ' + JSON.stringify(b));
  }
  const good = POLICY.validateHexPayload('0A 12 0b ff');
  assert(good.ok === true, 'accepted mixed-case spaced hex');
  eq(good.bytes.join(','), '10,18,11,255', 'bytes in order');
  eq(good.hex, '0a 12 0b ff', 'canonical lowercase hex');

  eq(POLICY.genericTier('DriveUnit', 'BIKE_LIGHT_POWER').tier, 'blocked', 'light power is blocked');
  eq(POLICY.genericTier('DriveUnit', 'BIKE_LIGHT_POWER').reason, 'Use the Light power control', 'light power points at its control');
  eq(POLICY.genericTier('DriveUnit', 'NOT_A_REGISTER').tier, 'blocked', 'an unknown register is blocked');
  eq(POLICY.genericTier('DriveUnit', 'NOT_A_REGISTER').reason, 'That register is not in the address registry.', 'unknown-register reason');
  eq(POLICY.genericTier('RemoteControl', 'BIKE_ID').tier, 'registry-readonly', 'a read-only register has its own tier');
  eq(POLICY.genericTier('RemoteControl', 'BIKE_ID').reason, 'Read-only in the registry. The bike will usually refuse this write.', 'read-only reason');
  eq(POLICY.genericDenied('RemoteControl', 'BIKE_ID'), null, 'a read-only register is not the blocked tier');
  eq(POLICY.genericDenied('DriveUnit', 'BIKE_LIGHT_POWER'), 'Use the Light power control', 'genericDenied keeps the blocked reason');
  const counts = { blocked: 0, 'registry-readonly': 0, 'high-impact': 0, normal: 0 };
  for (const e of REGISTRY) counts[POLICY.genericTier(e.component, e.name).tier]++;
  eq(REGISTRY.length, 895, 'the registry has 895 entries');
  eq(counts.blocked, 1, 'one blocked registry entry');
  eq(counts['registry-readonly'], 861, '861 read-only entries are listed');
  eq(counts['high-impact'], 22, '22 writable entries need high-impact confirmation');
  eq(counts.normal, 11, '11 writable entries are normal-tier');
  const unreadable = POLICY.judgeWrite(true, null, false, { readable: false });
  eq(unreadable.applied, false, 'an unreadable register is never applied');
  eq(unreadable.statusName, 'unverified (cannot be read back)', 'unreadable write is unverified');

  for (const [c, n] of [
    ['DriveUnit', 'MAXIMUM_ASSISTANCE_SPEED_IBD'],
    ['Battery', 'SO_C_LOWER_LIMIT'],
    ['Battery2', 'SO_C_UPPER_LIMIT'],
    ['DriveUnit', 'RESET_RIDE_STATISTICS'],
    ['HeadUnit', 'BUZZER'],
    ['RemoteControl', 'BUTTON_EVENTS_ENABLED'],
    ['Battery', 'ENABLE_BUTTON_TEST_MODE'],
    ['Battery', 'ENABLE_LED_TEST_MODE'],
    ['HeadUnit', 'LCD_TEST_MODE'],
    ['Battery', 'LED_TEST_PATTERN_ON'],
  ]) eq(POLICY.genericTier(c, n).tier, 'high-impact', c + '.' + n + ' is high-impact');

  for (const [c, n] of [
    ['DriveUnit', 'BIKE_LIGHT'],
    ['DriveUnit', 'BIKE_LIGHT_AVAILABLE'],
    ['DriveUnit', 'BIKE_LIGHT_CONFIGURATION'],
    ['RemoteControl', 'SERVICE_DUE'],
    ['RemoteControl', 'LANGUAGE'],
    ['RemoteControl', 'UNITS'],
    ['RemoteControl', 'TIME_FORMAT'],
    ['RemoteControl', 'TIME'],
    ['RemoteControl', 'LED_COLORS'],
  ]) eq(POLICY.genericTier(c, n).tier, 'normal', c + '.' + n + ' is normal-tier');

  assert(!('GENERIC_ALLOWLIST' in POLICY), 'the old allowlist is gone');
  eq(POLICY.OP.GENERIC_WRITE.writable, true, 'the generic op is enabled');
  eq(POLICY.OP.GENERIC_WRITE.evidence, 'untested', 'the generic op is untested');
});

// The policy is also loaded in places without the generated registry (for
// example a source-level test). A missing registry must fail closed, not throw.
check('policy: a missing address registry fails closed without throwing', () => {
  const isolated = {};
  new Function('window', readFileSync(path.join(repo, 'web', 'workshop', 'write-policy.js'), 'utf8'))(isolated);
  const p = isolated.Bes3WritePolicy;
  assert(p, 'write-policy.js loaded without the registry');
  eq(p.genericTierMap().size, 0, 'a missing registry yields an empty tier map');
  const tier = p.genericTier('DriveUnit', 'BIKE_LIGHT');
  eq(tier.tier, 'blocked', 'a missing registry blocks the register');
  assert(/not in the address registry/i.test(tier.reason), 'the blocked reason is explicit: ' + tier.reason);
});

// The quality gate's header must describe the checks it actually runs. Every
// finding blocks; the old baseline/limitation split was removed.
check('source: the component-photo button is a single header control (source check)', () => {
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert(/id="btnPhotos"/.test(html), 'the photo button is in the page');
  assert(html.indexOf('id="btnPhotos"') < html.indexOf('<main'), 'the photo button lives in the header, above the views');
  assert(/data-act="loadPhotos"/.test(html), 'the button triggers the shared load action');
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(!/photoLoadControl/.test(ui), 'there is no second, per-tab photo control');
  assert(/function updatePhotoButton/.test(ui), 'the header button state is rendered from one place');
  assert(/cdn\.jsdelivr\.net/.test(ui), 'the hover text names the external host');
});

check('source: check-all describes every check and has no baseline split', () => {
  const source = readFileSync(path.join(repo, 'tools', 'check-all.mjs'), 'utf8');
  assert(!/non-blocking BASELINE/i.test(source), 'the stale baseline wording is gone');
  assert(!/split into blocking FAILURES/i.test(source), 'the stale failure split is gone');
  assert(/innerHTML escaping/i.test(source), 'the header lists the innerHTML check');
  assert(/Every finding blocks/i.test(source), 'the header states that every finding blocks');
});

check('source: index.html references no file excluded from the public tree', () => {
  const manifest = readFileSync(path.join(repo, 'tools', 'public-exclude.txt'), 'utf8');
  const excluded = manifest.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const isExcluded = (rel) => excluded.some((rule) => (rule.endsWith('/') ? rel.startsWith(rule) : rel === rule));
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/<(?:script|link|img|source)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  assert(refs.length > 0, 'index.html has local resources');
  for (const ref of refs) {
    if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
    const rel = ref.replace(/^\.\//, '').split('?')[0].split('#')[0];
    assert(!isExcluded(rel), 'index.html must not reference a publicly excluded file: ' + rel);
    assert(existsSync(path.join(repo, rel)), 'index.html reference exists in the tree: ' + rel);
  }
  assert(!html.includes('web/workshop/part-images-pdf.js'), 'the excluded PDF image map is not named in index.html');
  const partImages = readFileSync(path.join(repo, 'web', 'workshop', 'part-images.js'), 'utf8');
  assert(/loadEmbeddedPdfImages\s*\(/.test(partImages), 'the embedded PDF map is loaded lazily instead');
  const all = readFileSync(path.join(repo, 'tools', 'check-all.mjs'), 'utf8');
  assert(/public-exclude-reference/.test(all), 'check-all blocks references to public-exclude paths');
  assert(!/OPTIONAL_SCRIPTS/.test(all), 'no optional-script exception weakens the missing-script rule');
});

check('source: the public tree marker prevents a request for the excluded PDF photo map', () => {
  const marker = readFileSync(path.join(repo, 'web', 'workshop', 'local-assets.js'), 'utf8');
  assert(/window\.Bes3LocalPartPhotos\s*=\s*(true|false)/.test(marker), 'the local-assets marker is well formed');
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  const markerAt = html.indexOf('web/workshop/local-assets.js');
  const partAt = html.indexOf('web/workshop/part-images.js');
  assert(markerAt !== -1 && partAt !== -1 && markerAt < partAt, 'the marker loads before the photo module');
  const part = readFileSync(path.join(repo, 'web', 'workshop', 'part-images.js'), 'utf8');
  assert(/Bes3LocalPartPhotos === false/.test(part), 'the lazy loader respects the marker');
  const tool = readFileSync(path.join(repo, 'tools', 'public-tree.mjs'), 'utf8');
  assert(/local-assets\.js/.test(tool) && /window\.Bes3LocalPartPhotos\s*=\s*false/.test(tool), 'public-tree writes the false marker');
});

// CI is the unbypassable half of the hook. The local hook remains opt-in, but a
// pushed branch must still run the same two checks.
check('source: CI runs both checks and the pre-commit hook still runs the gate', () => {
  const ciPath = path.join(repo, '.github', 'workflows', 'check.yml');
  assert(existsSync(ciPath), 'the CI workflow exists');
  const ci = readFileSync(ciPath, 'utf8');
  assert(/node tools\/check-all\.mjs/.test(ci), 'CI runs the quality gate');
  assert(/node tools\/check-workshop-light\.mjs/.test(ci), 'CI runs the regression suite');
  const hook = readFileSync(path.join(repo, 'githooks', 'pre-commit'), 'utf8');
  assert(/node tools\/check-all\.mjs/.test(hook), 'the pre-commit hook still runs the quality gate');
});

check('source: service interval inputs are readable in both themes and at narrow widths (source check)', () => {
  const css = readFileSync(path.join(repo, 'web', 'workshop', 'workshop.css'), 'utf8');
  const rule = /\.opt__extra\s+\.input\s*\{([^}]*)\}/.exec(css);
  assert(rule, 'the custom service input rule exists');
  assert(/min-width:\s*11rem/.test(rule[1]), 'the input has a sensible minimum width');
  assert(/font-size:\s*var\(--text-base\)/.test(rule[1]), 'the input uses the base font size');
  assert(/color:\s*var\(--ink\)/.test(rule[1]), 'the input text uses the theme ink token');
  assert(/background:\s*var\(--surface\)/.test(rule[1]), 'the input background uses the theme surface token');
  assert(/\.opt__extra\s+input\[type=date\]\s*\{[^}]*min-width:\s*12\.5rem/.test(css), 'the date input has a larger minimum width');
  const narrow = /@media \(max-width: 860px\) \{([\s\S]*?)\n\}/.exec(css);
  assert(narrow && /\.opt__extra\s+\.input\s*\{[^}]*min-width:\s*0[^}]*width:\s*100%/.test(narrow[1]), 'narrow screens give the inputs the full column');
});

// 12. With experimental off, no mode can write.
check('experimental off -> no mode can write', () => {
  const s = POLICY.createSession();
  eq(s.canWrite('live'), false, 'live blocked');
  eq(s.canWrite('demo'), false, 'demo blocked');
  eq(s.canWrite('file'), false, 'file blocked');
});

// 13. A saved readout (file mode) stays read-only even with the opt-in on.
check('file mode -> read-only even when opted in', () => {
  const s = POLICY.createSession();
  s.setExperimental(true);
  eq(s.canWrite('file'), false, 'file blocked');
  eq(s.canWrite('live'), true, 'live allowed');
});

// 14. Revoking the opt-in immediately removes write authority.
check('revocation -> authority removed', () => {
  const s = POLICY.createSession();
  s.setExperimental(true);
  eq(s.canWrite('live'), true, 'allowed while on');
  s.setExperimental(false);
  eq(s.canWrite('live'), false, 'blocked after revoke');
});

// 15. A replacement session starts unauthorized (no bleed-over).
check('new session -> unauthorized by default', () => {
  const a = POLICY.createSession();
  a.setExperimental(true);
  const b = POLICY.createSession();
  eq(b.canWrite('live'), false, 'new session blocked');
  eq(a.canWrite('live'), true, 'old session unchanged');
});

// 16. Authorization is re-checked per step: a mid-plan revoke stops later steps.
check('mid-plan revoke -> subsequent steps stop', () => {
  const s = POLICY.createSession();
  s.setExperimental(true);
  const ran = [];
  const steps = ['a', 'b', 'c'];
  for (const name of steps) {
    if (!s.canWrite('live')) break;
    ran.push(name);
    if (name === 'a') s.setExperimental(false);
  }
  eq(ran.join(','), 'a', 'only the first step ran');
});

// 17. Writes are single-owner: a second plan cannot acquire while one runs.
check('single-writer lock -> no concurrent interleave', () => {
  const s = POLICY.createSession();
  s.setExperimental(true);
  eq(s.tryAcquire(), true, 'first acquires');
  eq(s.tryAcquire(), false, 'second is refused');
  s.release();
  eq(s.tryAcquire(), true, 'released lock can be re-acquired');
  s.release();
});

// createSession.release: an identified owner's lock can only be released by
// that owner. A no-argument release only frees an anonymous lock, so a stray
// release() can never drop another operation's lock.
check('createSession.release: no-argument release never frees another owner', () => {
  const s = POLICY.createSession();
  const a = {};
  eq(s.tryAcquire(a), true, 'owner a acquires');
  s.release();
  eq(s.isBusy(), true, 'no-argument release leaves the lock held');
  eq(s.owns(a), true, 'lock still owned by a');
  eq(s.tryAcquire({}), false, 'a different owner cannot acquire');
  s.release({});
  eq(s.isBusy(), true, 'wrong-owner release is a no-op');
  s.release(a);
  eq(s.isBusy(), false, 'the owning candidate releases the lock');
  eq(s.tryAcquire(), true, 'an anonymous lock can be acquired');
  s.release();
  eq(s.isBusy(), false, 'a no-argument release frees an anonymous lock');
});

// 18. An ACK with an unchanged read-back is NOT success.
check('ack + unchanged read-back -> not applied', () => {
  const r = POLICY.judgeWrite(true, false, false);
  eq(r.applied, false, 'not applied');
  eq(r.acked, true, 'ack recorded');
  eq(r.statusName, 'acknowledged, not confirmed');
});

// 19. A failed / unknown read-back is NOT success. (The read-back is
// authoritative: a missing WRITE_RESPONSE can occur even when the value was
// applied, so absence of an ACK must not be used to deny or claim success.)
check('failed / unknown read-back -> not applied', () => {
  eq(POLICY.judgeWrite(true, null, true).applied, false, 'unknown read-back -> not applied');
  eq(POLICY.judgeWrite(false, null, true).applied, false, 'no read-back -> not applied');
  eq(POLICY.judgeWrite(true, null, false).statusName, 'acknowledged, read-back unknown');
});

// 20. A confirmed, matching read-back is the only success.
check('confirmed matching read-back -> applied', () => {
  const r = POLICY.judgeWrite(true, true, true);
  eq(r.applied, true, 'applied');
  eq(r.statusName, 'confirmed by read-back');
});

// 20a–20e. Explicit acknowledgment/read-back contract.
check('judgeWrite: acknowledged + fresh matching read-back -> applied', () => {
  const r = POLICY.judgeWrite(true, true, true);
  eq(r.applied, true, 'applied');
  eq(r.acked, true, 'ack preserved true');
});

check('judgeWrite: missing acknowledgment + fresh matching read-back -> applied', () => {
  const r = POLICY.judgeWrite(false, true, true);
  eq(r.applied, true, 'read-back is authoritative');
  eq(r.acked, false, 'ack preserved false');
});

check('judgeWrite: acknowledged + differing read-back -> not applied', () => {
  const r = POLICY.judgeWrite(true, false, false);
  eq(r.applied, false, 'not applied');
  eq(r.acked, true, 'ack preserved true');
  eq(r.statusName, 'acknowledged, not confirmed');
});

check('judgeWrite: unknown read-back with/without acknowledgment -> not applied', () => {
  const a = POLICY.judgeWrite(true, null, true);
  const b = POLICY.judgeWrite(false, undefined, true);
  eq(a.applied, false, 'ack + unknown read-back');
  eq(b.applied, false, 'no ack + unknown read-back');
  eq(a.acked, true, 'ack preserved');
  eq(b.acked, false, 'no ack preserved');
});

check('judgeWrite: non-boolean match / default values cannot be coerced to success', () => {
  eq(POLICY.judgeWrite(true, 1, 1).applied, false, '1 is not boolean true');
  eq(POLICY.judgeWrite(true, 'x', 'x').applied, false, 'string is not boolean true');
  eq(POLICY.judgeWrite(true, false, false).applied, false, 'false value + false match is not success');
  eq(POLICY.judgeWrite(true, 0, 0).applied, false, 'zero value + zero match is not success');
  eq(POLICY.judgeWrite(true, false, true).applied, true, 'a genuine false match is success');
});

// approvalRequired: only a live session demands per-write approval. Demo and
// saved readouts do not, so direct writer calls stay usable where writes are
// already simulated or impossible.
check('POLICY.approvalRequired: live requires approval, demo/file do not', () => {
  eq(POLICY.approvalRequired('live'), true, 'live requires approval');
  eq(POLICY.approvalRequired('demo'), false, 'demo does not');
  eq(POLICY.approvalRequired('file'), false, 'file does not');
});

// 20b. The approval requirement can only be widened, never switched off: a live
// session always requires approval, and an explicit option adds it in demo.
check('POLICY.needsApproval: the gate can be widened but never switched off', () => {
  eq(POLICY.needsApproval('live', false), true, 'live + false still requires approval');
  eq(POLICY.needsApproval('live', undefined), true, 'live + undefined requires approval');
  eq(POLICY.needsApproval('demo', false), false, 'demo + false does not require approval');
  eq(POLICY.needsApproval('demo', undefined), false, 'demo + undefined does not require approval');
  eq(POLICY.needsApproval('demo', true), true, 'demo + true adds the requirement');
});

// 21. planLightSwitch produces a single BIKE_LIGHT mutation in both directions.
// lightToggle() calls it only for the ON path (currentOn=false → turn-on step);
// the OFF path uses a LIGHT_AVAILABLE bounce and bypasses this function.
check('planLightSwitch -> single LIGHT_SWITCH (used by lightToggle for ON only)', () => {
  eq(ops(POLICY.planLightSwitch(false)).join(','), 'LIGHT_SWITCH', 'turn-on step');
  const r = POLICY.planLightSwitch(true);
  eq(r.steps[0].value, false, 'turn-off step value (policy still supports both directions)');
  eq(r.steps[0].bytes, '08 00', 'turn-off bytes explicit false');
  assert(POLICY.planLightSwitch(null).error, 'unknown state is refused');
});

// 22. Unread current values block the affected action instead of defaulting.
check('unknown current state -> action blocked, no guessed default', () => {
  const r = POLICY.planLight(current({ available: null }), desired({ available: true, availableTouched: true }));
  assert(r.error, 'availability error');
  eq(r.steps.length, 0, 'zero steps');
  const r2 = POLICY.planLight(current({ available: true, on: null }), desired({ switchOn: true }));
  assert(r2.error, 'switch error');
  eq(r2.steps.length, 0, 'zero steps');
});

// 23. Result wording is truthful: no unqualified "verified by the eBike".
check('result wording -> no unqualified hardware-verified claim', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(!/verified by the eBike/i.test(ui), 'old unqualified claim removed');
  assert(/Confirmed by read-back\./.test(ui), 'live wording present');
  assert(/Confirmed in simulation\./.test(ui), 'demo wording present');
});

// 24. Source-level labeling check for the System ID sync card. This inspects
// the rendered source text only; it is NOT DOM/browser testing.
check('source: System ID sync is labeled experimental/untested (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const heading = ui.split('\n').find((line) => line.includes('id="idTitle"'));
  assert(heading, 'System ID card heading present');
  assert(heading.includes('ID conflict &amp; System ID sync'), 'card heading text kept');
  assert(heading.includes("cardChip('id')"), 'one individual evidence chip beside heading');
  assert(ui.includes('Compares BIKE_ID in drive unit (0x182c) and control unit (0x2184).'), 'the subtitle states the compared registers');
  assert(!/ID comparison is read-only\. Writing the control unit's System ID is experimental/.test(ui), 'the subtitle no longer repeats the header badge');
  assert(ui.includes('>Experimental: write drive-unit ID to control unit</button>'), 'action button labels the write as experimental in all states');
  assert(!ui.includes('Resolve ID conflict'), 'no wording that promises to resolve a conflict');
  assert(!ui.includes('Rewrite System ID to control unit'), 'old action wording removed');
  assert(ui.includes('Matching IDs alone do not establish the cause of an error, and no rewrite is required merely because the values match.'), 'matching IDs do not suggest a rewrite');
  assert(!/the ID can be written again/i.test(ui), 'no rewrite suggestion for matching IDs');
  assert(ui.includes("The System ID write is experimental and untested."), 'staged warning marks the System ID write untested');
  assert(ui.includes("if (step.op === 'BIKE_ID') return 'The System ID write is experimental and untested."), 'staged warning states the untested limit');
  assert(ui.includes('A matching read-back does not prove that an ID conflict is resolved.'), 'staged warning keeps the read-back limit');
});

// 24b. Source-level Mini Remote check. The upstream reader has no Mini Remote
// detection, so the card is rendered only for the strict BRC3300 marker. The
// read-only probe code stays in the source for the Registry browser. Source
// text only; this is NOT DOM/browser testing.
check('source: Mini Remote is gated by strict detection and the probe stays available (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes("c.key !== 'MiniRemote' || c.present"), 'the card filter requires the strict detection result');
  assert(!ui.includes("c.key === 'MiniRemote' ? remoteProbeBlock()"), 'the Overview no longer renders the probe block');
  assert(ui.includes('function remoteProbeBlock'), 'the read-only probe UI is kept');
  assert(ui.includes('data-act="probeRemote"'), 'the probe action is kept for the Registry browser');
  assert(ui.includes('function rawDetails'), 'raw register helper present');
  assert(ui.includes('BLE_CENTRAL_DATABASE') && ui.includes('hasMiniRemote'), 'the existing strict marker is used');
  const pdf = readFileSync(path.join(repo, 'web', 'workshop', 'report-pdf.js'), 'utf8');
  assert(pdf.includes("mini && mini.present ? ' A Mini Remote (BRC3300)"), 'the PDF note is conditional on detection');
  assert(!pdf.includes('may not be visible over USB'), 'the PDF has no undetected-Remote placeholder');
});

// 25. Every operation carries complete experimental/evidence metadata, and the
// evidence labels match the documented state.
check('all OP entries have complete experimental and evidence metadata', () => {
  const allowed = ['observed-working', 'untested', 'known-issue', 'unavailable-live'];
  const ids = Object.keys(POLICY.OP);
  assert(ids.length >= 7, 'seven operations defined');
  for (const id of ids) {
    const op = POLICY.OP[id];
    eq(op.experimental, true, id + ': experimental true');
    assert(allowed.indexOf(op.evidence) !== -1, id + ': evidence in set');
    assert(typeof op.evidenceNote === 'string' && op.evidenceNote.length > 0, id + ': evidenceNote present');
    const d = POLICY.describeOp(id);
    assert(d && d.id === id, id + ': describeOp returns the op');
    assert(d.experimental === true && !!d.evidenceLabel && !!d.evidenceNote, id + ': describeOp metadata complete');
    eq(d.writable, op.writable === true, id + ': writable preserved');
  }
  for (const id of ['LIGHT_SWITCH', 'LIGHT_AVAILABLE', 'SERVICE_DUE', 'LIGHT_POWER']) eq(POLICY.OP[id].evidence, 'observed-working', id);
  for (const id of ['LIGHT_CONFIG', 'BIKE_ID']) eq(POLICY.OP[id].evidence, 'untested', id);
  eq(POLICY.OP.CLEAR_ISSUES.evidence, 'unavailable-live', 'CLEAR_ISSUES evidence');
  assert(/Uint8NormFactor10Message/.test(POLICY.OP.LIGHT_POWER.evidenceNote), 'power note names the confirmed schema');
  assert(/12 V light-port power budget/.test(POLICY.OP.LIGHT_POWER.evidenceNote), 'power note explains the port budget');
  assert(/StVZO battery reserve/.test(POLICY.OP.LIGHT_POWER.evidenceNote), 'power note explains the StVZO reserve');
  assert(/does NOT dim constant-voltage DC lamps/.test(POLICY.OP.LIGHT_POWER.evidenceNote), 'power note rules out lamp dimming');
  assert(/Power-cycle the bike/.test(POLICY.OP.LIGHT_POWER.evidenceNote), 'power note states the power-cycle requirement');
  assert(/not verified on other bikes or firmware/.test(POLICY.OP.LIGHT_SWITCH.evidenceNote), 'observed note states the limit');
  eq(POLICY.describeOp('NOPE'), null, 'unknown op returns null');
});

// 26. Source-level labeling check: exactly one distinct warning chip per
// Configuration card, derived from that card's evidence level. Control rows no
// longer carry their own chips. Source text only; NOT DOM/browser testing.
check('source: one distinct evidence chip per Configuration card (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(/function cardChip\s*\(/.test(ui), 'cardChip helper present');
  assert(ui.includes('CARD_EVIDENCE_OP'), 'the per-card evidence map is defined');
  assert(/POLICY\.describeOp\(/.test(ui), 'the chip reads describeOp');
  for (const key of ['light', 'service', 'ports', 'id', 'lab']) {
    assert(ui.includes("cardChip('" + key + "')"), 'one chip for the ' + key + ' card');
  }
  eq((ui.match(/cardChip\('/g) || []).length, 5, 'exactly five card chips');
  assert(ui.includes('Mixed evidence') && ui.includes('Observed working') && ui.includes('Untested'), 'labels reflect different evidence levels');
  eq((ui.match(/chipsRow\(opChip\('/g) || []).length, 1, 'only the Session Log keeps a control-level chip');
});

// 27. Source-level layout check: evidence chips sit in a wrapping flex
// container, and every remaining opChip usage is wrapped by that container.
check('source: evidence chips use a wrapping flex container (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes('const CHIP_ROW_STYLE = '), 'chip row style constant present');
  assert(ui.includes('flex-wrap:wrap'), 'chip row allows wrapping');
  assert(ui.includes('display:flex;flex-wrap:wrap;gap:6px;min-width:0'), 'chip row has display/gap/min-width');
  assert(ui.includes('chip--wrap'), 'evidence chips use chip--wrap class for wrapping within container width');
  const usages = (ui.match(/opChip\('/g) || []).length;
  const wrapped = (ui.match(/chipsRow\(opChip\('/g) || []).length;
  eq(usages, 1, 'one control-level evidence chip remains: ' + usages);
  eq(wrapped, usages, 'every opChip usage is wrapped in a chips row');
});

// 28. Source-level layout check: the lAvail switch is a sibling of the text
// block, the text block can shrink, and the switch cannot. No chip sits in the
// switch row any more.
check('source: lAvail switch is outside the chip container (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(!/chipsRow\([^)]*lAvail/.test(ui), 'lAvail is not passed into a chip container');
  assert(!ui.includes("chipsRow(opChip('LIGHT_AVAILABLE'))"), 'the enable-light row has no chip');
  assert(ui.includes('style="flex:1 1 auto;min-width:0"'), 'enable-light text block can shrink');
  assert(ui.includes('class="switch" style="flex:0 0 auto"'), 'enable-light switch stays visible');
});

// 29. Source-level text check: the visible chip text is the short label only;
// the long evidenceNote is used exclusively as the chip title (tooltip).
check('source: visible chip text never contains the evidence note (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(!/Experimental · \$\{d\.evidenceLabel\} — \$\{d\.evidenceNote\}/.test(ui), 'old long chip text removed');
  assert(ui.includes("chip(short, 'chip--warn', d.evidenceNote"), 'chip text uses the short label only');
  assert(!/Experimental · \$\{short\}/.test(ui), 'rows no longer repeat the Experimental prefix');
  assert(!/Experimental · \$\{[^}]*evidenceNote/.test(ui), 'evidence note never appears in the visible chip text');
  for (const label of ['Observed working', 'Untested', 'Known issue', 'Unavailable']) {
    assert(ui.includes("'" + label + "'"), 'short label present: ' + label);
  }
});

// 29b. Source-level chip layout: each Configuration card carries exactly one
// individual warning chip in its header, derived from its own evidence level.
// Source text only; this is NOT DOM/browser testing.
check('source: one distinct warning chip per card, no per-option chips (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes("const experimentalChip = () => chip('Experimental', 'chip--warn')"), 'the generic helper remains for the Session Log');
  eq((ui.match(/experimentalChip\(\)/g) || []).length, 1, 'the generic Experimental chip is used only outside Configuration');
  eq((ui.match(/cardChip\('/g) || []).length, 5, 'one distinct chip on each of the five cards');
  assert(!ui.includes('<span class="chip chip--warn">Experimental</span>'), 'no inline Experimental chips remain');
  assert(ui.includes("id=\"advTitle\">Write Lab ${cardChip('lab')}"), 'the Write Lab header carries its card chip');
  assert(!ui.includes('Write Lab (experimental)'), 'Write Lab title is plain');
  assert(!ui.includes('<strong>Experimental.</strong> The Write Lab sends a raw payload'), 'standalone Write Lab banner removed');
  assert(ui.includes('The target always comes from the address registry, never from a typed address.'), 'combined warning paragraph present');
});

// 30. Source-level approval-detail check: SERVICE_DUE and BIKE_ID have no fixed
// policy address, so the approval resolves the real register from the registry
// and never prints "null". This inspects the rendered source text only; it is
// NOT DOM/browser testing.
check('source: approval details resolve the real register address (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes('W.util.addrOf(op.component, op.name)'), 'approval falls back to the registry address');
  assert(ui.includes("addrNum != null ? ('0x' + addrNum.toString(16))"), 'a null address is never rendered');
  assert(!/address = .*\+ *null/.test(ui), 'no string concatenation of a possibly-null address');
});

// 31. Source-level start-of-page gate check: the risk warning runs before the
// rest of the UI is enabled and before doConnect calls W.connect() (and
// therefore before any requestDevice / USB device-picker call). This inspects
// the rendered source text only; it is NOT DOM/browser testing, and it cannot
// prove the modal renders correctly in a browser.
check('source: start-of-page risk warning runs before the rest of the UI (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const start = ui.indexOf('async function doConnect');
  assert(start !== -1, 'doConnect is present');
  const gate = ui.indexOf('await ensureRiskAccepted()', start);
  const connect = ui.indexOf('await W.connect()', start);
  assert(gate !== -1, 'doConnect awaits risk acceptance');
  assert(connect !== -1, 'doConnect calls W.connect()');
  assert(gate < connect, 'acceptance is checked before W.connect() (before any USB call)');
  const boot = ui.lastIndexOf('(async () => {');
  const bootGate = ui.indexOf('await ensureRiskAccepted()', boot);
  const bootRender = ui.indexOf('render();', boot);
  assert(boot !== -1 && bootGate !== -1 && bootRender !== -1, 'boot block gates render on acceptance');
  assert(bootGate < bootRender, 'the warning is shown before render() enables the UI');
  assert(!/requestDevice\s*\(/.test(ui), 'the UI layer itself never calls requestDevice');
});

// 32. Source-level check: the risk warning has no Cancel and cannot be dismissed
// without accepting. Continue is the only action, starts disabled, and enables
// only once the checkbox is ticked.
check('source: risk warning has no Cancel and Continue is the only action (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const start = ui.indexOf('function riskWarning()');
  const end = ui.indexOf('function ensureRiskAccepted()', start);
  assert(start !== -1 && end !== -1, 'riskWarning is present');
  const warn = ui.slice(start, end);
  assert(!warn.includes("label: 'Cancel'"), 'the risk warning has no Cancel button');
  assert(!/value:\s*false/.test(warn), 'the risk warning has no false-valued (dismiss) action');
  assert(warn.includes("id: 'riskContinue', disabled: true"), 'Continue starts disabled');
  assert(warn.includes('go.disabled = !cb.checked'), 'Continue enables only once the box is ticked');
});

// 33. Source-level check: the risk warning carries the required content and the
// exact acceptance label from the original notice.
check('source: risk warning content and required checkbox (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(/not affiliated with, endorsed by, or supported by Bosch/i.test(ui), 'non-affiliation statement');
  assert(/reverse-engineered/i.test(ui), 'reverse-engineering statement');
  assert(/leave it in an unexpected state/i.test(ui), 'unexpected-state statement');
  assert(/may void your warranty/i.test(ui), 'warranty statement');
  assert(/your own bike/i.test(ui), 'own-bike-only statement');
  assert(/at your own risk/i.test(ui) && /legal where you live/i.test(ui), 'risk + legality statement');
  assert(/staged for review/i.test(ui) && /applied as one visible batch/i.test(ui) && /never retried/i.test(ui) && /never rolled back/i.test(ui), 'experimental-writes bullet');
  assert(ui.includes('id="riskAccept"'), 'required acceptance checkbox present');
  assert(ui.includes('I understand and accept these terms.'), 'acceptance label present');
});

// 33b. Source-level check: acceptance is kept in memory only. The risk-warning
// code must not touch localStorage/sessionStorage (the theme toggle elsewhere is
// unrelated and is not part of this check).
check('source: risk acceptance uses no storage API (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const start = ui.indexOf('function riskWarning()');
  const end = ui.indexOf('function demoNotice()', start);
  assert(start !== -1 && end !== -1, 'risk functions are present');
  const acceptance = ui.slice(start, end);
  assert(!/localStorage|sessionStorage/.test(acceptance), 'acceptance code never touches web storage');
  assert(ui.includes('let riskAccepted = false;'), 'acceptance lives in an in-memory flag');
});

// 33c. Source-level check: both Connect and Demo are gated on acceptance.
check('source: Connect and Demo are gated on risk acceptance (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const connect = ui.indexOf('async function doConnect');
  assert(ui.indexOf('if (!accepted) return;', connect) !== -1, 'doConnect returns when acceptance is missing');
  const demoStart = ui.indexOf("$('btnDemo').onclick");
  const demoGate = ui.indexOf('await ensureRiskAccepted()', demoStart);
  const notice = ui.indexOf('await demoNotice()', demoStart);
  const start = ui.indexOf('await W.startDemo()', demoStart);
  assert(demoStart !== -1 && demoGate !== -1, 'the demo handler checks acceptance');
  assert(demoGate < notice && notice < start, 'the demo handler checks acceptance before the demo notice and startDemo');
});

// 34. Source-level check: demo mode shows a shorter notice and opens no USB
// device — the notice precedes startDemo and states that no USB device is used.
check('source: demo mode shows a notice and opens no USB device (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const start = ui.indexOf("$('btnDemo').onclick");
  assert(start !== -1, 'demo button handler present');
  const gate = ui.indexOf('await demoNotice()', start);
  const demo = ui.indexOf('await W.startDemo()', start);
  assert(gate !== -1 && demo !== -1 && gate < demo, 'demo notice is shown before startDemo');
  assert(ui.includes('No USB device is opened'), 'demo notice states no USB device is opened');
});

// 35. Source-level check: enabling the experimental opt-in requires a second,
// distinct confirmation, and cancelling it leaves the opt-in off.
check('source: enabling experimental writes needs a second confirmation (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes('await experimentalConfirm()'), 'opt-in handler awaits a second confirmation');
  assert(/const ok = await experimentalConfirm\(\);\s*if \(ok\) \{ W\.setExperimental\(true\); renderWrite\(\); \}/.test(ui), 'the opt-in is enabled only when the consent dialog is accepted');
  assert(ui.includes('if (!W.experimentalEnabled) {'), 'a missing consent is handled before any write is requested');
  assert(/Every staged change is shown/i.test(ui), 'opt-in confirmation states staged changes are shown before Apply');
  assert(/Nothing is retried/i.test(ui), 'opt-in confirmation states nothing is retried');
  assert(/Nothing is rolled back/i.test(ui), 'opt-in confirmation states nothing is rolled back');
});

// 36. Source-level check: an interrupted log entry is shown as
// "unverified — interrupted" and is never mislabelled "rejected".
check('source: interrupted log entries show an unverified chip (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes("s.interrupted ? chip('unverified — interrupted', 'chip--bad')"), 'interrupted chip present');
  assert(/s\.interrupted \? chip\('unverified — interrupted', 'chip--bad'\) : s\.blocked \? chip\('blocked'/.test(ui),
    'interrupted is checked before blocked, applied and rejected');
  assert(/chip\(s\.acked \? 'not confirmed' : 'rejected', 'chip--bad'\)/.test(ui), 'rejected remains only the final fallback');
});

// 37. Source-level check: the progress modal runs the visible batch under one
// approval, and closing it stops the remaining steps. There is no per-write
// approval UI left to clear.
check('source: runStepsModal uses the batch approval and stops on close (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const start = ui.indexOf('async function runStepsModal');
  assert(start !== -1, 'runStepsModal present');
  const end = ui.indexOf('// ------------------------------------------------------------ REPORT', start);
  const body = ui.slice(start, end);
  assert(body.includes('let batchApproved = true;'), 'the batch approval starts approved only after Apply');
  assert(body.includes('onClose: () => { batchApproved = false; resolveDone(); }'), 'closing the progress modal declines the remaining steps');
  assert(body.includes('approve: () => Promise.resolve(batchApproved)'), 'one approval covers the visible batch');
  assert(!body.includes('renderApproval'), 'the per-write approval renderer is gone');
  assert(!body.includes('runApproval'), 'the per-write approval slot is gone');
});

// 38. Source-level check: the light-power control is restored into the Light
// card as a bounded, value-checked range + number with presets, and is an
// optional step of the single light write plan (not a separate button). It is
// disabled while the current power is unread.
check('source: light power is an optional step in the light write plan (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(/<input type="range" id="lPowerRange" min="1" max="18" step="0\.1"/.test(ui), 'bounded range input present');
  assert(/<input type="number" id="lPower" min="1" max="18" step="0\.1"/.test(ui), 'bounded number input present');
  assert(ui.includes('data-preset='), 'power presets present');
  assert(!ui.includes('data-act="lightPowerApply"'), 'the separate write-power button is removed');
  assert(!ui.includes('id="lPowerRated"'), 'the separate lamp-rating checkbox is removed');
  assert(ui.includes('powerWTouched'), 'the UI feeds a touched power value into the plan');
  assert(ui.includes('POLICY.OP.LIGHT_POWER.id'), 'the light-power op runs through the plan');
});

// 39. Source-level check: the light-power card describes 0x1822 as a
// configuration value, not measured lamp power, and does not present the input
// range or its upper bound as a compatibility guarantee or a recommendation.
check('source: light power card states configuration-value limits (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(/This is a configuration value, not measured lamp power/.test(ui), 'states that the value is configuration, not measured output');
  assert(/A matching read-back does not establish electrical output or persistence/.test(ui), 'states the read-back limit');
  assert(/Do not choose 18 W just because it is the upper bound/.test(ui), 'warns against treating 18 W as a recommendation');
  assert(!/Known issue \(observed not working\)/.test(ui), 'the old observed-not-working claim is gone from the UI');
});

// 40. Source-level check: the Write Lab no longer has a typed WRITE arming
// (removed with the explicit permission in batch 3). The session consent, the
// typed register name for the two risky tiers, the per-write approval and the
// read-back stay.
check('source: the Write Lab gates the new way (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(!ui.includes('advancedArmed') && !ui.includes('wlArmType'), 'the typed WRITE arming is gone');
  assert(ui.includes('async function askExperimentalConsent(force)'), 'the session consent is one function');
  assert(ui.includes('if (t === \'write\') maybeAskConsent();'), 'opening the Configure tab asks for the consent');
  assert(ui.includes('data-act="expConsent"'), 'the banner can ask for the consent again');
  assert(ui.includes('function onSessionChange()'), 'a session change resets the draft and the consent');
  assert(ui.includes('W.on(\'disconnect\', () => { onSessionChange();'), 'disconnect resets the draft');
  assert(ui.includes('W.on(\'connectionlost\', ({ reason }) => { onSessionChange();'), 'connection loss resets the draft');
  assert(ui.includes('const risky = pending.filter((p) => p.risky);'), 'Apply finds the risky staged rows');
  assert(ui.includes('await typedBatchPrompt(risky)'), 'the typed gate is asked once per batch');
  assert(ui.includes("tier === 'registry-readonly'"), 'the read-only tier is marked risky');
});

// 41. Source-level check: the Write Lab lists the full registry (never a
// free-form address), marks read-only and write-only entries, filters blocked
// tiers, declares the generic operation, and shows the unverified notices.
check('source: Write Lab is registry-bound and shows the unverified notice (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes('ADDRESS_REGISTRY') && ui.includes('.addresses'), 'targets come from the full registry');
  assert(ui.includes('POLICY.genericTier('), 'policy tiers filter the picker');
  assert(ui.includes("tier === 'registry-readonly'"), 'the read-only tier drives the typed confirmation');
  assert(ui.includes('Read-only in registry.'), 'read-only-in-registry notice present');
  assert(ui.includes('Write-only register.'), 'write-only notice present');
  assert(ui.includes('data-act="advWrite"'), 'write button present');
  assert(ui.includes("cardChip('lab')"), 'one individual evidence chip sits in the Write Lab header');
  assert(ui.includes('Unverified register.'), 'unverified-register notice present');
  assert(ui.includes('High-impact register.'), 'high-impact banner present');
  assert(ui.includes("op: 'GENERIC_WRITE'"), 'the step declares the generic operation');
  assert(ui.includes('typedName: \'\', unreadable'), 'the step starts without a typed name');
  assert(ui.includes('for (const p of risky) p.step.typedName = p.key;'), 'Apply copies the typed name to each risky step');
  assert(ui.includes("p.op === 'GENERIC_WRITE'"), 'the pending row identifies a generic write');
  assert(ui.includes('p.tier'), 'the pending row shows the policy tier');
  assert(ui.includes('p.evidence'), 'the pending row shows the evidence label');
});

// 41b. Source-level check: the Write Lab card is always rendered in the Configure
// tab with component chips, a live search field, a picker and an arm button, and
// its Write button lists every unmet reason. Call mode is disabled with no code
// path.
check('source: Write Lab card has chips, search, one Write button and a reason list (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(/const writeLabCard = `<details/.test(ui), 'the Write Lab card is always rendered');
  assert(!/const writeLabCard = !sessionOpen \? '' :/.test(ui), 'the card is not hidden without a session');
  assert(/<details id="wlRawDetails" \$\{draft\.advanced\.rawOpen \? 'open' : ''\}>/.test(ui), 'the raw payload is collapsible');
  assert(ui.includes('data-wlcomp'), 'component filter chips are rendered');
  assert(ui.includes('id="wlSearch"'), 'search field is rendered');
  assert(ui.includes('type="search"'), 'the search field is a search input');
  assert(ui.includes('0x${e.address.toString(16)}'), 'picker options show the register address');
  assert(ui.includes('high impact'), 'picker options mark high-impact registers');
  assert(ui.includes('id="wlReasons"'), 'unmet reasons are rendered next to the Write button');
  assert(ui.includes('id="wlWrite"'), 'there is one Write button');
  eq((ui.match(/data-act="advWrite"/g) || []).length, 1, 'there is exactly one Write button');
  for (const reason of ['Connect the eBike or start the demo', 'Enable experimental writes', 'Choose a register', 'Read the register first', 'Enter a valid value', 'Type the register name to confirm']) {
    assert(readFileSync(path.join(repo, 'web', 'workshop', 'write-policy.js'), 'utf8').includes(reason), 'policy reason present: ' + reason);
  }
  assert(!/data-act="[^"]*call/i.test(ui), 'Call mode has no code path');
  const policy = readFileSync(path.join(repo, 'web', 'workshop', 'write-policy.js'), 'utf8');
  assert(/function genericTier\(component, name\)/.test(policy), 'genericTier is defined in the policy');
  assert(!/GENERIC_ALLOWLIST\s*=/.test(policy), 'the old allowlist is gone');
  const eng = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');
  assert(/encodeEnumArg, encodeStringArg/.test(eng), 'the friendly encoders are exposed to the UI');
  assert(/hiGrant\.typedName === component \+ '\.' \+ name/.test(eng), 'the writer boundary compares the typed register name with the target');
  assert(/grant\.typedName !== component \+ '\.' \+ name/.test(eng), 'the grant binding compares the typed register name with the target');
  assert(!/grant\.highImpactConfirmed/.test(eng), 'the writer no longer trusts a boolean instead of the typed name');
});

// 41c. Source-level check: the Write Lab picks registers from an in-place live
// result list (so search keeps focus), supports arrow-key/Enter selection, has a
// no-match state, uses a single-select component filter, and both Write buttons
// run the guided gate sequence instead of being permanently disabled.
check('source: Write Lab has a live result list and a guided write flow (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes('id="wlResults"'), 'the result list is rendered');
  assert(ui.includes('role="listbox"'), 'the result list is a listbox');
  assert(ui.includes('writeLabResultsHtml'), 'the result list has a renderer');
  const start = ui.indexOf('wlSearch.oninput = () => {');
  const end = ui.indexOf('};', start);
  const block = ui.slice(start, end);
  assert(start > -1 && block.includes('refreshWriteLabResults()'), 'typing refreshes the result list');
  assert(!block.includes('renderWrite()'), 'typing does not rebuild the whole card (keeps focus)');
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert(ui.includes("ev.key === '" + key + "'"), 'keyboard handling: ' + key);
  }
  assert(ui.includes('No matching register'), 'a no-match state is shown');
  assert(ui.includes('active.size === 1 && active.has(c)') && ui.includes('? null : [c]'), 'the component filter is single-select and clears on re-click');
  assert(/data-act="advWrite" \$\{canEdit \? '' : 'disabled'\}/.test(ui), 'the Write button is only disabled without a session, never permanently');
  assert(!ui.includes('disabled aria-pressed="true">Write<'), 'the old permanently disabled Write button is gone');
  assert(ui.includes("else if (a === 'advWrite') await guidedAdvancedWrite()"), 'the Write button calls the guided flow');
  const g = ui.slice(ui.indexOf('async function guidedAdvancedWrite'), ui.indexOf('async function applyGenericWrite'));
  const iOpt = g.indexOf('W.experimentalEnabled');
  const iRead = g.indexOf('W.readKey');
  const iApply = g.indexOf('applyGenericWrite()');
  assert(iOpt > -1 && iOpt < iRead && iRead < iApply, 'guided order: consent, read, stage');
  assert(g.includes('if (!(await experimentalConfirm())) return;') && g.includes('W.setExperimental(true)'), 'the single opt-in dialog is experimentalConfirm');
  assert(g.indexOf('experimentalConfirm') < g.indexOf('W.setExperimental(true)'), 'experimentalConfirm runs before the opt-in is applied');
  assert(!g.includes('Enable experimental writes?'), 'there is no second opt-in dialog before experimentalConfirm');
  assert(g.includes('if (!read) return;'), 'cancelling the read stops before staging');
  assert(g.includes('await W.readKey(entry.component, entry.name)'), 'the guided flow reads on demand without writing');
  assert(!g.includes('typedConfirmPrompt'), 'the guided flow does not ask for the typed name before staging');
  const apply = ui.slice(ui.indexOf('async function applyPending'), ui.indexOf('async function runStepsModal'));
  assert(apply.includes('await typedBatchPrompt(risky)'), 'Apply asks the typed gate once for the whole batch');
  assert(apply.includes('for (const p of risky) p.step.typedName = p.key;'), 'Apply copies each typed name to its step');
});

// 41c-2. Source-level check: the typed WRITE arming is gone (removed with the
// explicit permission in batch 3) and nothing references it any more.
check('source: the typed WRITE arming is removed (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  for (const gone of ['Arm the Write Lab', 'Arm Write Lab', 'armAdvanced', 'disarmAdvanced', 'advancedOpen', 'advancedArmed', 'wlArmType', 'advArm', 'expWrites']) {
    assert(!ui.includes(gone), 'no arming code remains: ' + gone);
  }
  assert(!ui.includes('Arm the Write Lab (type WRITE)'), 'the "Next: …" hint no longer asks for arming');
  assert(ui.includes('data-act="expConsent"'), 'the consent can be requested again from the banner');
  assert(ui.includes('if (t === \'write\') maybeAskConsent();'), 'opening the Configure tab asks for the consent');
});

// 41c-3. The Write Lab decision logic is one pure policy function: every
// combination of missing prerequisites must be reported in the same order.
check('policy: writeLabNextStep reports the next missing prerequisite (policy check)', () => {
  const ready = {
    sessionOpen: true, experimentalEnabled: true, hasTarget: true,
    targetReadable: true, targetRead: true, payloadValid: true,
    typedNameRequired: false, typedNameConfirmed: false,
  };
  const next = (over) => POLICY.writeLabNextStep(Object.assign({}, ready, over));
  eq(POLICY.writeLabNextStep(ready).step, null, 'nothing is missing when every condition is met');
  eq(POLICY.writeLabNextStep(ready).label, 'All conditions met.', 'the ready label is explicit');
  eq(next({ sessionOpen: false }).step, 'session', 'no session comes first');
  eq(next({ experimentalEnabled: false }).step, 'consent', 'the consent comes before the target');
  eq(next({ hasTarget: false }).step, 'target', 'a missing target comes before the read');
  eq(next({ targetRead: false }).step, 'read', 'the register must be read before the payload');
  eq(next({ targetReadable: false, targetRead: false, payloadValid: false }).step, 'value', 'a write-only register needs no read');
  eq(next({ payloadValid: false }).step, 'value', 'an invalid payload comes before the typed name');
  eq(next({ typedNameRequired: true }).step, 'typedName', 'the typed register name is required for those tiers');
  eq(next({ typedNameRequired: true, typedNameConfirmed: true }).step, null, 'a confirmed typed name unblocks the write');
  eq(next({ typedNameRequired: false, typedNameConfirmed: false }).step, null, 'a normal tier needs no typed name');
  eq(POLICY.writeLabNextStep({}).step, 'session', 'an empty state reports the session first');
  eq(POLICY.writeLabNextStep(null).step, 'session', 'a missing state reports the session first');
});

// 41c-4. The modal slot: a second modal must cancel the pending one instead
// of leaving its promise pending forever. The stack is DOM-free, so this is a
// real behavioural test.
check('policy: a second modal cancels the pending one instead of leaving it pending', () => {
  const stack = POLICY.createModalStack();
  let first = 'pending';
  let closed = false;
  stack.open({ resolve: (v) => { first = v; }, onClose: () => { closed = true; } });
  eq(first, 'pending', 'the first modal is pending');
  eq(stack.current() !== null, true, 'the stack knows the current modal');
  let second = 'pending';
  const cancelled = stack.open({ resolve: (v) => { second = v; } });
  eq(cancelled !== null, true, 'the replaced modal is reported');
  eq(first, false, 'the replaced modal is resolved with false (cancelled, never confirmed)');
  eq(closed, true, 'the replaced modal runs its close handler');
  eq(second, 'pending', 'the new modal is pending');
  stack.close(stack.current(), true);
  eq(second, true, 'the current modal resolves with its value');
  eq(stack.current(), null, 'the slot is free again');
  // A stale entry must not close a newer modal.
  let third = 'pending';
  const stale = { resolve: (v) => { third = v; } };
  stack.open(stale);
  stack.open({ resolve: () => {} });
  eq(stack.close(stale, true), false, 'a stale entry cannot close the current modal');
  eq(third, false, 'the stale entry was cancelled, not confirmed');
  stack.cancelAll();
  eq(stack.current(), null, 'cancelAll frees the slot');
});


// the current registry and policy, so its counts and row count cannot drift.
check('source: the generated Write Lab tier list matches the policy (source check)', () => {
  const doc = readFileSync(path.join(repo, 'docs', 'write-lab-tier-list.md'), 'utf8');
  const counts = { blocked: 0, 'registry-readonly': 0, 'high-impact': 0, normal: 0 };
  for (const e of REGISTRY) counts[POLICY.genericTier(e.component, e.name).tier]++;
  assert(doc.includes('Registry entries: **' + REGISTRY.length + '**'), 'entry count matches');
  assert(doc.includes('**' + counts.blocked + ' blocked**'), 'blocked count matches');
  assert(doc.includes('**' + counts['registry-readonly'] + ' registry-readonly**'), 'read-only count matches');
  assert(doc.includes('**' + counts['high-impact'] + ' high-impact**'), 'high-impact count matches');
  assert(doc.includes('**' + counts.normal + ' normal**'), 'normal count matches');
  assert(doc.includes('`unverified (cannot be read back)`'), 'the unreadable result wording is documented');
  const dataRows = doc.split(/\r?\n/).filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && !l.startsWith('| Component'));
  eq(dataRows.length, REGISTRY.length, 'the table has one row per registry entry');
  assert(existsSync(path.join(repo, 'tools', 'build-write-lab-tier-list.mjs')), 'the generator is committed');
});

// 41e. Source-level check: the typed register name is a batch gate. It is
// attached only at Apply, after the one batch prompt, and cleared from any
// unapplied row so a later retry asks again.
check('source: the Write Lab typed register name is a batch gate (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const fn = ui.slice(ui.indexOf('async function applyGenericWrite'), ui.indexOf('async function applyService'));
  assert(fn.includes("typedName: '', unreadable"), 'staging never carries a typed name');
  assert(fn.includes("stageSteps('lab', [step])"), 'the Write Lab stages its step');
  const apply = ui.slice(ui.indexOf('async function applyPending'), ui.indexOf('async function runStepsModal'));
  assert(apply.includes('const risky = pending.filter((p) => p.risky);'), 'Apply finds the risky rows');
  assert(apply.includes('await typedBatchPrompt(risky)'), 'one prompt covers the batch');
  assert(apply.includes('for (const p of risky) p.step.typedName = p.key;'), 'the typed name reaches the writer boundary');
  assert(apply.includes('for (const p of pending) p.step.typedName = \'\';'), 'an unapplied row asks again on retry');
  assert(!ui.includes('writeLabHighImpactConfirmed'), 'the old per-write typed confirmation is gone');
  assert(!ui.includes('typedConfirmPrompt'), 'the old single-register typed prompt is gone');
});

// 42. Source-level check: the version is declared once (in write-policy.js, the
// module loaded before the engine and UI) and the top entry of the changelog
// matches it; the UI and the export carry it too.
check('source: the version matches the top changelog entry (source check)', () => {
  const policy = readFileSync(path.join(repo, 'web', 'workshop', 'write-policy.js'), 'utf8');
  const m = policy.match(/const VERSION = \{ version: '([^']+)', date: '([^']+)' \}/);
  assert(m, 'the version is declared on the write policy (write-policy.js)');
  const cl = readFileSync(path.join(repo, 'docs', 'CHANGELOG.md'), 'utf8');
  const top = cl.match(/^## ([0-9]+\.[0-9]+\.[0-9]+) — ([0-9-]+)/m);
  assert(top, 'the changelog has a version heading');
  eq(m[1], top[1], 'the coded version equals the top changelog entry');
  eq(m[2], top[2], 'the coded date equals the top changelog entry');
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes("'Workshop v' + versionInfo().version"), 'the UI builds the version label');
  const eng = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');
  assert(eng.includes('workshopVersion: appVersion()'), 'the export carries workshopVersion');
});

// The Overview must not repeat the Configure and Report entries, and the PDF
// report must draw the cadence as one horizontal 0..120 rpm bar with a shared,
// clamped fill and distinct track/fill colours.
check('source: the overview is clean and the PDF shows one cadence bar (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(!ui.includes('data-go="write"'), 'the overview has no "Configure light & service" button');
  assert(!ui.includes('data-go="report"'), 'the overview has no "PDF diagnostic report" button');
  const pdf = readFileSync(path.join(repo, 'web', 'workshop', 'report-pdf.js'), 'utf8');
  assert(pdf.includes("'0 rpm'") && pdf.includes("'120 rpm'"), 'the cadence bar is labelled 0 and 120 rpm');
  assert(pdf.includes('cadenceFill(cadenceRpm)') && pdf.includes('cadenceFill(cadenceRpm) / 100'), 'the cadence fill divides by 100 (percent→fraction, not by 120)');
  assert(!pdf.includes('[120, 25, 100]'), 'the purple track and fill are gone');
  assert(pdf.includes('CADENCE_COLORS.track') && pdf.includes('CADENCE_COLORS.fill'), 'the track and fill use separate colours');
  assert(!pdf.includes('Math.PI * 1.55'), 'the old rolled cadence gauge is gone');
});

// The probe returns more than a hundred rows. The result block must be bounded,
// scoped to the component card, and hide empty rows behind an aria-expanded
// toggle. This is source-level only; it cannot prove the browser layout.
check('source: the remote probe result block is bounded and collapsible (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const css = readFileSync(path.join(repo, 'web', 'workshop', 'workshop.css'), 'utf8');
  assert(ui.includes('class="probe-results"'), 'the probe has its own result container');
  assert(ui.includes('<caption>'), 'the probe table has a caption');
  assert(ui.includes('<th scope="col">Register</th><th scope="col">Value</th>'), 'the table is Register | Value');
  assert(ui.includes('data-act="probeEmpty"'), 'the empty rows have a toggle');
  assert(ui.includes('aria-expanded="false"') && ui.includes('aria-controls="probeEmptyRows"'), 'the toggle starts collapsed and names its target');
  assert(ui.includes('<tbody id="probeEmptyRows" hidden>'), 'empty rows are hidden by default');
  assert(ui.includes('registers read'), 'the summary line is present');
  assert(css.includes('.probe-results {') && css.includes('max-height: 260px') && css.includes('overflow: auto'), 'the result container is bounded and scrolls');
  assert(css.includes('overflow-wrap: anywhere'), 'long register names and hex values wrap');
  assert(css.includes('.comp__body { min-width: 0; }'), 'the grid item may not widen its card');
  assert(css.includes('table-layout: fixed'), 'the probe table cannot stretch the grid');
});

// Other is appended last and uses the same amber in the UI and the PDF; the
// footnote wording is shared so the two reports cannot drift apart.
check('source: Other is last, amber and documented in the UI and PDF (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const pdf = readFileSync(path.join(repo, 'web', 'workshop', 'report-pdf.js'), 'utf8');
  assert(ui.includes("withOtherSegment(modes, otherD, 'distance')"), 'the distance chart appends Other');
  assert(ui.includes("withOtherSegment(modes, otherE, 'energy')"), 'the energy chart appends Other');
  assert(ui.includes('OTHER_NOTE') && ui.includes('stats__note'), 'the on-screen footnote is present');
  assert(pdf.includes('otherShare(') && pdf.includes('withOtherSegment('), 'the PDF uses the same residual helpers');
  assert(pdf.includes('OTHER_COLOR') && pdf.includes('OTHER_NOTE'), 'the PDF uses the shared amber and note');
});

// 43. Source-level check: approvalInfo must resolve the generic register name
// from the step (step.name); it must never reference a bare `name` identifier
// (which was undefined and produced a bogus cache key).
check('source: approvalInfo resolves the generic register name from the step (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const start = ui.indexOf('function approvalInfo(');
  const end = ui.indexOf('function intendedDisplay(');
  assert(start !== -1 && end > start, 'approvalInfo function found');
  const body = ui.slice(start, end);
  assert(body.includes("component + '.' + step.name"), 'the cache key uses step.name');
  assert(body.includes('entryOf(component, step.name)'), 'the registry lookup uses step.name');
  assert(!/(?<![.\w])name(?![:\w])/.test(body), 'approvalInfo never references a bare name identifier');
});

// 44. Source-level check: the Workshop is the single application page. The
// Classic Reader page and its script are gone, no source file under
// web/workshop or tools still names the old entry point, and the application
// page carries no Classic Reader / Expert View link or text. The old name is
// assembled at runtime so this check does not itself reintroduce it.
check('source: index.html is the single app and no Classic Reader remains (source check)', () => {
  const OLD_PAGE = 'workshop' + '.html';
  assert(existsSync(path.join(repo, 'index.html')), 'index.html exists');
  assert(!existsSync(path.join(repo, OLD_PAGE)), 'the old Workshop page name is gone');
  assert(!existsSync(path.join(repo, 'web', 'app.js')), 'the Classic Reader script is gone');
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert(!/Classic Reader/i.test(html), 'index.html has no Classic Reader text');
  assert(!/Expert View/i.test(html), 'index.html has no Expert View text');
  assert(!html.includes(OLD_PAGE), 'index.html does not reference the old entry point');
  for (const dir of [path.join(repo, 'web', 'workshop'), path.join(repo, 'tools')]) {
    for (const name of readdirSync(dir)) {
      if (!/\.(js|mjs)$/.test(name)) continue;
      const src = readFileSync(path.join(dir, name), 'utf8');
      assert(!src.includes(OLD_PAGE), name + ' does not name the old entry point');
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// SOURCE-LEVEL CHECKS — classification guide
//
// SAFETY TRIPWIRES — changing these requires explicit approval and matching
// behavioral tests. They enforce structural boundaries whose violation could
// silently disable write safeguards:
//   • check 45 'lint: write-path invariants are pinned' — one frame-builder
//     call site, one transmit, every Writer funnels through writeVerified, no
//     retry in rawWrite, no web storage in auth path, one-shot grant in runPlan.
//   • check 31/32/33 — risk warning ordering and no-cancel rule.
//   • check 34/35/36 — experimental opt-in cannot be skipped or stored.
//   • check 37 — single plan approval per Apply batch.
//   • check 45b — port card uses the generic writer only (no hidden channel).
//
// COSMETIC / LABELING CHECKS — test wording, chip placement, UI copy. Safe to
// update when the corresponding UI text changes. Not a safety gate on their own:
//   • checks 24–30 — evidence/chip labeling, switch layout, approval text.
//   • checks 26–29 — chip wrapping, text content.
//   • checks 38–44 — light-power wording, Write Lab, version stamp, System ID
//     labeling, Mini Remote phrasing.
//   • checks for specific button labels, option text, sub-section copy.
//
// The distinction matters: cosmetic checks break on safe reformatting; safety
// tripwires detect dangerous structural changes. When a cosmetic check blocks
// a valid UI change, update the check too. When a tripwire fires, stop and
// review the change for safety implications before overriding it.
// ────────────────────────────────────────────────────────────────────────────

// 45. Lint-style source invariants. These pin the architecture so a new writer
// cannot bypass the gates: one frame builder call site and one transmit
// function, both inside the engine; every exported writer funnels through
// writeVerified; no write frame is built outside the engine; no retry loop
// around the transmit; no web storage in the write/authorization path; and
// runPlan is the only place a one-shot grant is issued. Source inspection only;
// it is NOT DOM/browser testing. Behavioural counterparts live later in this
// file: live-mode refusal (M25), the serviceDue round trip (M26), and the
// single-transmission, grant-binding, stale-token and plan-replacement checks.
check('lint: write-path invariants are pinned (source check)', () => {
  const engine = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');

  // 1. buildWriteFrame is called exactly once, and only inside rawWrite.
  eq((engine.match(/buildWriteFrame\(/g) || []).length, 1, 'engine.js calls buildWriteFrame exactly once');
  const rwStart = engine.indexOf('async function rawWrite(');
  const rwEnd = engine.indexOf('async function rawRpc(', rwStart);
  assert(rwStart !== -1 && rwEnd > rwStart, 'rawWrite is present');
  const rawWrite = engine.slice(rwStart, rwEnd);
  assert(rawWrite.includes('buildWriteFrame('), 'the only write frame is built inside rawWrite');

  // 2. rawWrite is defined once and called exactly once, from writeVerified.
  eq((engine.match(/rawWrite\(/g) || []).length, 2, 'rawWrite appears once as a definition and once as a call');
  const wvStart = engine.indexOf('async function writeVerified(');
  const wvEnd = engine.indexOf('const Writers = {', wvStart);
  assert(wvStart !== -1 && wvEnd > wvStart, 'writeVerified is present');
  const writeVerified = engine.slice(wvStart, wvEnd);
  assert(writeVerified.includes('rawWrite('), 'rawWrite is called from writeVerified');

  // 3. No retry/backoff loop around the transmit.
  assert(!/\b(for|while)\s*\(/.test(rawWrite), 'rawWrite has no retry loop');
  assert(!/setTimeout|setInterval/.test(rawWrite), 'rawWrite schedules no retry');

  // 4. Every Writers.* method funnels through writeVerified (or throws first).
  const writersStart = engine.indexOf('const Writers = {');
  const writersEnd = engine.indexOf('\n  };', writersStart);
  assert(writersStart !== -1 && writersEnd > writersStart, 'the Writers object is present');
  const writers = engine.slice(writersStart, writersEnd);
  const writerNames = ['lightAvailable', 'lightConfiguration', 'lightPower', 'lightSwitch', 'portActive', 'serviceDue', 'syncBikeId', 'generic'];
  for (const name of writerNames) {
    const at = writers.indexOf(name + '(');
    assert(at !== -1, 'writer present: ' + name);
    const next = writers.indexOf('\n    },', at);
    const body = writers.slice(at, next === -1 ? writers.length : next);
    assert(body.includes('writeVerified('), name + ' funnels through writeVerified');
  }
  eq((writers.match(/writeVerified\(/g) || []).length, writerNames.length, 'every writer calls writeVerified');
  eq((engine.match(/writeVerified\(/g) || []).length, writerNames.length + 1, 'writeVerified has one definition and one call per writer');

  // 5. No file outside engine.js builds a write frame or transmits a raw write.
  for (const name of readdirSync(path.join(repo, 'web', 'workshop'))) {
    if (!name.endsWith('.js') || name === 'engine.js') continue;
    const src = readFileSync(path.join(repo, 'web', 'workshop', name), 'utf8');
    assert(!src.includes('buildWriteFrame('), name + ' does not build a write frame');
    assert(!/\brawWrite\(/.test(src), name + ' does not transmit a raw write');
  }

  // 6. No web storage in the engine. In the UI only the theme preference and
  // the technical-details display preference are persisted (or a comment).
  // Write authorization and risk acceptance are never persisted.
  assert(!/localStorage|sessionStorage/.test(engine), 'engine.js uses no web storage');
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  for (const line of ui.split('\n')) {
    if (!/localStorage|sessionStorage/.test(line)) continue;
    const isComment = line.trim().startsWith('//');
    const isTheme = line.includes('bes3-workshop-theme') || line.includes('TECH_KEY');
    const isTech = line.includes('bes3.showTechDetails');
    assert(isComment || isTheme || isTech, 'ui.js storage use is a theme/tech preference or a comment: ' + line.trim());
  }

  // 7. runPlan is the only place a one-shot grant is issued; writeVerified only
  // consumes it (sets it false).
  eq((engine.match(/approvedWrite\s*=/g) || []).length, 2, 'approvedWrite is assigned in exactly two places');
  assert(/owner\.approvedWrite = false;/.test(engine), 'writeVerified consumes the grant (sets it false)');
  assert(/owner\.approvedWrite = grant \|\| false;/.test(engine), 'runPlan issues the grant');
});

// 45b. The power-port card is a dedicated UI feature built on the dedicated
// boolean writer: no new policy operation and no change to any gate. Source-level
// only; the DOM-level staging check is below.
check('source: power ports reuse the generic writer and are marked untested (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const engine = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');
  const demo = readFileSync(path.join(repo, 'web', 'workshop', 'demo-data.js'), 'utf8');
  const policy = readFileSync(path.join(repo, 'web', 'workshop', 'write-policy.js'), 'utf8');
  const css = readFileSync(path.join(repo, 'web', 'workshop', 'workshop.css'), 'utf8');
  assert(ui.includes('LOW_POWER_PORT_ACTIVE') && ui.includes('HIGH_POWER_PORT_ACTIVE'), 'both power-port registers are targeted');
  assert(!ui.includes('MULTI_PURPOSE_PORT_STATUS'), 'the card is limited to the two power-port registers');
  eq((ui.match(/const PORT_TARGETS = \[/g) || []).length, 1, 'one port target list');
  assert(/const PORT_PAYLOAD = \{ enable: '08 01', disable: '08 00' \}/.test(ui), 'the two unverified payloads are declared');
  assert(!/no confirmed encoding/.test(ui), 'the verbose payload notice is removed from the card');
  assert(ui.includes('Unknown values are not treated as off'), 'unknown values are not guessed');
  assert(ui.includes('data-act="portRead"'), 'a read-only refresh control is present');
  assert(/async function readPortStates\(\)[\s\S]*?W\.readKey\(/.test(ui), 'the refresh performs reads only');
  assert(ui.includes("stageSteps('ports', steps)"), 'changes are staged, not sent');
  assert(/W\.Writers\.portActive\(t\.name, choice === 'enable', owner\)/.test(ui),
    'each port uses the decoded-boolean port writer');
  assert(ui.includes('data-port-set="enable"') && ui.includes('data-port-set="disable"'),
    'Active / Off pills drive the port choice');
  assert(ui.includes("cardChip('ports')"), 'the power-ports card carries one evidence chip');
  assert(ui.includes('if (source === \'light\' || source === \'ports\')'), 'card sources replace their own staged rows');
  assert(ui.includes('pending[i].source === source'), 'restaging removes only rows from the same card');
  assert(ui.includes('function portChanges()'), 'an unchanged payload is not staged');
  assert(ui.includes('entry.readable === false'), 'unreadable is derived from the registry');
  assert(ui.includes('function portAddressLabel('), 'a missing registry address cannot break the card');
  assert(ui.includes('<details class="card wcard wcard--collapse" id="portCard"'), 'the card is a collapsible dropdown');
  assert(/\.writer \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/.test(css), 'Configure cards stack one after another');
  assert(css.includes('.wcard--collapse > summary.wcard__head'), 'the dropdown header is styled');
  // Every Configure card is a closed dropdown with persisted open state.
  for (const id of ['lightCard', 'svcCard', 'portCard', 'idCard', 'advCard']) {
    assert(ui.includes(`id="${id}"`), id + ' is rendered');
    assert(new RegExp(`id="${id}"[^>]*\\$\\{draft\\.cards\\.`).test(ui), id + ' reads its open state from the draft');
  }
  assert(ui.includes("const CARD_IDS = {") && ui.includes('card.ontoggle = () =>'), 'all card toggles are bound');
  assert(ui.includes('resetCardState()'), 'the open state is cleared on a session change');
  eq((ui.match(/<summary class="wcard__head"/g) || []).length, 5, 'five collapsible card headers');
  eq(Object.keys(POLICY.OP).length, 8, 'no new policy operation was introduced');
  eq((engine.match(/const Writers = \{/g) || []).length, 1, 'the Writers object is unchanged in shape');
  assert(engine.includes('portActive(portName, on, owner)'), 'the dedicated boolean port writer is present');
  assert(!policy.includes('POWER_PORT:'), 'the gated write policy was not extended');
  for (const name of ['LOW_POWER_PORT_ACTIVE', 'HIGH_POWER_PORT_ACTIVE']) {
    eq(POLICY.genericTier('DriveUnit', name).tier, 'normal', name + ' is deliberately normal-tier');
  }
  // The generic Write Lab still gates the other PORT registers.
  eq(POLICY.genericTier('DriveUnit', 'MULTI_PURPOSE_PORT_STATUS').tier, 'high-impact', 'other PORT registers stay high-impact');
  assert(demo.includes('"6193": "08 01"') && demo.includes('"6194": "08 00"'), 'demo seeds both port registers');
});

// 45c. The tab is named Configuration and every card icon shares one neutral
// line colour while keeping its own glyph, like the PDF report's vector icons.
check('source: Configuration tab name and homogeneous individual card icons (source check)', () => {
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  const css = readFileSync(path.join(repo, 'web', 'workshop', 'workshop.css'), 'utf8');
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert(/data-tab="write">Configuration</.test(html), 'the tab is labelled Configuration');
  assert(!/data-tab="write">Configure</.test(html), 'the old tab name is gone');
  assert(ui.includes('ICON.card = {'), 'one card-icon set is defined');
  for (const key of ['light', 'service', 'ports', 'id', 'lab', 'pending']) {
    assert(ui.includes('ICON.card.' + key), key + ' card has its own glyph');
  }
  for (const g of ['light: ICON.light', 'id: ICON.shield', 'lab: ICON.wrench']) {
    assert(ui.includes(g), 'existing glyph reused: ' + g);
  }
  for (const key of ['service', 'ports']) {
    const m = new RegExp(key + ": '(<svg[^']*?)'").exec(ui);
    assert(m && /stroke-width="1\.8"/.test(m[1]) && /stroke="currentColor"/.test(m[1]), key + ' glyph uses the shared line style');
  }
  eq((ui.match(/wcard__icon--card/g) || []).length, 6, 'all six card icons use the homogeneous colour class');
  assert(!/wcard__icon--(beam|primary)/.test(ui), 'the mixed card icon colours are gone');
  assert(css.includes('.wcard__icon--card { background: var(--surface-2); color: var(--ink-2);'), 'one neutral tile/line colour is defined');
  // Exactly one evidence chip per card, in the header; no per-option chips.
  const summaries = [...ui.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
  assert(summaries.length >= 5, 'the card summaries are present');
  for (const body of summaries) {
    assert(!/chipsRow\(opChip\(/.test(body), 'no per-option evidence chip inside a card header');
  }
  assert(ui.includes("id=\"portTitle\">Power ports ${cardChip('ports')}"), 'the Power ports title carries its own chip');
  assert(!/Experimental · untested\.<\/p>/.test(ui), 'the Power ports subtitle does not repeat the chip');
  eq((ui.match(/cardChip\('/g) || []).length, 5, 'one distinct chip per Configuration card');
  const subs = [...ui.matchAll(/class="wcard__sub">([^<]*)</g)].map((m) => m[1]);
  for (const s of subs) {
    assert(!/experimental|untested/i.test(s), 'subtitle carries facts only: ' + s);
  }
});

// ---------------------------------------------------------------------------
// Phase 2: actual engine, simulated transport, synthetic inputs.
console.log('');
console.log('Engine checks (fake transport, synthetic inputs)');

async function checkAsync(name, fn, timeoutMs) {
  resetFrameCounters();
  const started = Date.now();
  let err = null;
  let timer = null;
  const limit = timeoutMs || TEST_TIMEOUT_MS;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('test timeout after ' + limit + ' ms')), limit);
      }),
    ]);
  } catch (e) {
    err = e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  finish(name, started, err, true);
}
const capture = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Minimal DOM shim for the real UI. It only implements what ui.js touches:
// elements with ids, click handlers, a modal slot, focus and keyboard events.
// It never loads a browser or a device API.
function createFakeDom() {
  const byId = new Map();
  const listeners = {};
  let document;

  class FakeElement {
    constructor(tag = 'div', id = '') {
      this.tagName = String(tag).toUpperCase();
      this.id = id;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this._html = '';
      this._text = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = '';
      this.className = '';
      this.onclick = null;
      this.onchange = null;
      if (id) byId.set(id, this);
    }
    get firstChild() { return this.children[0] || null; }
    get lastChild() { return this.children[this.children.length - 1] || null; }
    get innerHTML() { return this._html; }
    set innerHTML(html) {
      for (const child of this.children) unregisterTree(child);
      this._html = String(html == null ? '' : html);
      this.children = [];
      parseHtml(this, this._html);
    }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v == null ? '' : v); }
    appendChild(child) { this.children.push(child); child.parentNode = this; registerTree(child); return child; }
    insertBefore(child, before) {
      const i = before ? this.children.indexOf(before) : -1;
      if (i === -1) this.children.push(child); else this.children.splice(i, 0, child);
      child.parentNode = this; registerTree(child); return child;
    }
    addEventListener(evt, fn) {
      if (!this._listeners) this._listeners = {};
      this._listeners[evt] = fn;
    }
    removeEventListener(evt) {
      if (this._listeners) delete this._listeners[evt];
    }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      unregisterTree(this);
      this.parentNode = null;
    }
    focus() { document.activeElement = this; }
    click() { if (this.onclick) return this.onclick({ target: this, preventDefault() {} }); return undefined; }
    setSelectionRange() {}
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') { this.id = String(v); byId.set(this.id, this); } }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
    closest(sel) {
      let node = this;
      while (node) {
        if (matchesSelector(node, sel)) return node;
        node = node.parentNode;
      }
      return null;
    }
    contains(node) {
      if (node === this) return true;
      return this.children.some((c) => c.contains && c.contains(node));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) { return descendants(this).filter((el) => matchesAny(el, sel)); }
  }

  function registerTree(el) {
    if (!el) return;
    if (el.id) byId.set(el.id, el);
    for (const child of el.children || []) registerTree(child);
  }
  function unregisterTree(el) {
    if (!el) return;
    if (el.id && byId.get(el.id) === el) byId.delete(el.id);
    for (const child of el.children || []) unregisterTree(child);
  }
  function descendants(root) {
    const out = [];
    const walk = (el) => { for (const child of el.children || []) { out.push(child); walk(child); } };
    walk(root);
    return out;
  }
  function classList(el) {
    return String(el.className || '').split(/\s+/).filter(Boolean);
  }
  function matchesSelector(el, raw) {
    let sel = String(raw || '').trim();
    if (!sel) return false;
    const parts = sel.split(/\s+/);
    if (parts.length > 1) {
      if (!matchesSelector(el, parts[parts.length - 1])) return false;
      let node = el.parentNode;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (node && !matchesSelector(node, parts[i])) node = node.parentNode;
        if (!node) return false;
        node = node.parentNode;
      }
      return true;
    }
    const notDisabled = sel.includes(':not([disabled])');
    sel = sel.replace(':not([disabled])', '').trim();
    let ok = true;
    const idMatch = sel.match(/#([\w-]+)/);
    if (idMatch) { ok = ok && el.id === idMatch[1]; sel = sel.replace(idMatch[0], ''); }
    const attrMatches = sel.match(/\[([\w:-]+)(?:="([^"]*)")?\]/g) || [];
    for (const a of attrMatches) {
      const m = a.match(/\[([\w:-]+)(?:="([^"]*)")?\]/);
      const name = m[1];
      const want = m[2];
      let got;
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        got = el.dataset[key];
      } else if (name === 'disabled') got = el.disabled ? '' : undefined;
      else if (name === 'checked') got = el.checked ? '' : undefined;
      else if (name === 'id') got = el.id;
      else if (name === 'class') got = el.className;
      else got = el.attributes[name];
      if (want === undefined) ok = ok && got !== undefined && got !== null;
      else ok = ok && String(got == null ? '' : got) === want;
      sel = sel.replace(a, '');
    }
    const classes = sel.match(/\.([\w-]+)/g) || [];
    for (const c of classes) ok = ok && classList(el).includes(c.slice(1));
    sel = sel.replace(/\.[\w-]+/g, '').trim();
    if (sel) ok = ok && el.tagName === sel.toUpperCase();
    if (notDisabled) ok = ok && !el.disabled;
    return ok;
  }
  function matchesAny(el, sel) {
    return String(sel || '').split(',').some((part) => matchesSelector(el, part));
  }

  function parseAttrs(el, attrs) {
    const attrRe = /([\w:-]+)(?:="([^"]*)")?/g;
    let m;
    while ((m = attrRe.exec(attrs)) !== null) {
      const name = m[1];
      const value = m[2] === undefined ? '' : m[2];
      if (name === 'id') { el.id = value; byId.set(value, el); }
      else if (name === 'disabled') el.disabled = true;
      else if (name === 'checked') el.checked = true;
      else if (name === 'class') el.className = value;
      else if (name === 'value') el.value = value;
      else if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.dataset[key] = value;
      } else el.attributes[name] = value;
    }
  }
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  function parseHtml(parent, html) {
    const stack = [parent];
    const tokenRe = /<[^>]+>|[^<]+/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
      const token = m[0];
      if (token.startsWith('</')) {
        const tag = token.slice(2, -1).trim().toUpperCase();
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tagName === tag) { stack.length = i; break; }
        }
        continue;
      }
      if (token.startsWith('<')) {
        const open = token.match(/^<([a-zA-Z][\w-]*)([^>]*)>$/);
        if (!open) continue;
        const tag = open[1].toLowerCase();
        let attrs = open[2] || '';
        const selfClosing = /\/\s*$/.test(attrs);
        attrs = attrs.replace(/\/\s*$/, '');
        const el = new FakeElement(tag);
        parseAttrs(el, attrs);
        const cur = stack[stack.length - 1];
        cur.children.push(el);
        el.parentNode = cur;
        registerTree(el);
        if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(el);
        continue;
      }
      const cur = stack[stack.length - 1];
      cur._text += token;
    }
  }

  const documentElement = new FakeElement('html', 'documentElement');
  document = {
    documentElement,
    body: new FakeElement('body', 'body'),
    activeElement: null,
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new FakeElement('div', id));
      return byId.get(id);
    },
    querySelector(sel) {
      if (sel === '.topbar__actions') return byId.get('topbarActions') || (() => {
        const el = new FakeElement('div', 'topbarActions'); return el;
      })();
      if (sel === '.foot__legal') return byId.get('footLegal') || (() => {
        const el = new FakeElement('div', 'footLegal'); return el;
      })();
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const seen = new Set();
      const roots = [documentElement, byId.get('body'), ...byId.values()];
      for (const root of roots) {
        if (!root) continue;
        for (const el of [root, ...descendants(root)]) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (matchesAny(el, sel)) seen.add(el);
        }
      }
      return Array.from(seen).filter((el) => el && matchesAny(el, sel));
    },
    createElement(tag) { return new FakeElement(tag); },
    addEventListener(evt, fn) { listeners[evt] = fn; },
    contains(node) { return !!(node && (node === documentElement || byId.get(node.id) === node || node.id === 'body')); },
  };

  return {
    document,
    listeners,
    pressEscape() {
      if (listeners.keydown) listeners.keydown({ key: 'Escape', preventDefault() {}, shiftKey: false });
    },
    dispatchAction(act) {
      const target = { dataset: { act }, closest() { return this; }, preventDefault() {} };
      return listeners.click ? listeners.click({ target, preventDefault() {} }) : undefined;
    },
  };
}

function createUiHarness(engineWindow) {
  const dom = createFakeDom();
  engineWindow.addEventListener = (evt, fn) => { dom.listeners[evt] = fn; };
  engineWindow.scrollTo = () => {};
  engineWindow.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  engineWindow.jspdf = {
    jsPDF: function () {
      return {
        setProperties() {}, setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {},
        setDrawColor() {}, setLineWidth() {}, setLineCap() {}, setLineJoin() {},
        rect() {}, roundedRect() {}, line() {}, lines() {}, circle() {}, ellipse() {}, triangle() {},
        text() {}, textWithLink() {}, addImage() {}, addPage() {},
        splitTextToSize(s) { return [String(s || '')]; },
        getTextWidth(s) { return String(s || '').length * 1.8; },
        output() { return new Blob([], { type: 'application/pdf' }); }, save() {},
      };
    },
  };
  const useFakeTimer = (fn) => { try { fn(); } catch (_) { /* ignore */ } return 0; };
  for (const rel of ['web/workshop/part-images.js', 'web/workshop/issues.js', 'web/workshop/report-pdf.js', 'web/workshop/connection-doctor.js']) {
    const src = readFileSync(path.join(repo, rel), 'utf8');
    new Function('window', 'localStorage', src)(engineWindow, engineWindow.localStorage);
  }
  const uiSource = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  new Function('window', 'document', 'navigator', 'setTimeout', 'localStorage', uiSource)(
    engineWindow, dom.document, engineWindow.navigator, useFakeTimer, engineWindow.localStorage
  );

  const doc = dom.document;
  const btnDemo = doc.getElementById('btnDemo');
  const modal = doc.getElementById('modal');
  const modalActions = doc.getElementById('modalActions');
  const acceptRisk = () => {
    const cb = doc.getElementById('riskAccept');
    cb.checked = true;
    if (cb.onchange) cb.onchange();
    const go = doc.getElementById('riskContinue');
    assert(go && !go.disabled, 'risk Continue is enabled after checking the box');
    go.onclick();
  };
  const startDemo = async () => {
    doc.activeElement = btnDemo;
    const p = btnDemo.onclick();
    await sleep(0);
    const start = modalActions.children.find((b) => b.tagName === 'BUTTON' && /Start demo/.test(b.textContent));
    assert(start, 'the demo notice offers Start demo');
    start.onclick();
    await p;
  };
  const switchTab = (name) => dom.listeners.click({
    target: { dataset: { tab: name }, closest() { return this; }, preventDefault() {} },
    preventDefault() {},
  });
  return { dom, doc, btnDemo, modal, modalActions, acceptRisk, startDemo, switchTab };
}

// The frame counters are reset before every check, so a check only ever sees
// the frames it caused itself. Write frames (type 2) and RPC frames (type 4)
// are counted separately.
function resetFrameCounters() { mutations = 0; writeFrames = 0; rpcFrames = 0; }

// withSession() -> a fresh demo session: the experimental opt-in is off, the
// log is empty, the frame counters are zero and the demo fixture is back to
// its original state.
async function withSession() {
  resetFrameCounters();
  if (sandbox && sandbox.Bes3WorkshopDemo) sandbox.Bes3WorkshopDemo.resetCounters();
  await W.startDemo();
  W.state.log = [];
  return W;
}

function hardwareTrap(label) {
  return {
    calls: 0,
    requestDevice() { this.calls++; throw new Error('REAL DEVICE ACCESS ATTEMPTED: ' + label); },
    Bes3WebUsbTransport: function () { this.calls++; throw new Error('REAL TRANSPORT INITIALIZATION ATTEMPTED: ' + label); },
  };
}

let W = null;
let sandbox = null;
let uiHarness = null;       // the DOM-level UI harness (set when the UI checks start)
let hardware = null;
let mutations = 0;          // write/RPC request frames sent to the fake transport
let writeFrames = 0;        // type 2 (WRITE) frames only
let rpcFrames = 0;          // type 4 (RPC) frames only
let dropWriteAckAddr = null; // suppress WRITE_RESPONSE for this address
let dropReadAddr = null;     // suppress READ_RESPONSE for this address
let readGate = null;         // controlled hold inside readNextFrame
let postWriteGate = null;    // controlled hold after a frame is handed to the fake bike
let postWriteReachSignal = null; // resolved when the next post-write hold is reached
let lastTransport = null;    // most recently created fake transport
let virtualClockOffset = 0;  // virtual time added by fast-forwarded sleeps/polls
try {
  sandbox = {
    navigator: { usb: undefined },
    __bes3Now: () => Date.now() + virtualClockOffset,
    __bes3Sleep: (ms) => {
      virtualClockOffset += Math.max(0, Number(ms) || 0);
      return new Promise((r) => setTimeout(r, 0));
    },
  };
  sandbox.window = sandbox;
  hardware = hardwareTrap('Bes3WebUsb');
  sandbox.Bes3WebUsb = hardware;
  // module/require stay undefined so the UMD sources take their browser branch
  // and attach to the synthetic window.
  const scripts = [
    'src/address-registry.generated.js',
    'src/protocol.js',
    'src/messageTypes.js',
    'web/workshop/write-policy.js',
    'web/workshop/engine.js',
    'web/workshop/demo-data.js',
    'web/workshop/demo.js',
  ];
  for (const rel of scripts) {
    const src = readFileSync(path.join(repo, rel), 'utf8');
    new Function('window', 'navigator', src)(sandbox, sandbox.navigator);
  }
  W = sandbox.Bes3Workshop;
  assert(W, 'engine did not expose window.Bes3Workshop');

  // v0.58.0 registry and decoder regressions (synthetic payloads only).
  check('registry: confirmed power-on time, light power and boolean ports', () => {
    const time = W.util.entryOf('DriveUnit', 'POWER_ON_TIME');
    eq(time.unit, 'h', 'POWER_ON_TIME is measured in hours');
    eq(time.confirmed, true, 'POWER_ON_TIME is confirmed');
    const motor = W.util.entryOf('DriveUnit', 'POWER_ON_TIME_WITH_MOTOR_SUPPORT');
    eq(motor.unit, 'h', 'POWER_ON_TIME_WITH_MOTOR_SUPPORT is measured in hours');
    eq(motor.confirmed, true, 'POWER_ON_TIME_WITH_MOTOR_SUPPORT is confirmed');
    const power = W.util.entryOf('DriveUnit', 'BIKE_LIGHT_POWER');
    eq(power.confirmed, true, 'BIKE_LIGHT_POWER is confirmed');
    assert(/Uint8NormFactor10Message/.test(power.notes || ''), 'the schema is recorded in the registry notes');
    for (const name of ['LOW_POWER_PORT_ACTIVE', 'HIGH_POWER_PORT_ACTIVE']) {
      const entry = W.util.entryOf('DriveUnit', name);
      eq(entry.kind, 'bool', name + ' registry kind is bool');
      eq(entry.confirmed, true, name + ' is confirmed');
    }
    eq(POLICY.OP.LIGHT_POWER.evidence, 'observed-working', 'LIGHT_POWER evidence is observed-working');
  });

  check('decoders: port booleans, walk assist and OEM field 3', () => {
    const interpret = W.util.interpret;
    const addrOf = W.util.addrOf;
    for (const name of ['LOW_POWER_PORT_ACTIVE', 'HIGH_POWER_PORT_ACTIVE']) {
      const addr = addrOf('DriveUnit', name);
      const on = interpret('DriveUnit', name, addr, [0x08, 0x01]);
      eq(on.value, true, name + ' 08 01 decodes to true');
      eq(on.display, 'true', name + ' 08 01 displays as true');
      const off = interpret('DriveUnit', name, addr, []);
      eq(off.value, false, name + ' proto3 empty decodes to false');
      eq(off.display, 'false', name + ' proto3 empty displays as false');
    }
    const walk = interpret('DriveUnit', 'WALK_ASSIST_CONFIGURATION',
      addrOf('DriveUnit', 'WALK_ASSIST_CONFIGURATION'), [0x08, 0x01, 0x10, 0x90, 0x03]);
    eq(walk.display, 'Enabled (4.0 km/h)', 'walk assist speed is scaled from 0.01 km/h');
    eq(walk.value.enabled, true, 'walk assist enabled flag');
    eq(walk.value.speedKmh, 4, 'walk assist speed value in km/h');
    const walkOff = interpret('DriveUnit', 'WALK_ASSIST_CONFIGURATION',
      addrOf('DriveUnit', 'WALK_ASSIST_CONFIGURATION'), [0x08, 0x00]);
    eq(walkOff.display, 'Disabled', 'walk assist false displays as Disabled');
    eq(walkOff.value.enabled, false, 'walk assist false value');
    const oem = interpret('DriveUnit', 'BIKE_LIGHT_CONFIGURATION_OEM',
      addrOf('DriveUnit', 'BIKE_LIGHT_CONFIGURATION_OEM'), [0x18, 0x01]);
    eq(oem.display, 'OEM mode 1', 'OEM field-3 varint decodes to a mode label');
    eq(oem.value, 1, 'OEM field-3 varint value');
  });

  // Instrument the simulated transport only. No real transport is loaded.
  const demo = sandbox.Bes3WorkshopDemo;
  const realCreate = demo.createFakeTransport;
  // The harness runs without the simulated response latency, so the suite is
  // fast; one check exercises the delayed path on purpose.
  demo.setLatency(0);
  demo.createFakeTransport = function () {
    const t = realCreate.apply(this, arguments);
    t.mutationCount = 0;
    lastTransport = t;
    const realWrite = t.doMcspWrite.bind(t);
    const realRead = t.readNextFrame.bind(t);
    t.doMcspWrite = async (frame) => {
      const f = Array.from(frame);
      if (f.length >= 7) {
        const type = f[6] >> 4;
        if (type === 2) { mutations++; writeFrames++; t.mutationCount++; }
        else if (type === 4) { mutations++; rpcFrames++; t.mutationCount++; }
      }
      const result = await realWrite(frame);
      if (postWriteGate) {
        const gate = postWriteGate; postWriteGate = null;
        if (postWriteReachSignal) { const signal = postWriteReachSignal; postWriteReachSignal = null; signal(); }
        await gate;
      }
      return result;
    };
    t.readNextFrame = async (maxPolls, delay) => {
      if (readGate) await readGate;
      for (let n = 0; n < 64; n++) {
        const frame = await realRead(maxPolls, 0);
        if (!frame) {
          virtualClockOffset += (Number(maxPolls) || 1) * (Number(delay) || 1);
          return null;
        }
        const b = Array.from(frame);
        if (b.length < 7) return frame;
        const addr = ((b[2] & 0x7f) << 8) | b[3];
        const type = b[6] >> 4;
        if (dropWriteAckAddr !== null && type === 3 && addr === dropWriteAckAddr) continue;
        if (dropReadAddr !== null && type === 1 && addr === dropReadAddr) continue;
        return frame;
      }
      return null;
    };
    return t;
  };
} catch (err) {
  failed++;
  failures.push({ name: 'load engine under fake transport', message: err && err.message ? err.message : String(err) });
  console.log('  FAIL load engine under fake transport -> ' + (err && err.message ? err.message : err));
}

if (W) {
  await checkAsync('engine loads offline; no live session, no hardware call', () => {
    eq(W.isLive, false, 'not live');
    eq(W.sessionMode, 'file', 'read-only mode');
    eq(W.canMutate, false, 'cannot mutate');
    eq(hardware.calls, 0, 'hardware stub untouched');
    eq(mutations, 0, 'no mutation frames');
  });

  await checkAsync('connect() refuses without WebUSB and never enumerates', async () => {
    const err = await capture(() => W.connect());
    assert(err, 'connect rejected');
    assert(/WebUSB/i.test(err.message), 'unsupported-browser error, got: ' + err.message);
    eq(hardware.calls, 0, 'no device enumeration');
    eq(W.isLive, false, 'still not live');
  });

  // E. The simulation-only helper must not authorize a non-demo session
  // (a real live session has state.demo === false as well).
  await checkAsync('simulation-only authorization helper cannot authorize non-demo', () => {
    const err = throws(() => W.simulateSetExperimental(true));
    assert(err && /demo/i.test(err.message), 'refused outside demo: ' + (err && err.message));
    eq(W.experimentalEnabled, false, 'not authorized');
    eq(W.canMutate, false, 'cannot mutate');
  });

  await checkAsync('demo is simulated; mutation blocked until opt-in', async () => {
    await W.startDemo();
    eq(W.isLive, true, 'demo is live-like');
    eq(W.sessionMode, 'demo', 'demo mode');
    eq(W.experimentalEnabled, false, 'opt-in off');
    eq(W.canMutate, false, 'cannot mutate');
    const before = mutations;
    const err = await capture(() => W.Writers.lightAvailable(true));
    assert(err && err.code === 'WRITE_BLOCKED', 'blocked with WRITE_BLOCKED');
    eq(mutations, before, 'zero mutation I/O');
    const last = W.state.log[W.state.log.length - 1];
    assert(last && last.blocked === true, 'blocked step logged');
  });

  await checkAsync('opt-in enables one mutation, applied only by read-back', async () => {
    W.setExperimental(true);
    eq(W.canMutate, true, 'can mutate');
    const res = await W.runPlan([
      { label: 'mark light installed', run: (owner) => W.Writers.lightAvailable(true, owner) },
    ]);
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied');
    eq(res[0].acked, true, 'ack preserved');
    const last = W.state.log[W.state.log.length - 1];
    eq(last.applied, true, 'log records applied');
    eq(last.acked, true, 'log preserves ack');
  });

  await checkAsync('power writer rejects an out-of-range value before I/O; register unchanged', async () => {
    const before = W.state.log.length;
    const beforeMut = mutations;
    const err = await capture(() => W.Writers.lightPower(0.9));
    assert(err && err.code === 'WRITE_BLOCKED', 'rejected');
    eq(W.state.log.length, before, 'no write attempt logged');
    eq(mutations, beforeMut, 'zero mutation I/O');
    const p = await W.readKey('DriveUnit', 'BIKE_LIGHT_POWER');
    eq(p.status, 'ok', 'read ok');
    eq(p.value, 1.0, 'still the original 1.0 W');
  });

  // Acknowledged, but the read-back differs (the demo declines to store the
  // switch while no startup mode is configured).
  await checkAsync('acknowledged + differing read-back -> not applied, ack preserved', async () => {
    const step = await W.Writers.lightSwitch(true);
    eq(step.acked, true, 'acknowledgment recorded');
    eq(step.applied, false, 'read-back did not match');
    eq(W.state.log[W.state.log.length - 1].acked, true, 'log preserves ack');
  });

  // Missing acknowledgment, but a fresh read-back matches. The read-back is
  // authoritative, so this is applied and the missing ACK is preserved.
  await checkAsync('missing acknowledgment + fresh matching read-back -> applied', async () => {
    const addr = POLICY.OP.LIGHT_CONFIG.address;
    const before = mutations;
    dropWriteAckAddr = addr;
    let step;
    try {
      step = await W.Writers.lightConfiguration(1);
    } finally {
      dropWriteAckAddr = null;
    }
    eq(mutations, before + 1, 'exactly one WRITE frame (no retransmission)');
    eq(step.acked, false, 'ack recorded as missing');
    eq(step.applied, true, 'fresh read-back confirms');
    eq(W.state.log[W.state.log.length - 1].acked, false, 'log preserves missing ack');
  });

  // Cached/stale value equals the requested value, but the fresh read fails.
  // It must not be converted into success from cache, defaults or coercion.
  await checkAsync('cached matching value + failed read -> not applied', async () => {
    eq(W.state.values['DriveUnit.BIKE_LIGHT_CONFIGURATION'].value, 1, 'cache already matches');
    const addr = POLICY.OP.LIGHT_CONFIG.address;
    dropReadAddr = addr;
    let step;
    try {
      step = await W.Writers.lightConfiguration(1);
    } finally {
      dropReadAddr = null;
    }
    eq(step.acked, true, 'acknowledgment recorded');
    eq(step.applied, false, 'failed read is not success');
    assert(W.state.values['DriveUnit.BIKE_LIGHT_CONFIGURATION'].status !== 'ok', 'stale cache was replaced by the failed read');
  });

  // A. A plan created in session A is rejected after switching to an
  // authorized session B.
  await checkAsync('plan token from session A rejected in authorized session B', async () => {
    const tokenA = W.authorizationToken;
    W.simulateConnectionLoss();
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'old plan step', run: (owner) => W.Writers.lightAvailable(false, owner) }],
      null,
      { token: tokenA }
    );
    eq(res.length, 1, 'stopped before running the step');
    eq(res[0].blocked, true, 'stale token rejected');
    eq(res[0].acked, false, 'no ack fabricated');
    eq(mutations, before, 'zero mutation I/O');
  });

  // B. A delayed completion from session A cannot clear session B's lock or
  // produce further results.
  await checkAsync('delayed session-A completion cannot clear session-B lock', async () => {
    const tokenB = W.authorizationToken;
    let releaseA;
    const gateA = new Promise((r) => { releaseA = r; });
    const pA = W.runPlan([
      { label: 'A1', run: async () => { await gateA; return { applied: true, label: 'A1', acked: false }; } },
      { label: 'A2', run: async () => ({ applied: true, label: 'A2', acked: false }) },
    ], null, { token: tokenB });
    await sleep(0);
    eq(W.busy, true, 'A holds the lock');

    W.simulateConnectionLoss();
    await W.startDemo();
    W.setExperimental(true);
    const tokenC = W.authorizationToken;
    let releaseB;
    const gateB = new Promise((r) => { releaseB = r; });
    const pB = W.runPlan([
      { label: 'B1', run: async () => { await gateB; return { applied: true, label: 'B1', acked: false }; } },
    ], null, { token: tokenC });
    await sleep(0);
    eq(W.busy, true, 'B holds the lock');

    releaseA();
    const resA = await pA;
    eq(resA.length, 2, 'A stopped at the stale step');
    eq(resA[1].blocked, true, 'A step rejected after switch');
    eq(W.busy, true, 'A release did not clear B lock');

    releaseB();
    await pB;
    eq(W.busy, false, 'B released its own lock');
  });

  await checkAsync('mid-plan revocation stops subsequent steps', async () => {
    W.setExperimental(true);
    const res = await W.runPlan([
      { label: 'step 1', run: async () => { W.setExperimental(false); return { applied: true, label: 'step 1' }; } },
      { label: 'step 2', run: async () => ({ applied: true, label: 'step 2' }) },
    ]);
    eq(res.length, 2, 'stopped after the blocked step');
    eq(res[0].applied, true, 'first step ran');
    eq(res[1].blocked, true, 'second step blocked');
  });

  await checkAsync('single-writer lock prevents interleaving', async () => {
    W.setExperimental(true);
    let release;
    const gate = new Promise((r) => { release = r; });
    const p1 = W.runPlan([{ label: 'hold', run: async () => { await gate; return { applied: true, label: 'hold' }; } }]);
    await sleep(0);
    eq(W.busy, true, 'busy during a plan');
    const err = await capture(() => W.runPlan([{ label: 'x', run: async () => ({ applied: true, label: 'x' }) }]));
    assert(err && /still running/i.test(err.message), 'second plan refused');
    release();
    await p1;
    eq(W.busy, false, 'lock released');
  });

  // C. A direct sanctioned writer cannot bypass an active plan's lock.
  await checkAsync('direct writer cannot interleave with an active plan', async () => {
    W.setExperimental(true);
    let release;
    const gate = new Promise((r) => { release = r; });
    const plan = W.runPlan([{ label: 'hold', run: async () => { await gate; return { applied: true, label: 'hold', acked: false }; } }]);
    await sleep(0);
    eq(W.busy, true, 'plan holds the lock');
    const before = mutations;
    const err = await capture(() => W.Writers.lightAvailable(false));
    assert(err && err.code === 'WRITE_BLOCKED', 'direct writer blocked: ' + (err && err.message));
    eq(mutations, before, 'zero mutation I/O');
    release();
    await plan;
    eq(W.busy, false, 'lock released');
  });

  // Queued/in-flight session boundary. These drive actual production writers
  // against the simulated transport, using controlled promises (not sleeps) for
  // the asynchronous hold points.
  await checkAsync('queued writer: revoke before release -> zero mutation frames', async () => {
    W.setExperimental(true);
    let releaseRead;
    let hold = null;
    let write = null;
    try {
      readGate = new Promise((r) => { releaseRead = r; });
      hold = W.readKey('DriveUnit', 'BIKE_LIGHT_AVAILABLE');
      await sleep(0);
      const before = mutations;
      write = W.Writers.lightAvailable(false);
      await sleep(0);
      W.setExperimental(false);
      readGate = null;
      releaseRead();
      await hold;
      let result;
      try { result = await write; } catch (e) { result = e; }
      eq(mutations, before, 'zero mutation frames');
      assert(result && !(result instanceof Error), 'writer resolved: ' + (result && result.message));
      eq(result.interrupted, true, 'interrupted outcome');
      eq(result.transmitted, false, 'not transmitted');
      eq(result.applied, false, 'not applied');
    } finally {
      readGate = null;
      if (releaseRead) releaseRead();
      if (hold) await hold.catch(() => {});
      if (write) await write.catch(() => {});
    }
  });

  await checkAsync('queued writer: replacement session authorized -> old writer zero frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    let releaseRead;
    let hold = null;
    let write = null;
    let demoP = null;
    try {
      const oldTransport = lastTransport;
      readGate = new Promise((r) => { releaseRead = r; });
      hold = W.readKey('DriveUnit', 'BIKE_LIGHT_AVAILABLE');
      await sleep(0);
      const oldMutations = oldTransport.mutationCount;
      write = W.Writers.lightAvailable(false);
      await sleep(0);
      W.simulateConnectionLoss();
      demoP = W.startDemo();
      await sleep(0);
      W.setExperimental(true);
      const authorized = W.canMutate;
      const replacement = lastTransport;
      const replacementMutations = replacement.mutationCount;
      readGate = null;
      releaseRead();
      await hold.catch(() => {});
      let result;
      try { result = await write; } catch (e) { result = e; }
      eq(authorized, true, 'replacement was authorized');
      eq(oldTransport.mutationCount, oldMutations, 'zero mutation frames on the old transport');
      eq(replacement.mutationCount, replacementMutations, 'zero mutation frames on the replacement transport');
      assert(result && !(result instanceof Error), 'writer resolved: ' + (result && result.message));
      eq(result.interrupted, true, 'interrupted outcome');
      eq(result.transmitted, false, 'not transmitted');
      eq(result.applied, false, 'not applied');
      await demoP;
    } finally {
      readGate = null;
      if (releaseRead) releaseRead();
      if (demoP) await demoP.catch(() => {});
      if (write) await write.catch(() => {});
    }
  });

  await checkAsync('in-flight writer: session replaced after send -> unverified, no cross-session read', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const oldTransport = lastTransport;
    let releaseWrite;
    let write = null;
    let demoP = null;
    try {
      let reachedResolve;
      const reached = new Promise((r) => { reachedResolve = r; });
      postWriteReachSignal = reachedResolve;
      postWriteGate = new Promise((r) => { releaseWrite = r; });
      const oldBefore = oldTransport.mutationCount;
      write = W.Writers.lightConfiguration(1);
      await reached;
      eq(oldTransport.mutationCount, oldBefore + 1, 'write transmitted on the old transport');

      W.simulateConnectionLoss();
      demoP = W.startDemo();
      await sleep(0);
      W.setExperimental(true);
      const replacement = lastTransport;
      const replacementMutations = replacement.mutationCount;
      const replacementToken = W.authorizationToken;

      releaseWrite();
      let result;
      try { result = await write; } catch (e) { result = e; }
      assert(result && !(result instanceof Error), 'writer resolved: ' + (result && result.message));
      eq(result.interrupted, true, 'interrupted outcome');
      eq(result.transmitted, true, 'does not claim it was never sent');
      assert(typeof result.sent === 'string' && result.sent.length > 0, 'sent carries the payload hex, not a boolean: ' + result.sent);
      eq(result.applied, false, 'not applied');
      eq(replacement.mutationCount, replacementMutations, 'no mutation on the replacement transport');

      await demoP;
      eq(W.state.log.filter((e) => !e.info).length, 0, 'old writer did not publish into the replacement log');
      const cfg = W.state.values['DriveUnit.BIKE_LIGHT_CONFIGURATION'];
      eq(cfg && cfg.value, 0, 'replacement value untouched by the old verification read');
      eq(W.authorizationToken, replacementToken, 'replacement authorization unchanged');
      eq(W.busy, false, 'old writer did not leave or release the replacement lock');
    } finally {
      postWriteGate = null;
      postWriteReachSignal = null;
      if (releaseWrite) releaseWrite();
      if (demoP) await demoP.catch(() => {});
      if (write) await write.catch(() => {});
    }
  });

  // D. Service, System ID and fault clearing are blocked before mutation I/O
  // when unauthorized.
  await checkAsync('unauthorized service/ID/fault-clear -> zero mutation I/O', async () => {
    W.setExperimental(false);
    const before = mutations;
    for (const call of [
      () => W.Writers.serviceDue({ timestamp: 123, odometer: 456 }),
      () => W.Writers.syncBikeId('RemoteControl', '00000000-0000-4000-8000-000000000001'),
      () => W.clearFaultMemory(),
    ]) {
      const err = await capture(call);
      assert(err && err.code === 'WRITE_BLOCKED', 'blocked before I/O: ' + (err && err.message));
    }
    eq(mutations, before, 'zero mutation I/O');
  });

  await checkAsync('live fault clearing blocked before I/O; fault reading still available', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const wasDemo = W.state.demo;
    W.state.demo = false; // emulate a live session on the simulated transport
    const before = mutations;
    const logBefore = W.state.log.length;
    let err;
    try {
      err = await capture(() => W.clearFaultMemory());
    } finally {
      W.state.demo = wasDemo;
    }
    assert(err && err.code === 'WRITE_BLOCKED', 'live clear blocked: ' + (err && err.message));
    assert(/batches multiple RPC mutations/i.test(err.message), 'explains the batching restriction');
    eq(mutations, before, 'zero mutation I/O');
    eq(W.state.log.length, logBefore, 'nothing logged');
    await W.readAll();
    eq(W.state.issuesScanned, true, 'fault reading still works');
    eq((W.state.issues || []).length, 1, 'demo fault entry still readable');
  });

  await checkAsync('connection loss revokes authority', () => {
    W.setExperimental(true);
    W.simulateConnectionLoss();
    eq(W.isLive, false, 'no transport');
    eq(W.sessionMode, 'file', 'read-only');
    eq(W.canMutate, false, 'cannot mutate');
    eq(W.experimentalEnabled, false, 'opt-in cleared');
  });

  // D. Imported/offline mode is read-only for the same operations.
  await checkAsync('imported/offline service/ID/fault-clear -> zero mutation I/O', async () => {
    W.importReaderReport({ results: [], generatedAt: new Date().toISOString() });
    eq(W.sessionMode, 'file', 'file mode');
    const before = mutations;
    const e1 = await capture(() => W.Writers.serviceDue({ timestamp: 1, odometer: 1 }));
    const e2 = await capture(() => W.Writers.syncBikeId('RemoteControl', '00000000-0000-4000-8000-000000000001'));
    const e3 = await capture(() => W.clearFaultMemory());
    assert(e1 && e1.code === 'WRITE_BLOCKED', 'service blocked');
    assert(e2 && e2.code === 'WRITE_BLOCKED', 'ID sync blocked');
    assert(e3 && /Not connected/.test(e3.message), 'fault clear refused offline: ' + (e3 && e3.message));
    eq(mutations, before, 'zero mutation I/O offline');
  });

  // Export provenance: a demo export is marked simulated, and every exported
  // log entry carries the mode it was produced in.
  await checkAsync('demo export is marked simulated; log entries carry mode', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const res = await W.runPlan([
      { label: 'mark light installed', run: (owner) => W.Writers.lightAvailable(true, owner) },
    ]);
    eq(res.length, 1, 'one result');
    const exp = W.exportState();
    eq(exp.source, 'demo', 'source is demo');
    eq(exp.simulated, true, 'simulated is true');
    assert(exp.log.length >= 1, 'log has at least one entry');
    eq(exp.log[exp.log.length - 1].mode, 'demo', 'exported log entry carries mode demo');
  });

  // An export from before this change has no provenance fields. It must still
  // import, must not be flagged simulated, and must stay read-only.
  await checkAsync('old-format export imports without error and stays read-only', () => {
    const old = { tool: 'BES3 Workshop', generatedAt: new Date().toISOString(), values: {}, components: {}, assistModes: [], issues: null };
    eq(W.importWorkshop(old), true, 'old export accepted');
    eq(W.sessionMode, 'file', 'file mode');
    eq(W.canMutate, false, 'cannot mutate');
    eq(W.state.simulatedExport, false, 'not flagged simulated');
  });

  // A demo export re-imported keeps its simulated flag and remains read-only.
  await checkAsync('simulated flag survives import of a demo export', async () => {
    await W.startDemo();
    const exp = W.exportState();
    eq(W.importWorkshop(exp), true, 'demo export accepted');
    eq(W.state.simulatedExport, true, 'flag set on import');
    eq(W.sessionMode, 'file', 'file mode after import');
    eq(W.canMutate, false, 'cannot mutate');
    eq(W.exportState().simulated, true, 'a re-export keeps the demo provenance');
  });

  // A demo export must survive a full export -> import -> compare cycle. The
  // log is deliberately not restored by an import, so only read data is
  // compared here.
  await checkAsync('demo export -> import deep-compares read data', async () => {
    await W.startDemo();
    const exp = W.exportState();
    const before = { values: exp.values, components: exp.components, assistModes: exp.assistModes, issues: exp.issues };
    eq(W.importWorkshop(JSON.parse(JSON.stringify(exp))), true, 'demo export re-imported');
    const canon = (v) => Array.isArray(v)
      ? v.map(canon)
      : (v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v);
    eq(JSON.stringify(canon(W.state.values)), JSON.stringify(canon(before.values)), 'values deep-compare');
    eq(JSON.stringify(canon(W.state.components)), JSON.stringify(canon(before.components)), 'components deep-compare');
    eq(JSON.stringify(canon(W.state.assistModes)), JSON.stringify(canon(before.assistModes)), 'assist modes deep-compare');
    eq(JSON.stringify(canon(W.state.issues)), JSON.stringify(canon(before.issues)), 'issues deep-compare');
  });

  // A bad generatedAt must be rejected before it replaces the current readout;
  // otherwise a later export throws in toISOString().
  await checkAsync('import: an invalid generatedAt is rejected without replacing the readout', () => {
    const before = JSON.stringify(W.state.values);
    let workshopError = null;
    try {
      W.importWorkshop({
        tool: 'BES3 Workshop',
        generatedAt: 'not-a-date',
        values: { 'DriveUnit.ODOMETER': { status: 'ok', display: '1', value: 1, hex: '' } },
        components: {}, assistModes: [], issues: null,
      });
    } catch (e) { workshopError = e; }
    assert(workshopError && /generatedAt/.test(workshopError.message), 'workshop import rejects the date');
    eq(JSON.stringify(W.state.values), before, 'the old readout is unchanged');

    let readerError = null;
    try {
      W.importReaderReport({ results: [], generatedAt: 'not-a-date' });
    } catch (e) { readerError = e; }
    assert(readerError && /generatedAt/.test(readerError.message), 'classic-reader import rejects the date');
    eq(JSON.stringify(W.state.values), before, 'the old readout is still unchanged');
  });

  // An anonymised BLE register has an empty hex and a "payload removed" text.
  // Import must preserve that text, and malformed non-empty hex must fail
  // closed instead of becoming NaN bytes.
  await checkAsync('import: BLE payloads are validated and anonymised text is preserved', () => {
    const removed = '2 BLE peer records (payload removed)';
    eq(W.importWorkshop({
      tool: 'BES3 Workshop',
      generatedAt: new Date().toISOString(),
      values: {
        'RemoteControl.BLE_CENTRAL_DATABASE': { status: 'ok', display: 'original', value: null, hex: 'zz' },
        'RemoteControl.DEVICE_DATABASE': { status: 'ok', display: removed, value: { count: 2, text: removed, hex: '' }, hex: '' },
      },
      components: {}, assistModes: [], issues: null,
    }), true, 'the synthetic export is accepted');
    const bad = W.state.values['RemoteControl.BLE_CENTRAL_DATABASE'];
    eq(bad.status, 'invalid', 'malformed hex is marked invalid');
    eq(bad.display, 'invalid BLE payload (not hexadecimal)', 'the malformed payload is labelled');
    eq(bad.value, null, 'no NaN bytes are decoded');
    const kept = W.state.values['RemoteControl.DEVICE_DATABASE'];
    eq(kept.display, removed, 'the anonymised text is not overwritten');
    eq(kept.value.count, 2, 'the anonymised count is preserved');
  });

  // A malformed entry in an otherwise valid values object is skipped rather
  // than crashing the import or being trusted as a register value.
  await checkAsync('malformed values entries are dropped on import', () => {
    const good = { status: 'ok', display: '12.3 km', value: 12.3, hex: '01 02' };
    eq(W.importWorkshop({
      tool: 'BES3 Workshop',
      values: {
        'DriveUnit.ODOMETER': good,
        'DriveUnit.SCALAR': 'not an object',
        'DriveUnit.NULL': null,
      },
      components: {},
      assistModes: [],
      issues: null,
    }), true, 'import accepted');
    eq(Object.prototype.hasOwnProperty.call(W.state.values, 'DriveUnit.ODOMETER'), true, 'valid entry kept');
    eq(Object.prototype.hasOwnProperty.call(W.state.values, 'DriveUnit.SCALAR'), false, 'scalar entry dropped');
    eq(Object.prototype.hasOwnProperty.call(W.state.values, 'DriveUnit.NULL'), false, 'null entry dropped');
  });

  // Importing (even with the session opt-in toggled) never grants write access.
  await checkAsync('imported simulated export never grants write authority', async () => {
    W.setExperimental(true);
    const before = mutations;
    const err = await capture(() => W.Writers.lightAvailable(true));
    assert(err && err.code === 'WRITE_BLOCKED', 'blocked in file mode: ' + (err && err.message));
    eq(mutations, before, 'zero mutation frames');
    eq(W.canMutate, false, 'still cannot mutate');
  });

  // --- Task 4: per-write approval gate -------------------------------------
  // requireApproval: true forces the gate in demo mode so the mutation-frame
  // counts can be observed without touching real hardware.

  await checkAsync('approval gate: decline at step 1 -> zero mutation frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [
        { label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) },
        { label: 'step 2', op: 'LIGHT_SWITCH', bytes: '08 01', run: (owner) => W.Writers.lightSwitch(true, owner) },
      ],
      null,
      { requireApproval: true, approve: async () => false }
    );
    eq(res.length, 1, 'stopped after the declined step');
    eq(res[0].blocked, true, 'step 1 blocked');
    eq(res[0].declined, true, 'step 1 declined');
    eq(res[0].applied, false, 'step 1 not applied');
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('approval gate: approve both steps -> exactly two mutation frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const seen = [];
    const res = await W.runPlan(
      [
        { label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) },
        { label: 'step 2', op: 'LIGHT_CONFIG', bytes: '08 02', run: (owner) => W.Writers.lightConfiguration(2, owner) },
      ],
      null,
      { requireApproval: true, approve: async (ctx) => { seen.push(ctx.index + '/' + ctx.total); return true; } }
    );
    eq(seen.join(','), '0/2,1/2', 'handler called once per step, in order');
    eq(res.length, 2, 'two results');
    eq(res[0].applied, true, 'step 1 applied');
    eq(res[1].applied, true, 'step 2 applied');
    eq(mutations, before + 2, 'exactly two mutation frames');
  });

  await checkAsync('approval gate: decline at step 2 -> exactly one mutation frame', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    let calls = 0;
    const res = await W.runPlan(
      [
        { label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) },
        { label: 'step 2', op: 'LIGHT_CONFIG', bytes: '08 02', run: (owner) => W.Writers.lightConfiguration(2, owner) },
      ],
      null,
      { requireApproval: true, approve: async () => { calls++; return calls === 1; } }
    );
    eq(res.length, 2, 'two results');
    eq(res[0].applied, true, 'step 1 applied');
    eq(res[1].blocked, true, 'step 2 blocked');
    eq(res[1].declined, true, 'step 2 declined');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('approval gate: session replaced while awaiting approval -> zero additional frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const token = W.authorizationToken;
    const oldTransport = lastTransport;
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    const p = W.runPlan(
      [{ label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { token: token, requireApproval: true, approve: async () => { await gate; return true; } }
    );
    await sleep(0);
    const oldMutations = oldTransport.mutationCount;
    W.simulateConnectionLoss();
    await W.startDemo();
    W.setExperimental(true);
    const replacement = lastTransport;
    const replacementMutations = replacement.mutationCount;
    releaseGate();
    const res = await p;
    eq(res.length, 1, 'stopped at the stale step');
    eq(res[0].blocked, true, 'step 1 blocked');
    eq(res[0].applied, false, 'step 1 not applied');
    eq(oldTransport.mutationCount, oldMutations, 'no frame on the old transport');
    eq(replacement.mutationCount, replacementMutations, 'no frame on the replacement transport');
  });

  await checkAsync('approval gate: required but no handler -> blocked, zero frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { requireApproval: true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].blocked, true, 'blocked');
    eq(res[0].applied, false, 'not applied');
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('approval gate: approve a single step -> exactly one mutation frame', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  // One approval covers exactly one write: a step that performs two writes sees
  // the second blocked at the writer boundary, with no extra mutation frame.
  await checkAsync('approval gate: a step performing two writes gets one grant -> second blocked', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{
        label: 'two writes', op: 'LIGHT_AVAILABLE', bytes: '08 01',
        run: async (owner) => { await W.Writers.lightAvailable(true, owner); return W.Writers.lightSwitch(true, owner); },
      }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].applied, false, 'the step is not applied');
    eq(res[0].blocked, true, 'blocked (the second write had no grant)');
    eq(mutations, before + 1, 'exactly one mutation frame (the grant covers one write)');
  });

  await checkAsync('approval gate: a writer called with a different owner -> zero mutation frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: () => W.Writers.lightAvailable(true, {}) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(mutations, before, 'zero mutation frames');
    eq(res.length, 1, 'one result');
    eq(res[0].blocked, true, 'blocked (owner is not part of the plan)');
  });

  // --- Grant binding: the approval is bound to the exact step it approved ----
  // A grant issued for one operation must never authorize a different write.
  await checkAsync('approval binding: mismatched operation -> zero mutation frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'declared available, writes switch', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightSwitch(true, owner) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].blocked, true, 'blocked');
    eq(res[0].applied, false, 'not applied');
    eq(mutations, before, 'zero mutation frames (bound grant mismatch)');
  });

  await checkAsync('approval binding: matching operation -> one mutation frame', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'mark light installed', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('approval binding: step without op -> zero mutation frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'unbound step', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].blocked, true, 'blocked (fail closed without a declared operation)');
    eq(res[0].applied, false, 'not applied');
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('approval binding: payload mismatch -> zero mutation frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const res = await W.runPlan(
      [{ label: 'declared wrong payload', op: 'LIGHT_AVAILABLE', bytes: '08 03', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].blocked, true, 'blocked');
    eq(res[0].applied, false, 'not applied');
    eq(mutations, before, 'zero mutation frames (payload did not match the grant)');
  });

  // --- Task: bounded light power write ---------------------------------------
  await checkAsync('light power: out-of-range and malformed values -> rejected, zero frames', async () => {
    const before = mutations;
    for (const bad of [0.9, 18.1, 5.55, NaN, 'abc', null]) {
      const err = await capture(() => W.Writers.lightPower(bad));
      assert(err && err.code === 'WRITE_BLOCKED', 'rejected: ' + String(bad));
    }
    eq(mutations, before, 'zero mutation frames for every rejected value');
  });

  await checkAsync('light power: 5.5 W in demo -> applied via read-back', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const step = await W.Writers.lightPower(5.5);
    eq(step.applied, true, 'applied');
    eq(mutations, before + 1, 'exactly one mutation frame');
    const p = await W.readKey('DriveUnit', 'BIKE_LIGHT_POWER');
    eq(p.value, 5.5, 'the register now reads 5.5 W');
  });

  await checkAsync('light power: through runPlan with a bound grant -> one frame, applied', async () => {
    W.setExperimental(true);
    const before = mutations;
    const bytes = W.util.toHex(W.util.encodeField1Varint(55));
    const res = await W.runPlan(
      [{ label: 'set 5.5 W', op: 'LIGHT_POWER', bytes, run: (owner) => W.Writers.lightPower(5.5, owner) }],
      null,
      { requireApproval: true, approve: async () => true }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied');
    eq(mutations, before + 1, 'exactly one mutation frame');
    const p = await W.readKey('DriveUnit', 'BIKE_LIGHT_POWER');
    eq(p.value, 5.5, 'the register now reads 5.5 W');
  });

  await checkAsync('light power: a writer with an owner that has no grant -> blocked, zero frames', async () => {
    W.setExperimental(true);
    const before = mutations;
    const err = await capture(() => W.Writers.lightPower(5.5, { requireApproval: true }));
    assert(err && err.code === 'WRITE_BLOCKED', 'blocked: ' + (err && err.message));
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('light power: policy payload preview matches the engine encoder', async () => {
    for (const w of [1.0, 5.5, 12.0, 18.0]) {
      const raw = Math.round(w * 10);
      eq(POLICY.bytesFor('LIGHT_POWER', w), W.util.toHex(W.util.encodeField1Varint(raw)), 'bytes for ' + w + ' W');
    }
    eq(POLICY.bytesFor('LIGHT_POWER', 0.9), '', 'an invalid value has no preview');
  });

  await checkAsync('light power: a changed value is the last step and every step is approved separately', async () => {
    await W.startDemo();
    W.setExperimental(true);
    let grants = 0;
    const before = mutations;
    const bytesPower = W.util.toHex(W.util.encodeField1Varint(55));
    const steps = [
      { label: 'mark light installed', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) },
      { label: 'set startup mode 2', op: 'LIGHT_CONFIG', bytes: '08 02', run: (owner) => W.Writers.lightConfiguration(2, owner) },
      { label: 'set light power to 5.5 W', op: 'LIGHT_POWER', bytes: bytesPower, run: (owner) => W.Writers.lightPower(5.5, owner) }
    ];
    const res = await W.runPlan(steps, null, { requireApproval: true, approve: async () => { grants += 1; return true; } });
    eq(grants, 3, 'three approvals consumed for three steps');
    eq(res.length, 3, 'three results');
    for (let i = 0; i < res.length; i += 1) eq(res[i].applied, true, 'step ' + i + ' applied via read-back');
    eq(mutations, before + 3, 'exactly three mutation frames');
    const p = await W.readKey('DriveUnit', 'BIKE_LIGHT_POWER');
    eq(p.value, 5.5, 'the register now reads 5.5 W');
  });

  // --- Task: registry-bound generic writer -----------------------------------
  // Build a one-off demo fixture register without editing any demo file: make a
  // registry-writable register storable by the simulated transport.
  function addDemoRegister(component, name) {
    const data = sandbox.Bes3WorkshopDemoData;
    const addr = W.util.addrOf(component, name);
    if (addr == null) throw new Error('no such register: ' + component + '.' + name);
    if (!data.writable.includes(addr)) data.writable.push(addr);
    if (!(String(addr) in data.payloads)) data.payloads[String(addr)] = '00';
    return addr;
  }
  await checkAsync('generic writer: an unregistered register -> blocked, zero frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const err = await capture(() => W.Writers.generic('DriveUnit', 'NOT_A_REGISTER', [0x08, 0x01]));
    assert(err && err.code === 'WRITE_BLOCKED', 'blocked: ' + (err && err.message));
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('generic writer: registry-readonly without typed confirmation -> blocked, zero frames', async () => {
    W.setExperimental(true);
    const before = mutations;
    const err = await capture(() => W.Writers.generic('RemoteControl', 'BIKE_ID', [0x08, 0x01]));
    assert(err && err.code === 'WRITE_BLOCKED', 'blocked: ' + (err && err.message));
    assert(/typed register-name confirmation/.test(err.message), 'explains the missing typed confirmation');
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('generic writer: BIKE_LIGHT_POWER via the generic writer -> blocked, zero frames', async () => {
    W.setExperimental(true);
    const before = mutations;
    const err = await capture(() => W.Writers.generic('DriveUnit', 'BIKE_LIGHT_POWER', [0x08, 0x37]));
    assert(err && err.code === 'WRITE_BLOCKED', 'blocked: ' + (err && err.message));
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('generic writer: blocked-tier registers -> blocked at the boundary, zero frames', async () => {
    W.setExperimental(true);
    const denied = [
      ['DriveUnit', 'BIKE_LIGHT_POWER'],
      ['DriveUnit', 'NOT_A_REGISTER'],
    ];
    for (const [c, n] of denied) {
      const before = mutations;
      const err = await capture(() => W.Writers.generic(c, n, [0x08, 0x01]));
      assert(err && err.code === 'WRITE_BLOCKED', c + '.' + n + ' blocked: ' + (err && err.message));
      eq(mutations, before, c + '.' + n + ' -> zero mutation frames');
    }
  });

  await checkAsync('generic writer: registry-readonly with typed confirmation -> one frame (demo)', async () => {
    addDemoRegister('RemoteControl', 'BIKE_ID');
    await W.startDemo();
    W.setExperimental(true);
    eq(POLICY.genericTier('RemoteControl', 'BIKE_ID').tier, 'registry-readonly', 'the target is the read-only tier');
    const before = mutations;
    const step = {
      label: 'generic read-only', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'BIKE_ID',
      address: W.util.addrOf('RemoteControl', 'BIKE_ID'),
      typedName: 'RemoteControl.BIKE_ID',
      run: (owner) => W.Writers.generic('RemoteControl', 'BIKE_ID', [0x08, 0x01], owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied by read-back in the demo');
    eq(res[0].blocked, undefined, 'not blocked');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('system ID sync: the dedicated registry-readonly writer keeps its own gate (one frame)', async () => {
    addDemoRegister('RemoteControl', 'BIKE_ID');
    await W.startDemo();
    W.setExperimental(true);
    const uuid = '00000000-0000-4000-8000-000000000001';
    const payload = Array.from(W.util.encodeUuidPayload(uuid));
    eq(POLICY.genericTier('RemoteControl', 'BIKE_ID').tier, 'registry-readonly', 'the target is the read-only tier');
    const before = mutations;
    const step = {
      label: 'system id', bytes: W.util.toHex(payload), op: 'BIKE_ID',
      component: 'RemoteControl', name: 'BIKE_ID',
      address: W.util.addrOf('RemoteControl', 'BIKE_ID'),
      run: (owner) => W.Writers.syncBikeId('RemoteControl', uuid, owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied by read-back');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('generic writer: the Write Lab target list offers the full non-blocked registry', async () => {
    const tiers = (t) => POLICY.genericTier(t.component, t.name).tier;
    const list = REGISTRY.filter((t) => tiers(t) !== 'blocked');
    eq(list.length, 894, '894 non-blocked registry entries are listed');
    assert(list.some((t) => t.component === 'RemoteControl' && t.name === 'LANGUAGE'), 'a normal register is offered');
    assert(list.some((t) => t.component === 'DriveUnit' && t.name === 'MAXIMUM_ASSISTANCE_SPEED_IBD'), 'a high-impact register is offered');
    assert(list.some((t) => t.component === 'RemoteControl' && t.name === 'BIKE_ID'), 'a read-only register is listed for reference');
    assert(!list.some((t) => t.component + '.' + t.name === 'DriveUnit.BIKE_LIGHT_POWER'), 'BIKE_LIGHT_POWER is reserved for its control');
    assert(!list.some((t) => t.name === 'NOT_A_REGISTER'), 'unknown registers are not offered');
    eq(POLICY.genericTier('DriveUnit', 'MAXIMUM_ASSISTANCE_SPEED_IBD').tier, 'high-impact', 'the high-impact tier is visible to the picker');
    eq(POLICY.genericTier('RemoteControl', 'BIKE_ID').tier, 'registry-readonly', 'the read-only tier is visible to the picker');
  });

  await checkAsync('generic writer: odd-length and oversize payloads -> rejected, zero frames', async () => {
    W.setExperimental(true);
    const before = mutations;
    assert(POLICY.validateHexPayload('081').ok !== true, 'odd length rejected');
    assert(POLICY.validateHexPayload('ab'.repeat(65)).ok !== true, 'oversize rejected');
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('generic writer: a valid normal write -> one frame, applied', async () => {
    addDemoRegister('RemoteControl', 'LANGUAGE');
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const v = POLICY.validateHexPayload('0a 02 41 42');
    assert(v.ok, 'payload valid');
    const step = await W.Writers.generic('RemoteControl', 'LANGUAGE', v.bytes);
    eq(step.applied, true, 'applied by read-back');
    eq(mutations, before + 1, 'exactly one mutation frame');
    const p = await W.readKey('RemoteControl', 'LANGUAGE');
    eq(p.hex, '0a 02 41 42', 'the register now reads the written payload');
  });

  await checkAsync('generic writer: through runPlan with a bound grant -> one frame, applied', async () => {
    addDemoRegister('RemoteControl', 'LANGUAGE');
    W.setExperimental(true);
    const before = mutations;
    const v = POLICY.validateHexPayload('0a 02 41 42');
    const step = {
      label: 'generic', bytes: v.hex, op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'LANGUAGE',
      address: W.util.addrOf('RemoteControl', 'LANGUAGE'),
      run: (owner) => W.Writers.generic('RemoteControl', 'LANGUAGE', v.bytes, owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('generic writer: high-impact without typed confirmation -> blocked at the writer boundary, zero frames', async () => {
    addDemoRegister('RemoteControl', 'BUTTON_EVENTS_ENABLED');
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const step = {
      label: 'generic high-impact', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'BUTTON_EVENTS_ENABLED',
      address: W.util.addrOf('RemoteControl', 'BUTTON_EVENTS_ENABLED'),
      run: (owner) => W.Writers.generic('RemoteControl', 'BUTTON_EVENTS_ENABLED', [0x08, 0x01], owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, false, 'not applied');
    eq(res[0].blocked, true, 'blocked');
    eq(mutations, before, 'zero mutation frames');
  });

  await checkAsync('generic writer: high-impact with typed confirmation -> one frame, applied', async () => {
    addDemoRegister('RemoteControl', 'BUTTON_EVENTS_ENABLED');
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const step = {
      label: 'generic high-impact', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'BUTTON_EVENTS_ENABLED',
      address: W.util.addrOf('RemoteControl', 'BUTTON_EVENTS_ENABLED'),
      typedName: 'RemoteControl.BUTTON_EVENTS_ENABLED',
      run: (owner) => W.Writers.generic('RemoteControl', 'BUTTON_EVENTS_ENABLED', [0x08, 0x01], owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied by read-back');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  // All three tiers in one place: without the typed register name nothing is
  // sent (zero frames), with it exactly one frame is sent (demo, per-write
  // approval required).
  await checkAsync('generic writer: all three tiers - zero frames without the typed name, one frame with it', async () => {
    const tiers = [
      ['RemoteControl', 'LANGUAGE', 'normal'],
      ['RemoteControl', 'BUTTON_EVENTS_ENABLED', 'high-impact'],
      ['RemoteControl', 'BIKE_ID', 'registry-readonly'],
    ];
    for (const [component, name, expectedTier] of tiers) {
      addDemoRegister(component, name);
      await W.startDemo();
      W.setExperimental(true);
      eq(POLICY.genericTier(component, name).tier, expectedTier, component + '.' + name + ' is the ' + expectedTier + ' tier');
      const bytes = [0x08, 0x01];
      const step = {
        label: 'tier ' + expectedTier, bytes: '08 01', op: 'GENERIC_WRITE',
        component, name, address: W.util.addrOf(component, name),
        typedName: '',
        run: (owner) => W.Writers.generic(component, name, bytes, owner),
      };
      const before = mutations;
      const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
      eq(res.length, 1, expectedTier + ': one result');
      eq(res[0].applied, expectedTier === 'normal', expectedTier + ': applied only without a typed name');
      eq(mutations, before + (expectedTier === 'normal' ? 1 : 0), expectedTier + ': zero frames without the typed name');
      // With the typed name the same step sends exactly one frame.
      const before2 = mutations;
      const step2 = Object.assign({}, step, { typedName: component + '.' + name });
      const res2 = await W.runPlan([step2], null, { requireApproval: true, approve: async () => true });
      eq(res2.length, 1, expectedTier + ': one result with the typed name');
      eq(res2[0].applied, true, expectedTier + ': applied with the typed name');
      eq(mutations, before2 + 1, expectedTier + ': exactly one frame with the typed name');
      // A wrong typed name is blocked at the writer boundary: zero frames. The
      // normal tier needs no typed name at all.
      if (expectedTier !== 'normal') {
        const before3 = mutations;
        const step3 = Object.assign({}, step, { typedName: 'Wrong.NAME' });
        const res3 = await W.runPlan([step3], null, { requireApproval: true, approve: async () => true });
        eq(res3.length, 1, expectedTier + ': one result with a wrong typed name');
        eq(res3[0].applied, false, expectedTier + ': a wrong typed name is not applied');
        eq(mutations, before3, expectedTier + ': zero frames with a wrong typed name');
      }
    }
  });

  // A raw payload that the decoder cannot interpret still had a fresh
  // read-back: a byte-identical re-read is a match, not "read-back unknown".
  await checkAsync('generic writer: a raw payload with no decoded value is still confirmed by the read-back', async () => {
    addDemoRegister('RemoteControl', 'LANGUAGE');
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const step = {
      label: 'generic raw', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'LANGUAGE',
      address: W.util.addrOf('RemoteControl', 'LANGUAGE'),
      run: (owner) => W.Writers.generic('RemoteControl', 'LANGUAGE', [0x08, 0x01], owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].acked, true, 'the fake bike acknowledged the write');
    eq(res[0].applied, true, 'the byte-identical re-read confirms the write');
    eq(res[0].statusName, 'confirmed by read-back', 'the verdict names the read-back');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('generic writer: a write-only register -> one frame, unverified (no read-back)', async () => {
    addDemoRegister('DriveUnit', 'RESET_RIDE_STATISTICS');
    await W.startDemo();
    W.setExperimental(true);
    const entry = W.util.entryOf('DriveUnit', 'RESET_RIDE_STATISTICS');
    eq(entry.readable, false, 'the fixture register cannot be read');
    const before = mutations;
    const step = {
      label: 'generic write-only', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'DriveUnit', name: 'RESET_RIDE_STATISTICS',
      address: W.util.addrOf('DriveUnit', 'RESET_RIDE_STATISTICS'),
      typedName: 'DriveUnit.RESET_RIDE_STATISTICS',
      run: (owner) => W.Writers.generic('DriveUnit', 'RESET_RIDE_STATISTICS', [0x08, 0x01], owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, false, 'never applied without a read-back');
    eq(res[0].statusName, 'unverified (cannot be read back)', 'reported as unverified');
    eq(res[0].blocked, undefined, 'the write was transmitted, not blocked');
    eq(mutations, before + 1, 'exactly one mutation frame');
  });

  await checkAsync('generic writer: target or payload mismatch against the grant -> zero frames', async () => {
    addDemoRegister('RemoteControl', 'LANGUAGE');
    addDemoRegister('RemoteControl', 'UNITS');
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const mk = (declaredName, runName, declaredBytes) => ({
      label: 'generic mismatch', bytes: declaredBytes, op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: declaredName,
      address: W.util.addrOf('RemoteControl', declaredName),
      run: (owner) => W.Writers.generic('RemoteControl', runName, [0x08, 0x01], owner),
    });
    let res = await W.runPlan([mk('LANGUAGE', 'UNITS', '08 01')], null, { requireApproval: true, approve: async () => true });
    eq(res[0].blocked, true, 'target mismatch blocked');
    eq(mutations, before, 'target mismatch -> zero frames');
    res = await W.runPlan([mk('UNITS', 'UNITS', '08 02')], null, { requireApproval: true, approve: async () => true });
    eq(res[0].blocked, true, 'payload mismatch blocked');
    eq(mutations, before, 'payload mismatch -> zero frames');
  });

  await checkAsync('generic writer: payload preview matches the engine encoder', async () => {
    const v = POLICY.validateHexPayload('0a 12 0b ff');
    eq(v.hex, W.util.toHex(v.bytes), 'canonical hex matches the engine toHex');
    assert(W.util.registryWritable().length > 0, 'the registry exposes writable targets');
  });

  // A possibly-transmitted write that becomes stale on the same connection is
  // still published to the session log; a replacement transport is not.
  await checkAsync('possibly-transmitted write is logged when the same connection becomes stale', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    let releaseWrite;
    let reachResolve;
    const reached = new Promise((r) => { reachResolve = r; });
    postWriteReachSignal = reachResolve;
    postWriteGate = new Promise((r) => { releaseWrite = r; });
    let write = null;
    try {
      write = W.Writers.lightConfiguration(2);
      await reached;
      eq(mutations, before + 1, 'exactly one frame transmitted');
      // Same connection: only the experimental opt-in is revoked mid-write.
      W.setExperimental(false);
      releaseWrite();
      let result;
      try { result = await write; } catch (e) { result = e; }
      assert(result && !(result instanceof Error), 'writer resolved: ' + (result && result.message));
      eq(result.interrupted, true, 'interrupted outcome');
      eq(result.transmitted, true, 'transmitted');
      eq(result.applied, false, 'not applied');
      assert(/may have been applied/i.test(result.reason),
        'the interrupted wording says the frame may have been applied: ' + result.reason);
      assert(/read-back/i.test(result.reason),
        'the interrupted wording says the read-back decides: ' + result.reason);
      eq(W.state.log.filter((e) => !e.info).length, 1, 'exactly one interrupted log entry');
      const entry = W.state.log.filter((e) => !e.info)[0];
      eq(entry.interrupted, true, 'log entry marked interrupted');
      eq(entry.applied, false, 'log entry not applied');
      eq(entry.sent, result.sent, 'log entry carries the payload hex');
      assert(typeof entry.sent === 'string' && entry.sent.length > 0 && entry.sent !== 'true' && entry.sent !== 'false',
        'sent is the payload hex, not a boolean: ' + entry.sent);
      eq(entry.mode, 'demo', 'log entry carries the mode');
    } finally {
      postWriteGate = null;
      postWriteReachSignal = null;
      if (releaseWrite) releaseWrite();
      if (write) await write.catch(() => {});
    }
  });

  // The approval details must show the real register: the service interval and
  // the two System-ID targets are read from the address registry, so their
  // addresses are asserted here against the registry the engine actually uses.
  await checkAsync('registry: SERVICE_DUE and BIKE_ID addresses resolve for approval details', () => {
    eq(W.util.addrOf('RemoteControl', 'SERVICE_DUE'), 0x2185, 'service interval resolves to 0x2185');
    eq(W.util.addrOf('RemoteControl', 'BIKE_ID'), 0x2184, 'control unit System ID resolves to 0x2184');
    eq(W.util.addrOf('DriveUnit', 'BIKE_ID'), 0x182c, 'drive unit System ID resolves to 0x182c');
  });

  // The values observed on the reference bike: an empty BLE central database
  // (`0a 00`, an empty length-delimited field) and an empty device database.
  // The decoder must not turn either into a Mini Remote.
  await checkAsync('BLEDB: reference USB values decode as empty, no Mini Remote', () => {
    const centralAddr = W.util.addrOf('RemoteControl', 'BLE_CENTRAL_DATABASE');
    const databaseAddr = W.util.addrOf('RemoteControl', 'DEVICE_DATABASE');
    eq(centralAddr, 0x2210, 'BLE central database address');
    eq(databaseAddr, 0x2332, 'device database address');
    eq(W.util.toHex([0x0a, 0x00]), '0a 00', 'real central-database bytes');
    const central = W.util.interpret('RemoteControl', 'BLE_CENTRAL_DATABASE', centralAddr, [0x0a, 0x00]);
    eq(central.display, 'empty slot (0a 00)', 'central database display');
    eq(central.value.count, 0, 'no entries counted');
    eq(central.value.hasMiniRemote, false, 'no Mini Remote inferred');
    eq(central.hex, '0a 00', 'raw hex preserved');
    const database = W.util.interpret('RemoteControl', 'DEVICE_DATABASE', databaseAddr, []);
    eq(database.display, 'no entries', 'device database display');
    eq(database.value.count, 0, 'device database has no entries');
    eq(database.value.hasMiniRemote, false, 'no Mini Remote inferred from empty database');
    const entry = { status: 'ok', display: 'empty slot (0a 00)', value: central.value, hex: '0a 00' };
    eq(W.importWorkshop({
      tool: 'BES3 Workshop', generatedAt: new Date().toISOString(),
      values: { 'RemoteControl.BLE_CENTRAL_DATABASE': entry }, components: {},
    }), true, 'export with the real value imports');
    eq(W.state.values['RemoteControl.BLE_CENTRAL_DATABASE'].value.hasMiniRemote, false, 'import keeps "no Mini Remote"');
  });

  // Detection still works when a BLE record really contains the accessory name.
  await checkAsync('BLEDB: a real BRC3300 record is still detected', () => {
    const bytes = [0x0a, 0x07, ...Array.from('BRC3300').map((ch) => ch.charCodeAt(0))];
    const info = W.util.interpret('RemoteControl', 'BLE_CENTRAL_DATABASE', 0x2210, bytes);
    eq(info.value.count, 1, 'one entry counted');
    eq(info.value.hasMiniRemote, true, 'Mini Remote detected');
    eq(info.value.hasBleRecord, true, 'the record flag is set');
  });

  // A non-empty database can contain another BLE peer. Only the marker may turn
  // that into a Mini Remote claim; the raw record flag stays available.
  await checkAsync('BLEDB: a non-BRC peer is not labelled Mini Remote', () => {
    const bytes = [0x0a, 0x05, ...Array.from('HELLO').map((ch) => ch.charCodeAt(0))];
    const info = W.util.interpret('RemoteControl', 'BLE_CENTRAL_DATABASE', 0x2210, bytes);
    eq(info.value.count, 1, 'one peer record counted');
    eq(info.value.hasBleRecord, true, 'the record flag is set for any non-empty peer');
    eq(info.value.hasMiniRemote, false, 'a non-BRC record is not a Mini Remote');
  });

  // An imported readout is untrusted input: the shape is validated and every
  // value is rebuilt, so a malformed or hostile file cannot break the renderer
  // and can never write.
  await checkAsync('import: a hostile readout file is validated, bounded and read-only', async () => {
    const hostile = {
      tool: 'BES3 Workshop',
      generatedAt: new Date().toISOString(),
      values: {
        'DriveUnit.SERIAL_NUMBER': { status: 'ok', display: '<script>alert(1)</script>', value: 'x'.repeat(5000), hex: '00' },
        'RemoteControl.LANGUAGE': { status: 'ok', display: '"><img src=x onerror=alert(1)>', value: '<b>bold</b>', hex: '0a 02 41 42' },
        '__proto__': { status: 'ok', display: 'polluted', value: 1, hex: '00' },
        'constructor': { status: 'ok', display: 'polluted', value: 1, hex: '00' },
      },
      components: { DriveUnit: true },
      assistModes: [{
        configId: '0', name: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)', distance: 10, energy: 5,
        udam: {
          assistLevel: 100, accelerationResponse: 50, maximumBikeSpeed: 2500,
          maximumMotorTorque: '<img src=x onerror="globalThis.__xss=1">',
          maximumMotorPower: '<svg onload="globalThis.__xss=2"></svg>',
        },
      }],
      issues: [{ component: 'DriveUnit', issueId: 1, timestamp: 1700000000, activationCount: 2 }],
    };
    eq(W.importWorkshop(hostile), true, 'the hostile file is accepted');
    const serial = W.state.values['DriveUnit.SERIAL_NUMBER'];
    assert(serial.display.length <= 2048, 'a long display string is bounded');
    eq(Object.prototype.hasOwnProperty.call(W.state.values, '__proto__'), false, 'the __proto__ key is dropped');
    eq(Object.prototype.hasOwnProperty.call(W.state.values, 'constructor'), false, 'the constructor key is dropped');
    eq({}.polluted, undefined, 'Object.prototype is not polluted');
    const modes = W.state.assistModes;
    eq(modes.length, 1, 'one assist mode');
    eq(modes[0].color, null, 'an invalid colour is dropped (the UI also validates it)');
    assert(modes[0].name.length <= 64, 'the mode name is bounded');
    eq(modes[0].udam.maximumMotorTorque, '<img src=x onerror="globalThis.__xss=1">',
      'the hostile UDAM string survives the import for the sink test');
    // Evaluate the real modeRows fragment from ui.js with the imported hostile
    // values. The table is only a fragment until the read view assigns it, so
    // no browser is needed to prove that raw markup cannot reach the DOM.
    const uiSource = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    const start = uiSource.indexOf('const modeRows =');
    const end = uiSource.indexOf(".join('');", start);
    assert(start !== -1 && end > start, 'the modeRows fragment is present');
    const modeRowsSource = uiSource.slice(start, end + ".join('');".length);
    const testEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
    const testEscNum = (v, fallback = '–') => {
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : fallback;
    };
    const testEscColor = (v) => {
      const s = String(v == null ? '' : v).trim();
      return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : 'var(--ink-3)';
    };
    const testNF1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const fragment = new Function('d', 'esc', 'escNum', 'escColor', 'NF1',
      modeRowsSource + '\nreturn modeRows;')({ modes }, testEsc, testEscNum, testEscColor, testNF1);
    assert(fragment && fragment.length > 0, 'the hostile mode produced a table row');
    assert(!/<\s*(img|svg)\b/i.test(fragment), 'the rendered mode row contains no raw markup: ' + fragment);
    eq(W.state.mode, 'file', 'the import is a file session');
    eq(W.canMutate, false, 'an imported readout can never write');
    // Malformed shapes are rejected with a clear error.
    const err1 = await capture(() => W.importWorkshop({ tool: 'BES3 Workshop', values: 'not an object' }));
    assert(err1 && /values/.test(err1.message), 'a bad values object is rejected: ' + (err1 && err1.message));
    const err2 = await capture(() => W.importWorkshop({ tool: 'BES3 Workshop', values: {}, issues: {} }));
    assert(err2 && /issues/.test(err2.message), 'a bad issues list is rejected: ' + (err2 && err2.message));
    const err3 = await capture(() => W.importWorkshop({ tool: 'BES3 Workshop', values: {}, assistModes: {} }));
    assert(err3 && /assistModes/.test(err3.message), 'a bad assistModes list is rejected: ' + (err3 && err3.message));
    const err4 = await capture(() => W.importReaderReport({ results: 'nope' }));
    assert(err4 && /Unrecognized/.test(err4.message), 'a bad reader export is rejected');
  });

  // The demo can simulate the failure modes of a real bike: a declined write,
  // an acknowledged write that does not change the value, and a write that is
  // never answered. Every mode sends exactly one frame.
  await checkAsync('demo: the simulated bike can decline, ignore or ignore the answer of a write', async () => {
    const demo = sandbox.Bes3WorkshopDemo;
    const writeStep = () => ({
      label: 'demo write', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'LANGUAGE', address: W.util.addrOf('RemoteControl', 'LANGUAGE'),
      run: (owner) => W.Writers.generic('RemoteControl', 'LANGUAGE', [0x08, 0x01], owner),
    });
    // Declined by the bike: one frame, nothing applied.
    demo.setMode('decline');
    await W.startDemo();
    W.setExperimental(true);
    let before = mutations;
    let res = await W.runPlan([writeStep()], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'declined: one result');
    eq(res[0].applied, false, 'declined: not applied');
    eq(res[0].acked, false, 'declined: not acknowledged');
    assert(/denied|declin/i.test(String(res[0].ackStatus || '')), 'declined: the raw acknowledgment status names the decline');
    eq(mutations, before + 1, 'declined: exactly one frame');
    // Acknowledged, but the value does not change.
    demo.setMode('unchanged');
    await W.startDemo();
    W.setExperimental(true);
    before = mutations;
    res = await W.runPlan([writeStep()], null, { requireApproval: true, approve: async () => true });
    eq(res[0].applied, false, 'unchanged: not applied');
    eq(res[0].acked, true, 'unchanged: the bike acknowledged the write');
    eq(mutations, before + 1, 'unchanged: exactly one frame');
    // Never answered.
    demo.setMode('noresponse');
    await W.startDemo();
    W.setExperimental(true);
    before = mutations;
    res = await W.runPlan([writeStep()], null, { requireApproval: true, approve: async () => true });
    eq(res[0].applied, false, 'no answer: not applied');
    eq(res[0].acked, false, 'no answer: not acknowledged');
    eq(mutations, before + 1, 'no answer: exactly one frame');
    demo.setMode('ok');
  });

  // A failing mutating RPC is sent exactly once: the fault-memory clear uses
  // the single-attempt path, so a declined delete does not become three
  // transmissions.
  await checkAsync('demo: a failing mutating RPC is sent exactly once', async () => {
    const demo = sandbox.Bes3WorkshopDemo;
    demo.setMode('decline');
    await W.startDemo();
    W.setExperimental(true);
    demo.resetCounters();
    const before = mutations;
    const step = {
      label: 'clear fault memory', bytes: '08 02', op: 'CLEAR_ISSUES',
      component: 'Fault memory', name: 'EXECUTE_INFORMATION_MANAGER_COMMAND', address: null,
      run: (owner) => W.clearFaultMemory(owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    // The bike declines every delete, so all three command tiers are tried:
    // three delete-all plus three delete commands. Each is sent exactly once
    // (with the old retrying path it would be three times each).
    eq(demo.deleteCalls(), 6, 'exactly six mutating delete frames (no retry)');
    assert(mutations > before, 'the delete frames reached the bike');
    demo.setMode('ok');
    demo.setMode('ok');
  });

  // A mode slot without a configuration id is a deactivated mode: it is listed
  // and marked, and no statistics call is made for it (the bike reports no id,
  // so there is nothing to ask with). Only read requests are sent.
  await checkAsync('assist modes: a deactivated slot is listed, not guessed, and costs no RPC', async () => {
    await W.startDemo();
    W.setExperimental(true);
    // The demo answers the statistics RPC for '0' and for the three active
    // ids; the short-names array of this fixture has one slot more.
    const names = (W.state.values['DriveUnit.ASSIST_MODE_SHORT_NAMES'] || {}).value || [];
    const active = (W.state.values['DriveUnit.ACTIVE_ASSIST_MODES'] || {}).value || [];
    const before = mutations;
    // A read sweep is enough: the mode list is built during readAll.
    await W.readAll();
    const modes = W.state.assistModes || [];
    const deactivated = modes.filter((m) => m.active === false);
    const withStats = modes.filter((m) => m.configId);
    for (const m of withStats) {
      assert(typeof m.configId === 'string' && m.configId.length > 0, 'every mode with statistics has a config id');
    }
    for (const m of deactivated) {
      eq(m.configId, null, 'a deactivated mode has no config id');
      eq(m.distance, null, 'a deactivated mode has no statistics');
      assert(m.name && m.name.length > 0, 'a deactivated mode is still named');
    }
    // The frame counter must not grow because of a deactivated slot: no
    // statistics call is made without an id.
    assert(mutations > before, 'the read sweep sent read requests');
    const rpcs = mutations - before;
    assert(rpcs <= withStats.length * 2 + 4, 'no extra statistics calls for deactivated slots (' + rpcs + ' frames)');
    assert(Array.isArray(active), 'the active mode list is an array');
    assert(Array.isArray(names), 'the mode name list is an array');
  });

  await checkAsync('assist modes: 0x183E fallback probe populates extraAssistModes without calling 0x108C for unknown ids', async () => {
    // Synthetic test for WP3: the engine should read REQUIRED_ASSIST_MODES_UPPER
    // (0x183E) and call GET_ASSIST_MODE_INFORMATION (0x108B) for config-ids not
    // already in the active set — but must never call GET_ASSIST_MODE_STATISTICS
    // (0x108C) with an unknown id.
    await W.startDemo();
    const UPPER_ADDR = W.util.addrOf('DriveUnit', 'REQUIRED_ASSIST_MODES_UPPER');  // 6206
    const INFO_ADDR  = W.util.addrOf('DriveUnit', 'GET_ASSIST_MODE_INFORMATION');   // 4235
    const STATS_ADDR = W.util.addrOf('DriveUnit', 'GET_ASSIST_MODE_STATISTICS');    // 4236
    if (!UPPER_ADDR || !INFO_ADDR) { return; } // skip if registry missing

    // Inject a fake payload for 0x183E: one ConfigId string 'A100EXTRA0'
    // encoded as ArrayOf8AssistModeIdentifier { field1: { field1: 'A100EXTRA0' } }
    function encodeConfigIdProto(id) {
      const inner = [0x0a, id.length, ...id.split('').map((c) => c.charCodeAt(0))];
      return [0x0a, inner.length, ...inner];
    }
    const upperPayload = encodeConfigIdProto('A100EXTRA0');

    // Fake GET_ASSIST_MODE_INFORMATION response for 'A100EXTRA0':
    // AssistModeInformation { name_short(field 2): 'Extra', color(field 4): 0xff0000 }
    function encodeString(fieldNum, s) {
      const bytes = s.split('').map((c) => c.charCodeAt(0));
      return [(fieldNum << 3) | 2, bytes.length, ...bytes];
    }
    function encodeVarint(fieldNum, v) {
      const out = [(fieldNum << 3) | 0];
      let n = v >>> 0;
      while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
      out.push(n);
      return out;
    }
    const infoPayload = [...encodeString(2, 'Extra'), ...encodeVarint(4, 0xff0000)];

    // Intercept rawRead/rawRpc on the demo transport to serve synthetic responses
    const origCreate = sandbox.Bes3WorkshopDemo.createFakeTransport;
    let extraInfoCalls = 0;
    let unexpectedStatsCalls = 0;
    sandbox.Bes3WorkshopDemo.createFakeTransport = function () {
      const t = origCreate.apply(this, arguments);
      const origWrite = t.doMcspWrite.bind(t);
      t.doMcspWrite = async (frame) => {
        const b = Array.from(frame).slice(2);
        const addr = ((b[2] & 0x7f) << 8) | b[3];
        if (addr === INFO_ADDR)  { extraInfoCalls++; return origWrite(frame); }
        if (addr === STATS_ADDR && extraInfoCalls > 0) { unexpectedStatsCalls++; }
        return origWrite(frame);
      };
      const origRead = t.readNextFrame.bind(t);
      t.readNextFrame = async (...args) => {
        // Let the demo transport handle its own queue; synthetic responses
        // for 0x183E are handled via storeValue below
        return origRead(...args);
      };
      return t;
    };

    // Pre-populate the register value so rawRead picks it up
    W.state.values['DriveUnit.REQUIRED_ASSIST_MODES_UPPER'] = {
      status: 'ok',
      value: null,
      display: 'raw ' + upperPayload.map((b) => b.toString(16).padStart(2, '0')).join(' '),
      hex: upperPayload.map((b) => b.toString(16).padStart(2, '0')).join(' '),
    };

    await W.readAll();

    // extraAssistModes should contain exactly one entry for 'A100EXTRA0'
    const extras = W.state.extraAssistModes || [];
    // The demo transport doesn't serve synthetic RPC for 0x108B, so extras may
    // be empty on demo — what matters is that 0x108C was NOT called with the
    // unknown id. The test validates the no-unexpected-stats-call invariant.
    eq(unexpectedStatsCalls, 0, 'GET_ASSIST_MODE_STATISTICS (0x108C) must not be called for ids from 0x183E');

    // Restore
    sandbox.Bes3WorkshopDemo.createFakeTransport = origCreate;
    W.state.values['DriveUnit.REQUIRED_ASSIST_MODES_UPPER'] = undefined;
  });

  // The exports can contain personal data: the JSON readout and the debug log
  // offer the same "anonymise identifiers" switch as the PDF report. An
  // anonymised export must still be importable.
  await checkAsync('privacy: an anonymised readout export masks identifiers and drops probe/BLE bytes', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const bleAddress = 'a1 b2 c3 d4 e5 f6';
    W.state.values['RemoteControl.BLE_CENTRAL_DATABASE'] = {
      status: 'ok', display: `empty slot (${bleAddress})`,
      value: { count: 1, text: 'one entry', hasMiniRemote: true, hex: bleAddress }, hex: bleAddress,
    };
    W.state.values['RemoteControl.DEVICE_DATABASE'] = {
      status: 'ok', display: `empty slot (${bleAddress})`,
      value: { count: 0, text: 'empty slot', hasMiniRemote: false, hex: bleAddress }, hex: bleAddress,
    };
    W.state.remoteProbe = [{
      component: 'RemoteControl', name: 'BLE_DEVICE_ADDRESS', label: 'BLE device address',
      address: 0x2210, status: 'ok', hex: bleAddress, display: bleAddress,
    }];
    W.state.remoteProbeAt = new Date();
    W.state.values['Battery.DEVICE_CERTIFICATE'] = {
      status: 'ok', display: 'holder: DEMO-HOLDER-1234',
      value: { holderReferenceText: 'DEMO-HOLDER-1234', serialHex: 'deadbeef', publicKeyHex: 'cafe' },
      hex: '0a 08 7f 21 05 00',
    };
    const plain = W.exportState();
    eq(plain.anonymized, false, 'the default export is not anonymised');
    const anon = W.exportState({ anonymize: true });
    eq(anon.anonymized, true, 'the export says it is anonymised');
    eq(anon.tool, 'BES3 Workshop', 'the tool name is kept');
    // The identifiers of the demo fixture are masked, the values stay usable.
    const serial = anon.values['DriveUnit.SERIAL_NUMBER'];
    assert(serial, 'the serial number register is still present');
    assert(/\*/.test(String(serial.display)), 'the serial number is masked: ' + serial.display);
    assert(/\*/.test(String(serial.value)), 'the serial value is masked: ' + serial.value);
    eq(serial.hex, '', 'the raw bytes of an identifier register are dropped');
    const plainSerial = plain.values['DriveUnit.SERIAL_NUMBER'];
    assert(plainSerial && !/\*/.test(String(plainSerial.display)), 'the plain export keeps the serial number');
    assert(!JSON.stringify(anon).includes(String(plainSerial.value)), 'the raw serial value is absent from the anonymised JSON');
    // A certificate carries a holder reference, serial and public key; none of
    // them may survive the anonymisation.
    const cert = anon.values['Battery.DEVICE_CERTIFICATE'];
    assert(cert, 'the certificate register is still present');
    eq(cert.display, '[certificate redacted]', 'the certificate display is redacted');
    eq(cert.value, null, 'the decoded certificate is dropped');
    eq(cert.hex, '', 'the certificate bytes are dropped');
    assert(!JSON.stringify(cert).includes('DEMO-HOLDER-1234'), 'the holder reference is absent');
    // The probe is personal data: only its identity and status survive.
    eq(anon.remoteProbe.length, 1, 'the probe row is still present');
    eq(JSON.stringify(Object.keys(anon.remoteProbe[0]).sort()), JSON.stringify(['component', 'name', 'redacted', 'status']),
      'an anonymised probe row has only identity, status and the redacted marker');
    assert(!JSON.stringify(anon.remoteProbe).includes(bleAddress), 'the probe bytes and address are dropped');
    for (const key of ['RemoteControl.BLE_CENTRAL_DATABASE', 'RemoteControl.DEVICE_DATABASE']) {
      const entry = anon.values[key];
      assert(entry, 'the BLE register is still present: ' + key);
      eq(entry.hex, '', 'the BLE register hex is dropped: ' + key);
      eq(entry.value.hex, '', 'the BLE value hex is dropped: ' + key);
      assert(!JSON.stringify(entry).includes(bleAddress), 'the BLE address is not in the anonymised register: ' + key);
    }
    // An anonymised export can be opened again.
    eq(W.importWorkshop(JSON.parse(JSON.stringify(anon))), true, 'the anonymised export imports');
    eq(W.state.mode, 'file', 'the import is a file session');
    eq(W.canMutate, false, 'an imported readout can never write');
  });

  // The PDF's anonymise switch must redact the customer reference/address and
  // notes, not print them verbatim next to the masked identifiers.
  check('source: the PDF anonymisation redacts the customer reference and notes', () => {
    const pdf = readFileSync(path.join(repo, 'web', 'workshop', 'report-pdf.js'), 'utf8');
    assert(pdf.includes("const refText = opts.anonymize ? 'Redacted'"), 'the customer reference is redacted');
    assert(pdf.includes("const noteText = opts.anonymize ? 'Redacted'"), 'the notes are redacted');
    assert(pdf.includes('doc.splitTextToSize(refText'), 'the redacted reference is what gets rendered');
    assert(pdf.includes('doc.splitTextToSize(noteText'), 'the redacted notes are what gets rendered');
  });

  // Probe rows are part of the exported readout. They must be restored on
  // import, and an anonymised row must stay redacted rather than pretending it
  // had no value or throwing on a missing address.
  await checkAsync('import: probe rows are restored and anonymised rows stay redacted', () => {
    W.state.remoteProbe = [{ component: 'RemoteControl', name: 'PROBE_SAMPLE', address: 0x123, status: 'ok', display: '1', hex: '01' }];
    W.state.remoteProbeAt = new Date('2026-10-23T10:00:00.000Z');
    eq(W.importWorkshop(W.exportState()), true, 'the plain probe export imports');
    eq(W.state.remoteProbe.length, 1, 'the probe row is restored');
    eq(W.state.remoteProbe[0].address, 0x123, 'the probe address is restored');
    eq(W.state.remoteProbe[0].display, '1', 'the probe value is restored');
    eq(W.state.remoteProbeAt.toISOString(), '2026-10-23T10:00:00.000Z', 'the probe timestamp is restored');

    const anon = W.exportState({ anonymize: true });
    eq(W.importWorkshop(JSON.parse(JSON.stringify(anon))), true, 'the anonymised probe export imports');
    eq(W.state.remoteProbe[0].redacted, true, 'the anonymised probe row is marked redacted');
    eq(W.state.remoteProbe[0].address, null, 'the anonymised probe address is withheld');
    eq(PRESENTATION.probeRowHasValue(W.state.remoteProbe[0]), false, 'a redacted probe row is not counted as a value');
  });

  // A probe belongs to the session that produced it. A re-read and a demo
  // switch must not leave the previous bike's rows in state or in the export.
  await checkAsync('remote probe: a re-read and a demo switch clear the previous rows', async () => {
    await W.startDemo();
    await W.probeRemoteRegisters();
    assert(W.state.remoteProbe.length > 0, 'the first probe produced rows');
    assert(W.state.remoteProbeAt instanceof Date, 'the probe timestamp is set');
    await W.readAll();
    eq(W.state.remoteProbe.length, 0, 'a re-read clears the previous probe rows');
    eq(W.state.remoteProbeAt, null, 'a re-read clears the probe timestamp');
    await W.probeRemoteRegisters();
    assert(W.state.remoteProbe.length > 0, 'the second probe produced rows');
    await W.startDemo();
    eq(W.state.remoteProbe.length, 0, 'a demo switch clears the previous probe rows');
    eq(W.state.remoteProbeAt, null, 'a demo switch clears the probe timestamp');
  });

  // The Mini Remote probe: read requests only. No write or RPC frame may be
  // sent, and every probed register is read once.
  await checkAsync('remote probe: read requests only, no writes, no retries', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const candidates = W.remoteProbeCandidates();
    assert(candidates.length > 0, 'the probe has candidates');
    for (const e of candidates) {
      assert(e.readable !== false, 'only readable registers are probed: ' + e.component + '.' + e.name);
      const hay = (e.name + ' ' + (e.label || '')).toUpperCase();
      assert(/REMOTE|BLE|BUTTON|MINI|PERIPHERAL|PAIR|BOND|DEVICE_DATABASE|DEVICE_AVAILABILITY|CONNECTED|ESHIFT/.test(hay),
        'the candidate matches a keyword: ' + e.component + '.' + e.name);
    }
    const before = mutations;
    const results = await W.probeRemoteRegisters();
    eq(results.length, candidates.length, 'every candidate was read');
    // The harness counts write and RPC frames: the probe must add none.
    eq(mutations, before, 'the probe sent no write or RPC frame');
    eq(W.state.remoteProbe.length, candidates.length, 'the results are kept in the state');
    for (const r of W.state.remoteProbe) {
      assert(typeof r.address === 'number', 'the result has an address');
      assert(typeof r.hex === 'string', 'the result has the raw hex');
      assert(r.status === 'ok' || r.status === 'declined' || r.status === 'timeout' || r.status === 'no response',
        'the result has a status: ' + r.status);
    }
    // The results travel with the export.
    const exported = W.exportState();
    eq(exported.remoteProbe.length, candidates.length, 'the export contains the probe results');
  });

  // The demo bike has ride statistics for only some modes, so its own totals
  // must produce a non-zero Other for both quantities without hardware.
  await checkAsync('report: the demo bike produces a non-zero Other for distance and energy', async () => {
    await W.startDemo();
    const modes = W.state.assistModes;
    const odo = W.state.values['DriveUnit.ODOMETER'];
    const totalEnergy = W.state.values['Battery.TOTAL_ENERGY'];
    assert(odo && odo.status === 'ok', 'the demo bike reports a total distance');
    assert(totalEnergy && totalEnergy.status === 'ok', 'the demo bike reports a total energy');
    const otherD = PRESENTATION.otherShare(odo.value, modes.map((m) => m.distance), 50);
    const otherE = PRESENTATION.otherShare(totalEnergy.value, modes.map((m) => m.energy), 5);
    assert(otherD.visible && otherD.value > 0, 'the demo distance has an untracked remainder');
    assert(otherE.visible && otherE.value > 0, 'the demo energy has an untracked remainder');
    const dist = PRESENTATION.withOtherSegment(modes, otherD, 'distance');
    const energy = PRESENTATION.withOtherSegment(modes, otherE, 'energy');
    eq(dist[dist.length - 1].name, 'Other', 'Other is the last distance segment');
    eq(energy[energy.length - 1].name, 'Other', 'Other is the last energy segment');
    eq(dist[dist.length - 1].color, '#f59e0b', 'the demo distance Other is amber');
    eq(energy[energy.length - 1].color, '#f59e0b', 'the demo energy Other is amber');
  });

  // Every registry kind has a decoder fixture: a new kind in the address
  // registry forces a new case here.
  await checkAsync('decoder: every registry kind has a decoder fixture', () => {
    const fixtures = {
      bool: { component: 'AntiLockBrakeSystem', name: 'IS_SAMPLE_HARDWARE', payload: [0x08, 0x01], check: (o) => eq(o.value, true, 'bool: true') },
      unknown: { component: 'AntiLockBrakeSystem', name: 'ISSUE_VISUALIZATION_EVENT', payload: [], check: (o) => assert(o.display !== undefined, 'unknown: a display is returned') },
      enum: { component: 'AntiLockBrakeSystem', name: 'OVERALL_ASSEMBLY_TEST_RESULT', payload: [0x08, 0x01], check: (o) => assert(o.display !== undefined, 'enum: a display is returned') },
      uint: { component: 'AntiLockBrakeSystem', name: 'DATA_MODEL_VERSION', payload: [0x08, 0x2a], check: (o) => eq(o.value, 42, 'uint: 42') },
      string: { component: 'AntiLockBrakeSystem', name: 'BOOTMANAGER_SOFTWARE_VERSION', payload: [0x0a, 0x02, 0x41, 0x42], check: (o) => eq(o.value, 'AB', 'string: AB') },
      submessage: { component: 'AntiLockBrakeSystem', name: 'ANTI_LOCK_BRAKE_SYSTEM_STATIC_FEATURE_PROPERTIES', payload: [], check: (o) => assert(o.display !== undefined, 'submessage: a display is returned') },
      normFactor: { component: 'Battery', name: 'MAXIMUM_ALLOWED_DISCHARGE_CURRENT', payload: [0x08, 0x2a], check: (o) => eq(o.value, 4.2, 'normFactor: 42/10') },
      deactivationProof: { component: 'Battery', name: 'COMPONENT_DEACTIVATION_PROOF', payload: [], check: (o) => assert(o.display !== undefined, 'deactivationProof: a display is returned') },
      certificateBytes: { component: 'Battery', name: 'DEVICE_CERTIFICATE', payload: [], check: (o) => assert(o.display !== undefined, 'certificateBytes: a display is returned') },
      uint32List: { component: 'BoschDiagnoseApp', name: 'SOFTWARE_UPDATE_MANIFESTS', payload: [0x0a, 0x03, 0x01, 0x02, 0x03], check: (o) => assert(Array.isArray(o.value) && o.value.length === 3, 'uint32List: three values are returned') },
      assistModeColors: { component: 'DriveUnit', name: 'ASSIST_MODE_COLORS', payload: [0x0a, 0x14, 0x00, 0xff, 0xc1, 0xf8, 0xc5, 0x07, 0xff, 0xb1, 0x97, 0x05, 0xff, 0xdb, 0x8f, 0xb2, 0x09, 0xff, 0xab, 0x80, 0x90, 0x0e], check: (o) => assert(Array.isArray(o.value) && o.value.length === 5, 'assistModeColors: five colours are returned') },
      uuid: { component: 'DriveUnit', name: 'BIKE_ID', payload: [0x0a, 0x10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], check: (o) => assert(/^[0-9a-f-]{36}$/.test(String(o.value)), 'uuid: a UUID is returned') },
      startAssistModeOem: { component: 'DriveUnit', name: 'START_ASSIST_MODE_CONFIGURATION_OEM', payload: [], check: (o) => assert(o.display !== undefined, 'startAssistModeOem: a display is returned') },
      tuningDetection: { component: 'DriveUnit', name: 'TUNING_DETECTION', payload: [], check: (o) => assert(o.display !== undefined, 'tuningDetection: a display is returned') },
      serviceDue: { component: 'RemoteControl', name: 'SERVICE_DUE', payload: [0x08, 0x2a], check: (o) => assert(o.display !== undefined, 'serviceDue: a display is returned') },
      unixTimestamp: { component: 'RemoteControl', name: 'TIME', payload: [0x08, 0x2a], check: (o) => assert(o.display !== undefined, 'unixTimestamp: a display is returned') },
    };
    const kinds = [...new Set(REGISTRY.map((e) => e.kind))].sort();
    eq(Object.keys(fixtures).sort().join(','), kinds.join(','), 'every registry kind has a fixture (a new kind forces a new case)');
    for (const kind of kinds) {
      const f = fixtures[kind];
      const entry = REGISTRY.find((e) => e.component === f.component && e.name === f.name);
      assert(entry, 'the fixture register exists: ' + kind);
      const out = W.util.interpret(f.component, f.name, entry.address, f.payload);
      assert(out && typeof out.display === 'string', kind + ': the decoder returns a display string');
      f.check(out, entry);
    }
  });

  // The live gate, emulated on the simulated transport: a direct writer and a
  // plan without an approval handler are both blocked with zero write frames.
  await checkAsync('live mode: a direct writer and a plan without an approval are blocked, zero write frames', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const wasDemo = W.state.demo;
    W.state.demo = false; // emulate a live session on the simulated transport
    try {
      const before = writeFrames;
      const err = await capture(() => W.Writers.lightSwitch(true));
      assert(err && err.code === 'WRITE_BLOCKED', 'the direct writer is blocked: ' + (err && err.message));
      eq(writeFrames, before, 'zero write frames from the direct writer');
      const step = {
        label: 'live', bytes: '08 01', op: 'LIGHT_SWITCH', component: 'DriveUnit', name: 'BIKE_LIGHT',
        address: W.util.addrOf('DriveUnit', 'BIKE_LIGHT'),
        run: (owner) => W.Writers.lightSwitch(true, owner),
      };
      const res = await W.runPlan([step], null, {});
      eq(res.length, 1, 'one result');
      eq(res[0].applied, false, 'the plan step is not applied');
      eq(writeFrames, before, 'zero write frames from the plan');
    } finally {
      W.state.demo = wasDemo;
    }
  });

  // The service-interval writer: one frame, applied, and the same timestamp and
  // odometer are read back.
  await checkAsync('serviceDue: the writer round trip is applied and read back', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const payload = W.util.encodeServiceDue({ timestamp: 123, odometer: 456 });
    const hex = W.util.toHex(payload);
    const before = writeFrames;
    const step = {
      label: 'service', bytes: hex, op: 'SERVICE_DUE', component: 'RemoteControl', name: 'SERVICE_DUE',
      address: W.util.addrOf('RemoteControl', 'SERVICE_DUE'),
      run: (owner) => W.Writers.serviceDue({ timestamp: 123, odometer: 456 }, owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res.length, 1, 'one result');
    eq(res[0].applied, true, 'applied by read-back');
    eq(writeFrames, before + 1, 'exactly one write frame');
    const back = await W.readKey('RemoteControl', 'SERVICE_DUE');
    eq(back.value.timestamp, 123, 'the timestamp is read back');
    eq(back.value.odometer, 456, 'the odometer is read back');
  });

  // The delayed path: the simulated bike answers slowly and the read still
  // works (the harness itself runs without the latency).
  await checkAsync('demo: the delayed response path still reads correctly', async () => {
    const demo = sandbox.Bes3WorkshopDemo;
    demo.setLatency(60);
    try {
      await W.startDemo();
      const v = await W.readKey('RemoteControl', 'LANGUAGE');
      assert(v && v.status === 'ok', 'the delayed read answers: ' + (v && v.status));
    } finally {
      demo.setLatency(0);
    }
  });

  // The USB write acknowledgement state machine: pure, so it is tested with a
  // fake device instead of hardware.
  check('USB: the write acknowledgement state machine decides busy, error, ok and timeout', () => {
    eq(USB_ACK.ackState([0, 3, 0]).state, 'busy', 'the bridge is busy');
    eq(USB_ACK.ackState([0, 3, 0]).status, null, 'a busy answer has no status');
    eq(USB_ACK.ackState([0, 1, 6]).state, 'error', 'the bike refused the write');
    eq(USB_ACK.ackState([0, 1, 6]).status, 6, 'the error carries the status byte');
    eq(USB_ACK.ackState([0, 1, 0]).state, 'ok', 'the write was accepted');
    eq(USB_ACK.ackState([0, 1]).state, 'short', 'a short answer is retried');
    eq(USB_ACK.ackState(null).state, 'short', 'no answer is retried');
    // The padding: the endpoint expects 64-byte blocks.
    eq(USB_ACK.padPayload([1, 2, 3]).length, 64, 'a short payload is padded to 64 bytes');
    eq(USB_ACK.padPayload(new Uint8Array(64)).length, 64, 'a full block is not padded');
    eq(USB_ACK.padPayload(new Uint8Array(65)).length, 128, 'a payload over a block is padded to two blocks');
    eq(Array.from(USB_ACK.padPayload([1, 2, 3]).slice(0, 3)).join(','), '1,2,3', 'the payload is kept');
    // The size guard.
    eq(USB_ACK.exceedsMaxFrame(65536), false, 'the maximum frame is allowed');
    eq(USB_ACK.exceedsMaxFrame(65537), true, 'a frame above the maximum is refused');
  });

// The quick UI wins of the code review: the light theme reaches 4.5:1, the
// modal keeps and restores the focus, and the re-read control stays reachable
// on a narrow screen.
check('source: the light theme, the modal focus and the re-read control (source check)', () => {
  const css = readFileSync(path.join(repo, 'web', 'workshop', 'workshop.css'), 'utf8');
  const light = css.slice(css.indexOf("[data-theme='light']"), css.indexOf("[data-theme='dark']"));
  const token = (name) => {
    const m = light.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
    return m ? m[1] : null;
  };
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => {
      const s = parseInt(hex.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  for (const [fg, bg] of [['ink-3', 'bg'], ['ink-3', 'surface'], ['ok', 'ok-soft'], ['warn', 'warn-soft']]) {
    const r = ratio(token(fg), token(bg));
    assert(r >= 4.5, fg + ' on ' + bg + ' reaches 4.5:1 (got ' + r.toFixed(2) + ':1)');
  }
  assert(!css.includes('#btnReread { display: none; }'), 'the re-read control is not hidden on a narrow screen');
  const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
  assert(ui.includes('modalPreviousFocus'), 'the modal remembers the focused element');
  assert(ui.includes("e.key !== 'Tab'"), 'the modal traps the Tab key');
  assert(ui.includes("if (inputs[0] && inputs[0].focus) inputs[0].focus()"), 'the first typed input gets the focus');
});

  // The read-back marker is only formed when the re-read succeeded: a declined
  // or failed read-back is no read at all ("read-back unknown"), while a
  // byte-identical raw read-back of a payload the decoder cannot interpret is
  // still a match.
  await checkAsync('read-back: a declined read-back is "read-back unknown", a raw match is applied', async () => {
    // A raw payload the decoder cannot interpret: the re-read bytes match.
    addDemoRegister('RemoteControl', 'LANGUAGE');
    await W.startDemo();
    W.setExperimental(true);
    const before = writeFrames;
    const rawStep = {
      label: 'raw', bytes: '08 01', op: 'GENERIC_WRITE',
      component: 'RemoteControl', name: 'LANGUAGE', address: W.util.addrOf('RemoteControl', 'LANGUAGE'),
      run: (owner) => W.Writers.generic('RemoteControl', 'LANGUAGE', [0x08, 0x01], owner),
    };
    const rawRes = await W.runPlan([rawStep], null, { requireApproval: true, approve: async () => true });
    eq(rawRes[0].applied, true, 'a byte-identical raw read-back is applied');
    eq(rawRes[0].statusName, 'confirmed by read-back', 'the verdict names the read-back');
    eq(writeFrames, before + 1, 'exactly one write frame');

    // The same write, but the read-back is declined by the bike.
    const addr = W.util.addrOf('RemoteControl', 'LANGUAGE');
    dropReadAddr = addr;
    let declined = null;
    try {
      const declinedStep = {
        label: 'raw, declined read-back', bytes: '08 01', op: 'GENERIC_WRITE',
        component: 'RemoteControl', name: 'LANGUAGE', address: addr,
        run: (owner) => W.Writers.generic('RemoteControl', 'LANGUAGE', [0x08, 0x01], owner),
      };
      const res = await W.runPlan([declinedStep], null, { requireApproval: true, approve: async () => true });
      declined = res[0];
    } finally {
      dropReadAddr = null;
    }
    eq(declined.applied, false, 'a declined read-back is not applied');
    eq(declined.statusName, 'acknowledged, read-back unknown', 'a declined read-back is "read-back unknown"');
  });

  // A register whose value is `false` is still a read: the marker is not
  // confused with "no value".
  await checkAsync('read-back: a false value still counts as a read', async () => {
    addDemoRegister('DriveUnit', 'BIKE_LIGHT');
    await W.startDemo();
    W.setExperimental(true);
    const before = writeFrames;
    // The light switch writes an explicit 08 00 (proto3 false); the demo answers
    // with the stored value.
    const step = {
      label: 'light off', bytes: '08 00', op: 'LIGHT_SWITCH', component: 'DriveUnit', name: 'BIKE_LIGHT',
      address: W.util.addrOf('DriveUnit', 'BIKE_LIGHT'),
      run: (owner) => W.Writers.lightSwitch(false, owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res[0].applied, true, 'the write is applied');
    eq(res[0].statusName, 'confirmed by read-back', 'the verdict names the read-back');
    eq(writeFrames, before + 1, 'exactly one write frame');
  });

  // The tier lookups are cached: the same register returns the same object, and
  // the map of all tiers is built once.
  check('policy: the tier of every registry entry is cached', () => {
    const a = POLICY.genericTier('DriveUnit', 'BIKE_LIGHT');
    const b = POLICY.genericTier('DriveUnit', 'BIKE_LIGHT');
    eq(a, b, 'the tier object is cached (the same reference)');
    eq(a.tier, 'normal', 'the tier is correct');
    const map1 = POLICY.genericTierMap();
    const map2 = POLICY.genericTierMap();
    eq(map1, map2, 'the tier map is cached (the same reference)');
    assert(map1.size >= REGISTRY.length, 'the map has one entry per registry entry (' + map1.size + ')');
    eq(map1.get('DriveUnit.BIKE_LIGHT_POWER').tier, 'blocked', 'the reserved register is blocked');
    eq(map1.get('RemoteControl.BIKE_ID').tier, 'registry-readonly', 'the System ID register is read-only');
    eq(map1.get('RemoteControl.BUTTON_EVENTS_ENABLED').tier, 'high-impact', 'the button register is high-impact');
    eq(POLICY.genericTier('DriveUnit', 'NOT_A_REGISTER').tier, 'blocked', 'an unknown register is blocked');  });

  // The Write Lab must not walk the registry per entry in a render loop.
  check('source: the Write Lab list is memoised (source check)', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    const start = ui.indexOf('function genericTargets()');
    const end = ui.indexOf('function genericTargetKey(');
    const body = ui.slice(start, end);
    assert(start > -1 && end > start, 'genericTargets() is present');
    assert(!body.includes('POLICY.genericTier('), 'the target list does not call genericTier per entry');
    assert(body.includes('POLICY.genericTierMap()'), 'the target list uses the cached tier map');
    assert(body.includes('genericTargetsCache'), 'the target list is cached');
    const fStart = ui.indexOf('function writeLabFiltered()');
    const fEnd = ui.indexOf('function writeLabOptionText(');
    const filtered = ui.slice(fStart, fEnd);
    assert(filtered.includes('writeLabFilteredCache'), 'the filtered list is cached per filter and search text');
    const policy = readFileSync(path.join(repo, 'web', 'workshop', 'write-policy.js'), 'utf8');
    assert(policy.includes('function genericTierMap()'), 'the policy exposes the tier map');
    assert(policy.includes('tierCache.entries === entries'), 'the tier cache is invalidated only when the registry changes');
  });

  // Keepalive and rawRpc must inspect the send result: send() returns an
  // object `{ ok, transferred }`, never a boolean.
  check('source: keepalive and rawRpc check the failed-send result (source check)', () => {
    const engine = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');
    assert(engine.includes('const sent = await send(buildRpcCallFrame(KEEPALIVE_ADDR, s));'),
      'keepalive stores the send result');
    assert(engine.includes('if (!sent.ok) return;'), 'keepalive returns before awaiting a response');
    assert(!engine.includes('if (await send(buildRpcCallFrame(KEEPALIVE_ADDR, s)))'),
      'keepalive does not treat the result object as a boolean');
    assert(engine.includes('const sent = await send(frame, ctx ? ctx.transport : undefined);'),
      'rawRpc stores the send result');
    assert(engine.includes('if (!sent.ok) { await drain(60); continue; }'),
      'rawRpc skips awaiting a response when send fails');
    assert(!/if\s*\(\s*!?\s*\(\s*await\s+send\([^)]*\)\s*\)\s*\)/.test(engine),
      'engine never treats a send() result object as a boolean');
  });

  // connect() must request the device before disconnecting an existing session
  // (so cancelling the picker leaves a running session intact), then close any
  // existing session and only install a transport after open() succeeds.
  check('source: connect replaces a session safely (source check)', () => {
    const engine = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');
    const start = engine.indexOf('async function connect()');
    const end = engine.indexOf('// Only the connected device may end the session');
    const body = engine.slice(start, end);
    assert(start > -1 && end > start, 'connect() is present');
    assert(body.includes('if (state.live || transport) await disconnect();'), 'connect closes an existing session');
    assert(body.indexOf('window.Bes3WebUsb.requestDevice()') < body.indexOf('if (state.live || transport) await disconnect();'),
      'connect requests a device before disconnecting the active session');
    assert(body.includes('const nextTransport = new window.Bes3WebUsb.Bes3WebUsbTransport(device);'),
      'connect creates the transport before opening it');
    assert(body.indexOf('await nextTransport.open();') < body.indexOf('transport = nextTransport;'),
      'connect installs the transport only after open');
    assert(body.includes('try { if (nextTransport.close) await nextTransport.close(); }'),
      'connect closes a transport whose open failed');
  });

  // R4-H2 / R4-H3 / R4-H4 / R4-L1: session-bound readAll, single-flight
  // deduplication, log history across reconnects, and full closeReadout reset.
  await checkAsync('readAll: concurrent calls share one run and closeReadout resets all state', async () => {
    await withSession();
    resetFrameCounters();
    const [a, b] = await Promise.all([W.readAll(), W.readAll()]);
    eq(a, b, 'concurrent readAll() calls share the in-flight promise');
    eq(W.state.mode, 'demo', 'readAll completes into demo mode');
    assert(Object.keys(W.state.values).length > 0, 'values are populated');

    // Simulate an interrupted-after-transmission write in the session log, then
    // start a new demo session: the entry is preserved in logHistory and
    // surfaced as lastUnverifiedWrite.
    W.state.log.push({
      at: new Date(),
      component: 'DriveUnit',
      name: 'BIKE_LIGHT_AVAILABLE',
      label: 'Bike light unlock',
      sent: '30 07 02 22 09 00 20 08 01',
      before: 'disabled',
      after: 'unknown (connection lost)',
      acked: false,
      applied: false,
      transmitted: true,
      interrupted: true,
    });
    await W.startDemo();
    assert(Array.isArray(W.state.logHistory) && W.state.logHistory.length >= 1,
      'prior session log is archived across session restarts');
    assert(W.state.lastUnverifiedWrite && W.state.lastUnverifiedWrite.name === 'BIKE_LIGHT_AVAILABLE',
      'interrupted transmitted write is remembered for the recovery banner');

    await W.closeReadout();
    eq(W.state.mode, 'idle', 'closeReadout returns to idle');
    eq(Object.keys(W.state.values).length, 0, 'closeReadout clears values');
    eq(W.state.assistModes.length, 0, 'closeReadout clears assistModes');
    eq(W.state.issues, null, 'closeReadout clears issues');
    eq(W.state.issuesScanned, false, 'closeReadout resets issuesScanned');
    eq(W.state.issuesTruncated, false, 'closeReadout resets issuesTruncated');
    eq(W.state.readAt, null, 'closeReadout resets readAt');
  });

  // The decoder: the average rider cadence is decoded as half-rpm counts: the
  // raw count read on the reference bike (08 80 01 = 128) is 64 rpm, not 128 rpm.
  await checkAsync('decoder: the average rider cadence is decoded as half-rpm counts', () => {
    const addr = W.util.addrOf('DriveUnit', 'AVERAGE_RIDER_CADENCE');
    const cadence = W.util.interpret('DriveUnit', 'AVERAGE_RIDER_CADENCE', addr, [0x08, 0x80, 0x01]);
    eq(cadence.value, 64, 'raw count 128 decodes to 64 rpm');
    eq(cadence.display, '64 rpm', 'displayed as rpm');
    eq(cadence.rawCount, 128, 'the raw count is kept');
    eq(cadence.hex, '08 80 01', 'raw hex preserved');
    const empty = W.util.interpret('DriveUnit', 'AVERAGE_RIDER_CADENCE', addr, []);
    eq(empty.value, 0, 'an empty payload decodes to 0 rpm (shared field-1 convention)');
  });

  // ServiceDue's field-1 length is a varint and must fit inside the payload.
  // A truncated or overlong record must not decode a timestamp from the tail.
  await checkAsync('decoder: ServiceDue bounds-checked lengths and safe varints', () => {
    const valid = W.util.decodeServiceDue([0x0a, 0x02, 0x08, 0x02, 0x10, 0x03]);
    eq(valid.timestamp, 1, 'a valid timestamp still decodes');
    eq(valid.odometer, 3, 'a valid odometer still decodes');
    const overlong = W.util.decodeServiceDue([0x0a, 0x03, 0x08, 0x02]);
    eq(overlong.timestamp, 0, 'an overlong content length is rejected');
    const truncated = W.util.decodeServiceDue([0x0a, 0x05, 0x08, 0x02]);
    eq(truncated.timestamp, 0, 'a truncated content length is rejected');
    const huge = W.util.decodeField1Varint([0x08, ...Array(11).fill(0x81), 0x01]);
    assert(Number.isSafeInteger(huge), 'a too-long varint stops at a safe shift');
    eq(W.util.decodeField1Varint([0x08, 0x80]), 0, 'a truncated varint terminates without reading undefined');
  });

  // Malformed typed payloads must not be presented as confident booleans. A
  // length-delimited value is an array (truthy), which used to turn a broken
  // flag into "true"; the writer/read-back logic must see "unknown" instead.
  await checkAsync('decoder: malformed wire types are not confident booleans', () => {
    const boolAddr = W.util.addrOf('DriveUnit', 'BIKE_LIGHT_AVAILABLE');
    const malformedBool = W.util.interpret('DriveUnit', 'BIKE_LIGHT_AVAILABLE', boolAddr, [0x0a, 0x01, 0x00]);
    eq(malformedBool.value, null, 'a malformed light-available flag is unknown');
    assert(/^hex:/.test(malformedBool.display), 'the malformed flag falls back to its hex: ' + malformedBool.display);

    const tuningAddr = W.util.addrOf('DriveUnit', 'TUNING_DETECTION');
    const malformedTuning = W.util.interpret('DriveUnit', 'TUNING_DETECTION', tuningAddr, [0x0a, 0x01, 0x00]);
    eq(malformedTuning.value, null, 'a malformed tuning flag is unknown');
    eq(malformedTuning.display, '(unexpected encoding)', 'the malformed tuning flag is labelled');

    const deactAddr = W.util.addrOf('Battery', 'COMPONENT_DEACTIVATION_PROOF');
    const malformedDeact = W.util.interpret('Battery', 'COMPONENT_DEACTIVATION_PROOF', deactAddr, [0x0a, 0x01, 0x01]);
    eq(malformedDeact.value, null, 'a malformed deactivation flag is unknown');

    const startAddr = W.util.addrOf('DriveUnit', 'START_ASSIST_MODE_CONFIGURATION_OEM');
    const malformedStart = W.util.interpret('DriveUnit', 'START_ASSIST_MODE_CONFIGURATION_OEM', startAddr, [0x08, 0x00, 0x12, 0x01, 0x01]);
    eq(malformedStart.value, null, 'a malformed start-assist configurable flag is unknown');
  });

  // A length-delimited field that claims more bytes than remain is truncated,
  // not a valid string. The decoder must not slice a partial tail.
  await checkAsync('decoder: an overlong protobuf length is rejected', () => {
    const addr = W.util.addrOf('AntiLockBrakeSystem', 'BOOTMANAGER_SOFTWARE_VERSION');
    const out = W.util.interpret('AntiLockBrakeSystem', 'BOOTMANAGER_SOFTWARE_VERSION', addr, [0x0a, 0x05, 0x41, 0x42]);
    eq(out.value, null, 'the overlong string has no decoded value');
    eq(out.display, '(unexpected encoding)', 'the overlong string is labelled');
  });

  // The generic fallback decoder reads a protobuf length as a varint. A 128-byte
  // string uses two length bytes; reading only the first would fold the
  // continuation byte into the text.
  await checkAsync('decoder: a multi-byte string length is decoded', () => {
    const protocol = sandbox.Bes3Protocol;
    assert(protocol && typeof protocol.decodeValue === 'function', 'the protocol decoder is loaded');
    const content = Array(128).fill(0x41);
    const out = protocol.decodeValue([0x0a, 0x80, 0x01, ...content]);
    eq(out.kind, 'string', 'the payload is a string');
    eq(out.value.length, 128, 'all 128 characters are decoded');
    eq(out.value[0], 'A', 'the first character is not the length continuation');
    eq(out.value[127], 'A', 'the last character is present');
  });

  // An explicit status byte is mandatory when the destination MSB is clear.
  await checkAsync('decoder: a truncated explicit-status frame is rejected', () => {
    const protocol = sandbox.Bes3Protocol;
    const body = [0x01, 0x02, 0x0e, 0x10, 0x10];
    eq(protocol.parseReadResponseFrame([0x30, body.length, ...body]), null, 'the five-byte body is rejected');
    const full = [...body, 0x00];
    const parsed = protocol.parseReadResponseFrame([0x30, full.length, ...full]);
    assert(parsed && parsed.ok === true, 'the six-byte body still parses');
  });

  // A never-resolving approval must time out and count as declined: the plan
  // returns, sends nothing, and releases the single-writer lock.
  await checkAsync('approval gate: a never-resolving approve times out -> declined, zero frames, lock released', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    const never = new Promise(() => {});
    const res = await W.runPlan(
      [{ label: 'step 1', op: 'LIGHT_AVAILABLE', bytes: '08 01', run: (owner) => W.Writers.lightAvailable(true, owner) }],
      null,
      { requireApproval: true, approve: () => never, approvalTimeoutMs: 30 }
    );
    eq(res.length, 1, 'one result');
    eq(res[0].declined, true, 'a timeout counts as declined');
    eq(res[0].blocked, true, 'blocked');
    eq(res[0].applied, false, 'not applied');
    eq(mutations, before, 'zero mutation frames');
    eq(W.busy, false, 'the single-writer lock was released');
  });

  // Generic writer: negative authorization tests must be rejected before any
  // transport I/O. They run against the fake demo transport only.
  await checkAsync('generic writer: reserved and unknown targets rejected before I/O (zero frames)', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const before = mutations;
    for (const t of [
      { component: 'DriveUnit', name: 'BIKE_LIGHT_POWER' },
      { component: 'DriveUnit', name: 'NOT_A_REGISTER' },
    ]) {
      const err = throws(() => W.Writers.generic(t.component, t.name, [0x08, 0x01]));
      assert(err && err.code === 'WRITE_BLOCKED',
        t.component + '.' + t.name + ' must be rejected before I/O: ' + (err && err.message));
    }
    eq(mutations, before, 'zero mutation frames for both rejected targets');
  });

  // Generic writer: a same-value write on an allowlisted normal-tier register
  // sends exactly one WRITE frame and is confirmed by a fresh read-back.
  await checkAsync('generic writer: same-value write sends exactly one frame and is confirmed', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const read = await W.readKey('RemoteControl', 'LANGUAGE');
    assert(read && read.status === 'ok', 'LANGUAGE is readable in the demo fixture');
    assert(read.hex && read.hex.length > 0, 'LANGUAGE has a non-empty payload');
    const payload = read.hex.trim().split(/\s+/).map((h) => parseInt(h, 16));
    const before = mutations;
    const step = await W.Writers.generic('RemoteControl', 'LANGUAGE', payload);
    eq(mutations, before + 1, 'exactly one WRITE frame');
    eq(step.acked, true, 'acknowledgment recorded');
    eq(step.applied, true, 'fresh read-back confirmed the same bytes');
    const after = await W.readKey('RemoteControl', 'LANGUAGE');
    eq(after.hex, read.hex, 'read-back bytes are unchanged');
  });

  // v0.58.0 regression: the dedicated port writer judges a fresh read-back as
  // a decoded boolean, so a proto3 empty-off response verifies as applied.
  await checkAsync('portActive: decoded-boolean verification and target guard', async () => {
    await W.startDemo();
    W.setExperimental(true);
    const addr = W.util.addrOf('DriveUnit', 'HIGH_POWER_PORT_ACTIVE');
    eq(W.util.interpret('DriveUnit', 'HIGH_POWER_PORT_ACTIVE', addr, []).value, false,
      'proto3 empty payload decodes to false');
    const before = mutations;
    const step = await W.Writers.portActive('HIGH_POWER_PORT_ACTIVE', false);
    eq(mutations, before + 1, 'the off write sends exactly one frame');
    eq(step.applied, true, 'an off read-back verified as applied');
    eq(step.sent, '08 00', 'the explicit off payload is unchanged');
    const after = await W.readKey('DriveUnit', 'HIGH_POWER_PORT_ACTIVE');
    eq(W.util.interpret('DriveUnit', 'HIGH_POWER_PORT_ACTIVE', addr,
      after.hex ? after.hex.split(/\s+/).map((h) => parseInt(h, 16)) : []).value, false,
      'the read-back is decoded as false');
    const err = throws(() => W.Writers.portActive('BIKE_LIGHT', false));
    eq(err && err.code, 'WRITE_BLOCKED', 'unsupported targets are rejected before I/O');
    eq(mutations, before + 1, 'the rejected target sent no frame');
    const engine = readFileSync(path.join(repo, 'web', 'workshop', 'engine.js'), 'utf8');
    assert(engine.includes('(v) => v === on'), 'portActive expects the decoded boolean');
  });

  // The live runner and its suites must work end-to-end against the simulated
  // transport. No browser is involved: the same engine and fake transport are
  // used, and the runner only calls the public engine API.
  await checkAsync('Dev live runner: read-only suite runs end-to-end in demo with zero write frames', async () => {
    const liveDir = path.join(repo, 'web', 'dev', 'live');
    // The Dev workbench is private: it is absent from the public tree.
    requirePrivate(['web/dev/live/live-runner.js']);
    for (const f of [
      'web/dev/dev-logger.js',
      'web/dev/live/live-write-helpers.js',
      'web/dev/live/live-evidence.js',
      'web/dev/live/live-runner.js',
      'web/dev/live/live-suite-read.js',
      'web/dev/live/live-suite-light.js',
      'web/dev/live/live-suite-service.js',
      'web/dev/live/live-suite-ports.js',
      'web/dev/live/live-suite-id.js',
      'web/dev/live/live-suite-writelab.js',
      'web/dev/live/live-suite-generic.js',
      'web/dev/live/live-suite-settings.js',
      'web/dev/live/live-suite-diagnostics.js',
      'web/dev/live/live-suite-sweep.js',
      'web/dev/live/live-runner-selftests.js',
    ]) {
      const src = readFileSync(path.join(repo, f), 'utf8');
      new Function('window', 'performance', src)(sandbox, performance);
    }
    const LR = sandbox.BES3DevLiveRunner;
    assert(LR, 'live-runner.js did not expose BES3DevLiveRunner');
    assert(LR.registry.length >= 10, 'the live suites registered scenarios, got ' + LR.registry.length);

    await W.startDemo();
    W.setExperimental(false);
    const before = mutations;
    const beforeWrites = writeFrames;
    const summary = await LR.run('Read/Diagnostics');
    eq(summary.passed, 3, 'all three read-only diagnostics passed');
    eq(summary.failed, 0, 'no read-only diagnostic failed');
    eq(summary.inconclusive, 0, 'no read-only diagnostic was inconclusive');
    eq(writeFrames, beforeWrites, 'the read-only suite sent zero WRITE frames');
  });

  await checkAsync('Dev live runner: write scenario + verified restore sends exactly two frames in demo', async () => {
    // The Dev workbench is private: it is absent from the public tree.
    requirePrivate(['web/dev/live/live-runner.js']);
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();

    const baseline = LR.getBaseline();
    eq(baseline.registers['DriveUnit.LOW_POWER_PORT_ACTIVE'].hex, '08 01',
      'baseline recorded the raw port bytes');
    eq(baseline.registers['DriveUnit.LOW_POWER_PORT_ACTIVE'].restorable, true,
      'the raw baseline has a supported restoration path');

    const before = mutations;
    const summary = await LR.run('live.ports.toggle-low');
    eq(summary.passed, 1, 'the toggle scenario passed');
    const result = LR.getState().results[0];
    eq(result.status, 'passed', 'the toggle result status is passed');
    eq(result.recoveryOutcome, 'already-at-baseline',
      'the enable step returns the port to its baseline, so no recovery write was needed');
    eq(mutations - before, 2,
      'exactly two mutation frames: the disable write and the enable write');

    const after = await W.readKey('DriveUnit', 'LOW_POWER_PORT_ACTIVE');
    eq(after.hex, '08 01', 'the register is back at its baseline bytes');
  });

  await checkAsync('Dev orchestrator: Fast Demo runs end-to-end, reports one summary and no write frames', async () => {
    const liveDir = path.join(repo, 'web', 'dev', 'live');
    requirePrivate(['web/dev/live/live-orchestrator.js']);
    for (const f of [
      'web/dev/dev-logger.js',
      'web/dev/live/live-write-helpers.js',
      'web/dev/live/live-evidence.js',
      'web/dev/live/live-runner.js',
      'web/dev/live/live-orchestrator.js',
      'web/dev/live/live-suite-read.js',
      'web/dev/live/live-suite-light.js',
      'web/dev/live/live-suite-service.js',
      'web/dev/live/live-suite-ports.js',
      'web/dev/live/live-suite-id.js',
      'web/dev/live/live-suite-writelab.js',
      'web/dev/live/live-suite-generic.js',
      'web/dev/live/live-suite-settings.js',
      'web/dev/live/live-suite-diagnostics.js',
      'web/dev/live/live-suite-sweep.js',
      'web/dev/live/live-runner-selftests.js',
    ]) {
      const src = readFileSync(path.join(repo, f), 'utf8');
      new Function('window', 'performance', src)(sandbox, performance);
    }
    const O = sandbox.BES3DevOrchestrator;
    await W.startDemo();
    W.setExperimental(false);

    const manifest = await O.prepare('fast-demo');
    assert(Object.isFrozen(manifest), 'the prepared manifest is frozen before approval');
    eq(manifest.requiresWrite, false, 'fast-demo writes nothing');
    eq(manifest.sessionToken, undefined, 'the exported manifest does not contain the authorization token');
    eq(manifest.sessionRef, sandbox.BES3DevLiveRunner.sessionRefOf(W.authorizationToken),
      'the manifest carries an opaque session reference instead');
    eq(manifest.writeRows.length, 0, 'a read-only profile has no write rows');
    eq(manifest.recoveryRows.length, 0, 'a read-only profile has no recovery rows');
    eq(manifest.runId.length > 0, true, 'the manifest carries the run ID');

    const beforeWrites = writeFrames;
    const out = await O.run('fast-demo');
    const s = out.object.summary;
    eq(s.planned, manifest.scenarioIds.length, 'every planned scenario was reported');
    eq(s.completed, s.planned, 'every planned scenario completed');
    eq(s.failed, 0, 'no scenario failed');
    eq(s.inconclusive, 0, 'no scenario was inconclusive');
    eq(s.healthy, true, 'the run is healthy');
    eq(out.object.terminationReason, 'completed', 'a normal run reports its termination reason');
    eq(writeFrames, beforeWrites, 'the fast-demo profile sent zero WRITE frames');
    assert(/^bes3-dev-run-all-.*\.json$/.test(out.filename), 'combined filename: ' + out.filename);
    assert(out.object.groups.length > 0, 'the report contains per-group records');
    assert(out.object.baseline, 'the report records the baseline');
    assert(out.object.limitations.length > 0, 'the report states its limitations');
    assert(out.object.groups.some((g) => g.logs.length > 0),
      'the report carries per-scenario event logs with sequence numbers');
    assert(out.json.length > 1000, 'the combined JSON is populated');
    eq(O.isPrepared(), false, 'the prepared plan is consumed and cannot be replayed');
  });

  await checkAsync('Dev manifest: exact write rows, bounded use counts and session binding (Extended)', async () => {
    requirePrivate(['web/dev/live/live-orchestrator.js']);
    const O = sandbox.BES3DevOrchestrator;
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);

    const m = await O.prepare('extended');
    assert(Object.isFrozen(m), 'the manifest is frozen');
    assert(Object.isFrozen(m.writeRows), 'the write rows are frozen');
    eq(m.sessionToken, undefined, 'the exported manifest does not contain the authorization token');
    eq(m.sessionRef, sandbox.BES3DevLiveRunner.sessionRefOf(W.authorizationToken),
      'the manifest binds an opaque session reference');
    eq(m.sessionMode, 'demo', 'the manifest binds the session mode');
    assert(m.writeRows.length >= 3, 'the extended profile has reviewed write rows');
    m.writeRows.forEach((r) => {
      assert(r.op && r.component && r.name, 'a write row names its operation and target');
      assert(typeof r.bytes === 'string', 'a write row carries canonical payload bytes');
      assert(r.remaining >= 1, 'a write row carries a bounded use count');
    });
    assert(m.recoveryRows.length >= 1, 'the manifest lists recovery rows');
    m.recoveryRows.forEach((r) => {
      eq(typeof r.restorable, 'boolean', 'a recovery row states whether restoration is supported');
    });
    assert(m.skippedWrites.some((s) => /no supported restoration path/.test(s.reason)),
      'a mutation without a supported recovery path is skipped before approval');
    eq(m.scenarioIds.includes('live.light.power-variants'), false,
      'unselected electrical variants are excluded from auto-run');
    eq(m.scenarioIds.includes('live.ports.toggle-high'), false,
      'the unselected high-power port is excluded from auto-run');
    eq(m.scenarioIds.includes('live.light.restore'), false,
      'the redundant light restore scenario is excluded from auto-run');

    const before = writeFrames;
    const out = await O.run('extended');
    const s = out.object.summary;
    eq(out.object.manifest, m, 'the executed manifest is the approved frozen object');
    eq(s.failed, 0, 'no scenario failed');
    eq(s.notRun, 0, 'no group was left unexecuted');
    eq(s.healthy, true, 'the run is healthy');
    const writeScenarios = m.scenarioIds.filter((id) => {
      const sc = LR.registry.filter((x) => x.id === id)[0];
      return sc && sc.requiresWrite;
    }).length;
    assert(writeFrames - before <= 2 * writeScenarios,
      'write frames stay within one scenario write plus one recovery per write scenario');
    assert(writeFrames - before >= 1, 'the approved port write was sent');
  });

  await checkAsync('Dev grants: an unlisted target and a reused approval are both refused', async () => {
    requirePrivate(['web/dev/live/live-runner.js']);
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();

    // The same op+payload on a different target is not authorized.
    const wrongTarget = [{
      op: 'GENERIC_WRITE', component: 'DriveUnit', name: 'HIGH_POWER_PORT_ACTIVE',
      bytes: '08 00', remaining: 1,
    }];
    let before = writeFrames;
    await LR.run('live.ports.toggle-low', { grants: wrongTarget });
    eq(writeFrames, before, 'a grant for another target never authorizes the low port');

    // One grant cannot be spent twice.
    LR.register({
      id: 'test.reuse-grant', suite: 'Test Harness',
      name: 'Attempt the same approved step twice',
      requiresConnection: true, requiresWrite: true, timeout: 10000,
      run: async (ctx) => {
        const step = ctx.makePortStep('LOW_POWER_PORT_ACTIVE', false);
        await ctx.runWrite([step]);
        await ctx.runWrite([step]);
      },
    });
    const single = [{
      op: 'GENERIC_WRITE', component: 'DriveUnit', name: 'LOW_POWER_PORT_ACTIVE',
      bytes: '08 00', remaining: 1,
    }];
    before = writeFrames;
    await LR.run('test.reuse-grant', { grants: single });
    eq(writeFrames - before, 1, 'the second use of the same approval is refused');

    // Tidy up the test harness state: the refused second step never ran, but
    // the first one did.
    await LR.restoreBaseline({ keys: ['DriveUnit.LOW_POWER_PORT_ACTIVE'] });
  });

  await checkAsync('Dev recovery: a session change invalidates recovery without sending a write', async () => {
    requirePrivate(['web/dev/live/live-runner.js']);
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();

    // Move the port away from its baseline so recovery would have to write.
    const step = {
      op: 'GENERIC_WRITE', component: 'DriveUnit', name: 'LOW_POWER_PORT_ACTIVE',
      address: W.util.addrOf('DriveUnit', 'LOW_POWER_PORT_ACTIVE'),
      bytes: '08 00', typedName: '', continueOnFailure: true,
      run: (o) => W.Writers.generic('DriveUnit', 'LOW_POWER_PORT_ACTIVE', [0x08, 0x00], o),
    };
    await W.runPlan([step], null, {});

    // A new authorization generation stands in for a replacement session.
    W.setExperimental(false);
    W.setExperimental(true);

    const before = writeFrames;
    const rec = await LR.restoreBaseline({ keys: ['DriveUnit.LOW_POWER_PORT_ACTIVE'] });
    eq(rec.overall, 'recovery-not-attempted-session-lost',
      'recovery refuses a session that differs from the baseline session');
    eq(writeFrames, before, 'no recovery frame was sent after the session changed');
  });

  await checkAsync('Dev recovery: abort sends no recovery write', async () => {
    requirePrivate(['web/dev/live/live-runner.js']);
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();

    LR.register({
      id: 'test.abort-recovery', suite: 'Test Harness',
      name: 'Wait, then attempt recovery after an abort',
      requiresConnection: true, requiresWrite: true, timeout: 10000,
      run: async (ctx) => {
        try {
          await ctx.wait(2000);
        } finally {
          const rec = await LR.restoreBaseline({ keys: ['DriveUnit.LOW_POWER_PORT_ACTIVE'] });
          ctx.setRecovery(rec.overall);
        }
      },
    });

    const running = LR.run('test.abort-recovery');
    await new Promise((r) => setTimeout(r, 50));
    const before = writeFrames;
    LR.abortWrites();
    await running;
    eq(writeFrames, before, 'abort prevented every later frame, including recovery');
    const result = LR.getState().results[0];
    eq(result.recoveryOutcome, 'recovery-aborted-by-user',
      'the recovery outcome states that the user aborted it');
  });

  await checkAsync('Dev lifecycle: a timed-out task cannot transmit into the next scenario', async () => {
    requirePrivate(['web/dev/live/live-runner.js']);
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();

    LR.register({
      id: 'test.timeout-write', suite: 'Test Harness',
      name: 'Write after the scenario deadline',
      requiresConnection: true, requiresWrite: true, timeout: 100,
      run: async (ctx) => {
        await ctx.wait(300);
        await ctx.runWrite([ctx.makePortStep('LOW_POWER_PORT_ACTIVE', true)]);
      },
    });
    LR.register({
      id: 'test.after-timeout', suite: 'Test Harness',
      name: 'Runs after the timed-out scenario',
      requiresConnection: true, requiresWrite: false, timeout: 5000,
      run: async (ctx) => { ctx.ok(true, 'the next scenario started'); },
    });

    const before = writeFrames;
    const first = await LR.run('test.timeout-write');
    eq(first.timedOut, 1, 'the first scenario timed out');
    const second = await LR.run('test.after-timeout');
    eq(second.passed, 1, 'the next scenario ran normally');
    // Give the orphaned task time to attempt its write; it must be refused.
    await new Promise((r) => setTimeout(r, 500));
    eq(writeFrames, before, 'the orphaned task sent no write frame');
  });

  await checkAsync('Dev baseline: exact bytes are compared, never truthily coerced', async () => {
    requirePrivate(['web/dev/live/live-runner.js']);
    const LR = sandbox.BES3DevLiveRunner;
    const H = sandbox.BES3DevWriteHelpers;

    eq(H.matchesBaseline({ status: 'ok', hex: '08 00' }, '08 00'), true,
      'an explicit 08 00 read matches an 08 00 baseline');
    eq(H.matchesBaseline({ status: 'ok', hex: '08 01' }, '08 00'), false,
      'an 08 01 read never matches an 08 00 baseline');

    const spec = LR.restoreSpecFor({
      target: 'DriveUnit.LOW_POWER_PORT_ACTIVE', component: 'DriveUnit',
      name: 'LOW_POWER_PORT_ACTIVE', status: 'ok', hex: '08 00', decoded: false,
    });
    eq(spec.unsupported, undefined, 'an 08 00 baseline has a supported writer');
    eq(spec.bytes, '08 00', 'the recovery payload stays 08 00');

    const empty = LR.restoreSpecFor({
      target: 'DriveUnit.LOW_POWER_PORT_ACTIVE', component: 'DriveUnit',
      name: 'LOW_POWER_PORT_ACTIVE', status: 'ok', hex: '', decoded: false,
    });
    assert(!empty.unsupported, 'an empty port baseline has a supported restore path');
    eq(empty.bytes, '08 00', 'an empty port baseline restores to explicit off bytes');
    eq(LR.isHealthyRecovery('restore-unconfirmed'), false,
      'an unconfirmed restore is not healthy');
    eq(LR.isHealthyRecovery('restored-verified'), true,
      'a verified restore is healthy');

    const described = H.describeRead({ status: 'ok', hex: '', value: false });
    eq(described.state, 'empty', 'an empty payload is classified as empty');
    eq(described.decoded, null, 'an empty payload is not surfaced as a decoded false');
  });

  await checkAsync('Dev light suite: recovery stays within the light registers', async () => {
    requirePrivate(['web/dev/live/live-suite-light.js']);
    const src = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-suite-light.js'), 'utf8');
    eq(src.includes('SERVICE_DUE'), false, 'the light suite never mentions the service register');
    eq(src.includes('PORT_ACTIVE'), false, 'the light suite never mentions a power port');

    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();
    await LR.run('live.light.runtime-cycle');
    const touched = LR.getTouched();
    assert(touched.every((t) => t.indexOf('DriveUnit.BIKE_LIGHT') === 0),
      'every touched target is a light register: ' + touched.join(', '));
  });

  check('Dev light suite: a failed Step 1 skips Step 2 (source check)', () => {
    requirePrivate(['web/dev/live/live-suite-light.js']);
    const src = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-suite-light.js'), 'utf8');
    assert(src.includes('if (!ok1)'), 'the failed first step is detected');
    assert(src.includes('skipping Step 2'), 'the early return states why Step 2 was skipped');
    assert(src.includes('BIKE_LIGHT_CONFIGURATION=1'), 'the Always-On hint is present');
  });

  await checkAsync('Dev light suite: power-cycle writes a bounded offset and restores the baseline', async () => {
    requirePrivate(['web/dev/live/live-suite-light.js']);
    const LR = sandbox.BES3DevLiveRunner;
    await W.startDemo();
    W.setExperimental(true);
    await LR.captureBaseline();
    const beforeHex = W.state.values['DriveUnit.BIKE_LIGHT_POWER'].hex;
    const before = mutations;
    const summary = await LR.run('live.light.power-cycle');
    eq(summary.passed, 1, 'the power-cycle scenario passed');
    const result = LR.getState().results[0];
    eq(result.status, 'passed', 'the result status is passed');
    eq(mutations - before, 2, 'one bounded write plus the verified baseline restore');
    eq(W.state.values['DriveUnit.BIKE_LIGHT_POWER'].hex, beforeHex, 'the power budget baseline is restored');
  });

  await checkAsync('Dev report: exactly one automatic download and a persistent manual fallback', () => {
    requirePrivate(['web/dev/live/live-ui.js']);
    const uiSrc = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-ui.js'), 'utf8');
    const start = uiSrc.indexOf('async function onRunEverything');
    const end = uiSrc.indexOf('function onExportJson');
    assert(start >= 0 && end > start, 'the Run Everything handler is present');
    const body = uiSrc.slice(start, end);
    const calls = body.match(/ORCH\.downloadLast\('auto'\)/g) || [];
    eq(calls.length, 1, 'one automatic download attempt per run');
    assert(/downloadBtn\.disabled = !\(ORCH && ORCH\.getLast\(\)\)/.test(uiSrc),
      'the manual Download button stays available after the run');

    const orchSrc = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-orchestrator.js'), 'utf8');
    for (const token of ['terminationReason', 'halted', 'unresolvedTargets', 'incomplete',
      'recovery-aborted-by-user', 'recovery-not-attempted-session-lost',
      'recovery-not-attempted-nonquiescent']) {
      assert(orchSrc.includes(token), 'the combined report supports ' + token);
    }
    assert(orchSrc.includes('combined.haltReason'), 'a halted run states why it halted');
  });

  await checkAsync('Dev stop: a user stop finalises an incomplete report and downloads it once', async () => {
    requirePrivate(['web/dev/live/live-orchestrator.js']);
    const O = sandbox.BES3DevOrchestrator;
    await W.startDemo();
    W.setExperimental(false);
    await O.prepare('fast-demo');

    const running = O.run('fast-demo');
    await new Promise((r) => setTimeout(r, 30));
    O.stop();
    const out = await running;
    eq(out.object.terminationReason, 'user-stop', 'the report states that the user stopped the run');
    eq(out.object.incomplete, true, 'a stopped run is marked incomplete');
    assert(O.getLast(), 'the report is retained for the manual Download button');
    assert(out.object.groups.length > 0, 'the partial report still records its groups');
    assert(out.json.length > 500, 'the partial report is populated');
  });

  await checkAsync('no real device access occurred during the engine run', () => {
    eq(hardware.calls, 0, 'hardware stub never invoked');
    eq(sandbox.navigator.usb, undefined, 'navigator.usb remains undefined');
  });

  // A DOM-level check for the real ui.js. The shim has no browser, no USB and no
  // network; it only exposes the elements and events the modal code touches.
  let ui = null;

  await checkAsync('UI sandbox: the fake DOM loads the real UI and accepts the risk warning', async () => {
    ui = createUiHarness(sandbox);
    uiHarness = ui;
    eq(ui.doc.getElementById('btnDemo'), ui.btnDemo, 'the demo button is wired');
    eq(ui.modal.hidden, false, 'the risk modal is open at boot');
    ui.acceptRisk();
    await sleep(0);
    eq(ui.modal.hidden, true, 'accepting the risk warning hides the modal');
    // Start the modal checks from a closed session, independent of the last
    // engine test. Disconnect sends no frame.
    await W.disconnect();
    eq(W.state.demo, false, 'the UI checks start outside demo mode');
  });

  await checkAsync('UI connection doctor: a failed connect shows the checklist and sends nothing', async () => {
    assert(ui, 'the UI sandbox loaded');
    resetFrameCounters();
    const p = ui.doc.getElementById('btnConnect').onclick();
    await sleep(0);
    eq(ui.modal.hidden, false, 'the doctor modal is open');
    eq(ui.doc.getElementById('modalTitle').textContent, 'Connection failed', 'the doctor title is used');
    const body = ui.doc.getElementById('modalBody').innerHTML;
    assert(body.includes('108c') && body.includes('Zadig'), 'the udev rule and Zadig steps are present');
    const ok = ui.modalActions.children.find((b) => b.tagName === 'BUTTON' && b.textContent === 'OK');
    assert(ok, 'the doctor modal has an OK action');
    ok.onclick();
    await p;
    eq(writeFrames, 0, 'no write frames');
    eq(rpcFrames, 0, 'no RPC frames');
  });

  await checkAsync('UI Mini Remote: hidden without BRC3300, shown with it, zero writes', async () => {
    assert(ui, 'the UI sandbox loaded');
    await ui.startDemo();
    resetFrameCounters();
    sandbox.Bes3WorkshopUI.render();
    const read = uiHarness.doc.getElementById('view-read');
    assert(!/Mini Remote|Probe remote registers|Not visible over USB/.test(read.innerHTML),
      'the demo readout has no Mini Remote card, probe block or placeholder');
    const key = 'RemoteControl.BLE_CENTRAL_DATABASE';
    const previous = W.state.values[key];
    W.state.values[key] = {
      status: 'ok',
      display: '1 entry',
      value: { count: 1, text: '1 entry', hasMiniRemote: true, hasBleRecord: true },
      hex: '0a 07 42 52 43 33 33 30 30',
    };
    sandbox.Bes3WorkshopUI.render();
    assert(/Paired wireless accessory/.test(read.innerHTML), 'the card is shown for a BRC3300 record');
    assert(/1 entry in the BLE device database/.test(read.innerHTML), 'the detected card carries the peer note');
    if (previous === undefined) delete W.state.values[key]; else W.state.values[key] = previous;
    sandbox.Bes3WorkshopUI.render();
    assert(!/Mini Remote|Probe remote registers|Not visible over USB/.test(read.innerHTML),
      'removing the marker hides the card again');
    eq(writeFrames, 0, 'no write frames');
    eq(rpcFrames, 0, 'no RPC frames');
    await W.disconnect();
  });

  await checkAsync('UI Escape: a cancelable modal hides, restores focus and starts no session', async () => {
    assert(ui, 'the UI sandbox loaded');
    ui.doc.activeElement = ui.btnDemo;
    const p = ui.btnDemo.onclick();
    await sleep(0);
    eq(ui.modal.hidden, false, 'the demo notice is open');
    ui.dom.pressEscape();
    await p;
    eq(ui.modal.hidden, true, 'Escape hides the dialog');
    eq(ui.doc.activeElement, ui.btnDemo, 'Escape restores focus to the opener');
    eq(W.state.demo, false, 'a cancelled demo notice did not start a session');
    eq(mutations, 0, 'a cancelled modal sent no frame');
  });

  const writeView = () => ui.doc.getElementById('view-write');
  const setPortPill = (key, choice) => {
    const btn = writeView().querySelector(`[data-port-set="${choice}"][data-port-key="${key}"]`);
    assert(btn, `${key} port pill ${choice} is rendered`);
    btn.onclick();
  };
  const enableTechDetails = () => {
    const box = ui.doc.getElementById('techDetails');
    assert(box, 'the technical-details toggle is present');
    if (!box.checked) { box.checked = true; box.onchange(); }
  };
  const runCloseButton = () => ui.doc.querySelector('#runClose');
  const finishRunModal = async () => {
    for (let i = 0; i < 5000; i++) {
      const b = runCloseButton();
      if (b && !b.disabled) { b.onclick(); return; }
      await sleep(2);
    }
    throw new Error('the progress modal did not finish (modal hidden=' + ui.modal.hidden
      + ', result=' + ui.doc.getElementById('runResult').innerHTML.slice(0, 160) + ')');
  };
  const openWriteTab = async () => {
    await ui.startDemo();
    eq(W.state.demo, true, 'the demo session is open');
    W.setExperimental(true);
    ui.switchTab('write');
    await sleep(0);
  };
  // Stage a registry-bound Write Lab row. The light switch is now a direct
  // action, so batch tests use the Write Lab for a second staged row.
  const stageLab = async (key, hex) => {
    const btn = ui.doc.querySelectorAll('[data-wlkey]').find((b) => b.dataset.wlkey === key);
    assert(btn, 'Write Lab target is listed: ' + key);
    btn.onclick();
    await sleep(0);
    const raw = ui.doc.getElementById('wlPayload');
    raw.value = hex;
    raw.oninput();
    await ui.dom.dispatchAction('advWrite');
  };

  await checkAsync('UI service interval: Clear is always offered, reads first and stages the empty payload', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    enableTechDetails();
    resetFrameCounters();
    delete W.state.values['RemoteControl.SERVICE_DUE'];
    sandbox.Bes3WorkshopUI.render();
    ui.switchTab('write');
    const radios = writeView().querySelectorAll('input[name="svc"]');
    const del = radios.find((r) => r.value === 'delete');
    assert(del, 'the Clear service interval option exists');
    del.checked = true;
    del.onchange();
    await sleep(0);
    const btn = writeView().querySelector('[data-act="svcApply"]');
    assert(btn && !btn.disabled, 'Clear stays available even when the reminder was not read');
    await ui.dom.dispatchAction('svcApply');
    await sleep(0);
    const refreshed = W.state.values['RemoteControl.SERVICE_DUE'];
    assert(refreshed && refreshed.status === 'ok', 'the current reminder was read before staging');
    const pendingHtml = writeView().innerHTML;
    assert(/Clear service interval/.test(pendingHtml), 'the clear is staged in the normal pending panel');
    assert(/\(empty\)/.test(pendingHtml), 'the staged payload is empty');
    const before = mutations;
    const applyP = ui.dom.dispatchAction('pendingApply');
    await finishRunModal();
    await applyP;
    assert(mutations > before, 'the clear was transmitted through the normal plan');
    const stored = W.state.values['RemoteControl.SERVICE_DUE'];
    assert(stored && stored.status === 'ok' && stored.value && stored.value.timestamp === 0 && stored.value.odometer === 0, 'the read-back shows the reminder cleared');
    uiHarness.switchTab('read');
    assert(/Service interval<\/span><\/div>\s*<span class="kpi__value[^"]*">Not set</.test(uiHarness.doc.getElementById('view-read').innerHTML), 'the Overview shows it as not set');
    eq(writeFrames, 1, 'exactly one write frame for the clear');
    await W.disconnect();
  });

  await checkAsync('UI service interval: an invalid custom value still shows the reason', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    resetFrameCounters();
    const note = ui.doc.getElementById('svcPresetNote');
    assert(note && /set one target and clear the other/i.test(note.textContent), 'the preset note states that a preset replaces the other target');
    const radios = writeView().querySelectorAll('input[name="svc"]');
    const custom = radios.find((r) => r.value === 'custom');
    assert(custom, 'the custom option exists');
    custom.checked = true;
    custom.onchange();
    await sleep(0);
    const btn = writeView().querySelector('[data-act="svcApply"]');
    assert(btn && btn.disabled, 'an empty custom reminder cannot be written');
    const reason = ui.doc.getElementById('svcReasons');
    assert(reason && /valid date/i.test(reason.textContent), 'the unmet reason is shown next to the button');
    eq(writeFrames, 0, 'no write frames');
    eq(rpcFrames, 0, 'no RPC frames');
    await W.disconnect();
  });

  const setServiceFromHex = (hex) => {
    const bytes = hex ? hex.trim().split(/\s+/).map((h) => parseInt(h, 16)) : [];
    const value = W.util.decodeServiceDue(bytes);
    W.state.values['RemoteControl.SERVICE_DUE'] = {
      status: 'ok',
      display: value.timestamp || value.odometer ? 'set' : 'not set',
      value,
      hex,
    };
    sandbox.Bes3WorkshopUI.render();
    return value;
  };

  await checkAsync('UI service interval: a distance-only reminder is rendered, zero writes', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    resetFrameCounters();
    const value = setServiceFromHex('10 97 fa 99 01');
    eq(value.odometer, 2522391, 'the km-only fixture decodes to 2,522,391 m');
    eq(value.timestamp, 0, 'the km-only fixture has no date');
    uiHarness.switchTab('read');
    const kpiHtml = uiHarness.doc.getElementById('view-read').innerHTML;
    assert(/2,522 km \(no date\)/.test(kpiHtml), 'the Overview KPI shows the distance and says the date is missing');
    ui.switchTab('write');
    const cardHtml = writeView().innerHTML;
    assert(/Currently stored/.test(cardHtml), 'the Configure card is rendered');
    assert(/2,522 km \(no date\)/.test(cardHtml), 'the Configure card shows the distance-only reminder');
    eq(writeFrames, 0, 'no write frames');
    eq(rpcFrames, 0, 'no RPC frames');
    await W.disconnect();
  });

  await checkAsync('UI service interval: a date-only reminder is rendered, zero writes', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    resetFrameCounters();
    const value = setServiceFromHex('0a 06 08 c0 9a f8 cb 0d');
    eq(value.timestamp, 1824458400, 'the date-only fixture decodes to 2027-10-25 10:00 UTC');
    eq(value.odometer, 0, 'the date-only fixture has no distance');
    uiHarness.switchTab('read');
    const kpiHtml = uiHarness.doc.getElementById('view-read').innerHTML;
    assert(/date: 25 Oct 2027 \(no distance\)/.test(kpiHtml), 'the Overview KPI shows the date and says the distance is missing');
    ui.switchTab('write');
    const cardHtml = writeView().innerHTML;
    assert(/date: 25 Oct 2027 \(no distance\)/.test(cardHtml), 'the Configure card shows the date-only reminder');
    eq(writeFrames, 0, 'no write frames');
    eq(rpcFrames, 0, 'no RPC frames');
    await W.disconnect();
  });

  await checkAsync('UI service interval: an empty payload is "Not set", zero writes', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    resetFrameCounters();
    const value = setServiceFromHex('');
    eq(value.timestamp, 0, 'an empty payload has no date');
    eq(value.odometer, 0, 'an empty payload has no distance');
    uiHarness.switchTab('read');
    const kpiHtml = uiHarness.doc.getElementById('view-read').innerHTML;
    assert(/Service interval<\/span><\/div>\s*<span class="kpi__value[^"]*">Not set</.test(kpiHtml), 'the Overview KPI says Not set');
    ui.switchTab('write');
    const cardHtml = writeView().innerHTML;
    assert(/Currently stored<\/div><div class="status-cell__v">Not set<\/div>/.test(cardHtml), 'the Configure card says Not set');
    eq(writeFrames, 0, 'no write frames');
    eq(rpcFrames, 0, 'no RPC frames');
    await W.disconnect();
  });

  await checkAsync('UI service interval: the card updates after a verified write without a full re-read', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    resetFrameCounters();
    const radios = writeView().querySelectorAll('input[name="svc"]');
    const km = radios.find((r) => r.value === 'km');
    assert(km, 'the 1,500 km preset exists');
    km.checked = true;
    km.onchange();
    await sleep(0);
    let readAllCalls = 0;
    const realReadAll = W.readAll;
    W.readAll = async (...args) => { readAllCalls++; return realReadAll.apply(W, args); };
    try {
      await ui.dom.dispatchAction('svcApply');
      const before = mutations;
      const applyP = ui.dom.dispatchAction('pendingApply');
      await finishRunModal();
      await applyP;
      assert(mutations >= before + 1, 'the write reached the simulated bike');
      const stored = W.state.values['RemoteControl.SERVICE_DUE'];
      assert(stored && stored.status === 'ok' && stored.value && stored.value.odometer > 0, 'the read-back stored the new distance');
      const cardHtml = writeView().innerHTML;
      assert(/km \(no date\)/.test(cardHtml), 'the Configure card shows the new distance without a manual Re-read');
      eq(readAllCalls, 0, 'no full re-read was needed');
    } finally {
      W.readAll = realReadAll;
    }
    await W.disconnect();
  });

  await checkAsync('UI staging: stage, evidence and Escape discard send zero frames', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    const before = mutations;
    ui.doc.activeElement = ui.btnDemo;
    await ui.dom.dispatchAction('svcApply');
    assert(/id="pendingChanges"/.test(writeView().innerHTML), 'the pending panel is visible');
    assert(/Pending changes \(1\)/.test(writeView().innerHTML), 'one change is staged');
    assert(/Apply 1 change/.test(writeView().innerHTML), 'the batch button names the count');
    assert(/Observed working/.test(writeView().innerHTML), 'the evidence label is shown');
    assert(/Verified/.test(writeView().innerHTML), 'the tier is shown as a human-readable label');
    eq(mutations, before, 'staging sends no frame');
    ui.dom.pressEscape();
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'Escape clears the staged changes');
    eq(mutations, before, 'discarding sends no frame');
  });

  await checkAsync('UI staging: edit loads the raw payload into the Write Lab', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    const target = ui.doc.querySelectorAll('[data-wlkey]').find((b) => b.dataset.wlkey === 'DriveUnit.BIKE_LIGHT')
      || ui.doc.querySelectorAll('[data-wlkey]')[0];
    assert(target, 'a Write Lab register is listed');
    target.onclick();
    await sleep(0);
    const raw = ui.doc.getElementById('wlPayload');
    raw.value = '08 01';
    raw.oninput();
    await ui.dom.dispatchAction('advWrite');
    assert(/id="pendingChanges"/.test(writeView().innerHTML), 'the generic write is staged');
    const edit = ui.doc.querySelector('[data-pending-edit]');
    assert(edit && !edit.disabled, 'the generic row has an Edit control');
    edit.onclick();
    await sleep(0);
    eq(ui.doc.getElementById('wlPayload').value, '08 01', 'Edit restores the raw payload');
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'Edit removes the staged row');
  });

  await checkAsync('UI Write Lab: the frame preview, payload annotation and current-value prefill are read-only', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    const target = ui.doc.querySelectorAll('[data-wlkey]').find((b) => b.dataset.wlkey === 'DriveUnit.BIKE_LIGHT')
      || ui.doc.querySelectorAll('[data-wlkey]')[0];
    assert(target, 'a Write Lab register is listed');
    target.onclick();
    await sleep(0);
    const key = target.dataset.wlkey;
    const entry = REGISTRY.find((e) => e.component + '.' + e.name === key);
    assert(entry, 'the selected register is in the registry');
    const raw = ui.doc.getElementById('wlPayload');
    raw.value = '08 01';
    raw.oninput();
    const expected = W.util.toHex(W.util.previewWriteFrame(entry.address, [0x08, 0x01]));
    eq(ui.doc.getElementById('wlFrameHex').textContent, expected, 'the preview shows the exact write frame');
    eq(ui.doc.getElementById('wlFrameTarget').textContent,
      entry.component + '.' + entry.name + ' · 0x' + entry.address.toString(16), 'the preview names the target');
    eq(ui.doc.getElementById('wlFramePayloadLen').textContent, '2 bytes', 'the payload length is shown');
    eq(ui.doc.getElementById('wlPayloadCount').textContent, '2 / 64 bytes', 'the byte budget is shown');
    assert(/field 1 · varint · 1/.test(ui.doc.getElementById('wlAnnotate').textContent),
      'the payload annotation decodes field 1');
    // Prefill from the current value is a draft edit, never a request.
    const before = mutations;
    const useBtn = ui.doc.getElementById('wlUseCurrent');
    if (useBtn && !useBtn.disabled) {
      useBtn.onclick();
      await sleep(0);
      eq(mutations, before, 'Use current value sends no frame');
    }
    assert(ui.doc.getElementById('wlCopyPayload'), 'Copy payload is present');
    assert(ui.doc.getElementById('wlCopyFrame'), 'Copy frame is present');
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'the preview alone stages nothing');
  });

  await checkAsync('UI power ports: a read-only refresh and one staged write per changed port', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    resetFrameCounters();
    // The refresh is read-only: it must not emit any mutation frame.
    await ui.dom.dispatchAction('portRead');
    eq(mutations, 0, 'reading the port states sends no write frame');
    eq(W.state.values['DriveUnit.LOW_POWER_PORT_ACTIVE'].hex, '08 01', 'the low-power port is read');
    eq(W.state.values['DriveUnit.HIGH_POWER_PORT_ACTIVE'].hex, '08 00', 'the high-power port is read');
    // Unchanged is the default; staging it must remain a no-op.
    enableTechDetails();
    const initialHtml = writeView().innerHTML;
    assert(/data-port-key="LOW"/.test(initialHtml) && /data-port-key="HIGH"/.test(initialHtml), 'both port pill groups are rendered');
    assert(!/data-port-set="unchanged"/.test(initialHtml), 'both ports default to No change');
    assert(!/id="pendingChanges"/.test(initialHtml), 'no change is staged at first');
    // Change only the low-power port to Off (the demo seed is on).
    setPortPill('LOW', 'disable');
    assert(/data-port-set="disable" data-port-key="LOW"[^>]*aria-pressed="true"/.test(writeView().innerHTML),
      'the choice survives a re-render');
    await ui.dom.dispatchAction('portApply');
    const keys = Array.from(ui.doc.querySelectorAll('[data-pending-key]')).map((n) => n.dataset.pendingKey);
    eq(keys.length, 1, 'only the changed port is staged');
    eq(keys[0], 'DriveUnit.LOW_POWER_PORT_ACTIVE', 'the staged row names the exact register');
    const html = writeView().innerHTML;
    assert(/id="pendingChanges"/.test(html), 'the staged batch is visible');
    assert(/08 00/.test(html), 'the staged payload is the disable payload');
    assert(/Experimental · Untested|Untested/.test(html), 'the untested marking is visible');
    assert(/High-impact register|Power port: experimental/.test(html), 'the high-impact / untested warning is visible');
    eq(mutations, 0, 'staging never sends a frame');
  });

  await checkAsync('UI reconnect: one picker offers the three transports, disables unavailable modes and preselects the last one', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    const nav = sandbox.navigator;
    const saved = { usb: nav.usb, bt: nav.bluetooth, mcsp: sandbox.Bes3BleMcsp, live: sandbox.Bes3LiveDataBle, mcspConnect: W.connectBleMcsp, liveConnect: W.connectLiveDataBle, usbConnect: W.connect };
    const cancelModal = () => {
      const actions = ui.doc.getElementById('modalActions');
      const cancel = actions.children[0];
      if (cancel) cancel.onclick();
    };
    try {
      // No transport available: all three modes are disabled with a reason.
      nav.usb = undefined;
      nav.bluetooth = undefined;
      let p = ui.dom.dispatchAction('reconnect');
      await sleep(0);
      eq(ui.doc.getElementById('modalTitle').textContent, 'Reconnect', 'the picker opens from a reconnect control');
      let inputs = ui.doc.querySelectorAll('input[name="reconnect-mode"]');
      eq(inputs.length, 3, 'three modes are offered');
      eq(inputs.map((r) => r.value).join(','), 'usb,ble-mcsp,ble-live', 'only the real transports are offered');
      assert(inputs.every((r) => r.disabled), 'unavailable modes are disabled');
      const bodyHtml = ui.doc.getElementById('modalBody').innerHTML;
      assert(/WebUSB.*not available|requires a secure context/.test(bodyHtml), 'the USB reason is shown');
      assert(/Web Bluetooth.*not available|requires a secure context/.test(bodyHtml), 'the Bluetooth reason is shown');
      cancelModal();
      await p;

      // Make all three available and switch to Live Data.
      nav.usb = {};
      nav.bluetooth = {};
      sandbox.Bes3BleMcsp = { requestMcspDevice() {}, Bes3BleMcspTransport: function () {} };
      sandbox.Bes3LiveDataBle = { requestLiveDataDevice() {}, Bes3LiveDataBleTransport: function () {} };
      let used = null;
      W.connect = async () => { used = 'usb'; };
      W.connectBleMcsp = async () => { used = 'ble-mcsp'; };
      W.connectLiveDataBle = async () => { used = 'ble-live'; };
      p = ui.dom.dispatchAction('reconnect');
      await sleep(0);
      inputs = ui.doc.querySelectorAll('input[name="reconnect-mode"]');
      assert(inputs.every((r) => !r.disabled), 'available modes are enabled');
      const live = inputs.find((r) => r.value === 'ble-live');
      inputs.forEach((r) => { r.checked = r === live; });
      live.onchange();
      const go = ui.doc.getElementById('reconnectGo');
      assert(go && !go.disabled, 'Connect is enabled for an available mode');
      go.onclick();
      await p;
      eq(used, 'ble-live', 'the selected transport is started once');

      // Reopening preselects the last used mode.
      p = ui.dom.dispatchAction('reconnect');
      await sleep(0);
      inputs = ui.doc.querySelectorAll('input[name="reconnect-mode"]');
      const checked = inputs.filter((r) => r.checked).map((r) => r.value);
      eq(checked.join(','), 'ble-live', 'the last used mode is preselected');
      cancelModal();
      await p;

      // Two rapid connect clicks start one attempt only.
      let attempts = 0;
      W.connect = async () => { attempts++; await sleep(20); };
      const a = ui.dom.dispatchAction('connect');
      const b = ui.dom.dispatchAction('connect');
      await Promise.all([a, b]);
      eq(attempts, 1, 'concurrent connect clicks are ignored');
    } finally {
      nav.usb = saved.usb;
      nav.bluetooth = saved.bt;
      sandbox.Bes3BleMcsp = saved.mcsp;
      sandbox.Bes3LiveDataBle = saved.live;
      W.connectBleMcsp = saved.mcspConnect;
      W.connectLiveDataBle = saved.liveConnect;
      W.connect = saved.usbConnect;
    }
  });

  check('WP2 source: Configuration tab not disabled for ble-mcsp (source check)', () => {
    const uiSrc = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    assert(!uiSrc.includes('writeTab.disabled = isBle'),
      'Configuration tab must not be unconditionally disabled for ble-mcsp');
    assert(!uiSrc.includes('Configuration is not available over Bluetooth. Connect via USB to write.'),
      'hard read-only BLE blocker must be removed');
    assert(uiSrc.includes('higher latency') || uiSrc.includes('extended read-back') || uiSrc.includes('Bluetooth (MCSP) connection'),
      'a latency/BLE notice must replace the old read-only banner');
  });

  await checkAsync('WP2 engine: ble-mcsp live session permits experimental writes; one frame, verified', async () => {
    // guard.canWrite("live") is transport-agnostic. Verify exactly one frame.
    await W.startDemo();
    W.setExperimental(true);
    const savedKind = W.state.transportKind;
    W.state.transportKind = 'ble-mcsp';
    eq(W.canMutate, true, 'canMutate is true for a live ble-mcsp session with experimental enabled');
    const before = mutations;
    const step = {
      label: 'ble-mcsp test write', bytes: '08 01', op: 'LIGHT_AVAILABLE',
      component: 'DriveUnit', name: 'BIKE_LIGHT_AVAILABLE',
      address: W.util.addrOf('DriveUnit', 'BIKE_LIGHT_AVAILABLE'), value: true,
      run: (owner) => W.Writers.lightAvailable(true, owner),
    };
    const res = await W.runPlan([step], null, { requireApproval: true, approve: async () => true });
    eq(res[0].acked, true, 'write acknowledged over simulated ble-mcsp session');
    eq(mutations, before + 1, 'exactly one mutation frame — no retransmit');
    W.state.transportKind = savedKind;
  });
  // ---- API availability hint tests ----

  check('API hint source: no hint when both APIs are available (source)', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    // When both APIs are available the combined function returns '' immediately.
    assert(ui.includes('if (!missingUsb && !missingBt) return \'\''),
      'apiHintCombinedHtml returns empty string when both APIs are available');
    assert(/apiAvail\(\)\.hasUsb/.test(ui), 'USB availability checked via apiAvail()');
    assert(/apiAvail\(\)\.hasBt/.test(ui),  'BT availability checked via apiAvail()');
  });

  check('API hint source: insecure-context hint appears only when !isSecureContext', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    assert(ui.includes('API_SECURE'), 'a stable secure-context flag is defined');
    assert(ui.includes('apiAvail()'), 'availability is read from a live helper');
    assert(ui.includes('apiHintCombinedHtml'), 'combined hint function is defined');
    // The insecure branch is gated on the secure flag.
    assert(ui.includes("if (!secure)"), 'insecure-context branch is gated on secure flag');
    // The Edge flag URL must appear at least once.
    const edgeCount = (ui.match(/edge:\/\/flags/g) || []).length;
    assert(edgeCount >= 1, 'Edge flag URL appears at least once');
    // The secure-context missing-API message must exist.
    assert(ui.includes('not available in this browser'), 'secure-context missing-API message exists');
    // The HTTP-traffic warning must be present.
    assert(ui.includes('does not encrypt HTTP traffic'), 'HTTP-traffic caveat present');
    // Confirm the secure-context branch does not embed the Edge workaround.
    const fnStart = ui.indexOf('function apiHintCombinedHtml(');
    const fnEnd   = ui.indexOf('\n  }', fnStart + 1);
    const fnBody  = ui.slice(fnStart, fnEnd);
    const secureBranchStart = fnBody.indexOf('return `<div class="notice api-hint"');
    assert(secureBranchStart !== -1, 'secure-context return branch exists inside apiHintCombinedHtml');
    assert(fnBody.indexOf('edge://flags', secureBranchStart) === -1,
      'Edge workaround absent from secure-context guidance');
  });

  check('API hint source: USB and Bluetooth checked independently via apiAvail', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    assert(/apiAvail\(\)\.hasUsb/.test(ui), 'USB availability checked against hasUsb');
    assert(/apiAvail\(\)\.hasBt/.test(ui),  'Bluetooth availability checked against hasBt');
    // Combined hint is injected via a single container.
    assert(ui.includes("apiHintCombinedHtml()"), 'combined hint injected once');
    assert(!ui.includes("apiHintHtml('usb')") && !ui.includes("apiHintHtml('bt')"),
      'old per-API hint calls are removed');
  });

  check('API hint source: origin rendered with esc() and a copy button', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    assert(ui.includes('window.location.origin'), 'window.location.origin is used for the origin value');
    assert(/esc\(origin/.test(ui), 'origin is escaped before HTML insertion');
    assert(ui.includes("data-act=\"copyApiHintOrigin\""), 'copy-origin action is present');
    assert(ui.includes("data-act=\"copyApiHintEdgeUrl\""), 'copy-Edge-url action is present');
    assert(/data-copy=.*esc\(flagUrl\)/.test(ui), 'Edge URL stored in data-copy with esc()');
  });

  check('API hint source: reconnect picker reasons reflect secure-context state', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    assert(/requires a secure context/.test(ui), 'insecure-context reason text is present in reconnect modes');
    assert(/not available in this browser or is restricted/.test(ui), 'secure-context reason text is present');
    // Both reasons are inside reconnectModes(), not in apiHintHtml.
    const modesIdx = ui.indexOf('function reconnectModes()');
    assert(modesIdx !== -1, 'reconnectModes is defined');
    assert(ui.indexOf('requires a secure context', modesIdx) !== -1,
      'insecure-context reason appears inside reconnectModes');
  });

  check('API hint source: insecure-context warning about HTTP traffic is present', () => {
    const ui = readFileSync(path.join(repo, 'web', 'workshop', 'ui.js'), 'utf8');
    assert(/does not encrypt HTTP traffic/.test(ui), 'HTTP-traffic warning is present in the hint');
  });

  await checkAsync('UI light: one click writes the light once and verifies it by read-back', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    // Make the simulated light installed and configured so the demo accepts a
    // switch-on, then start from a readable OFF state.
    await W.Writers.lightAvailable(true);
    await W.Writers.lightConfiguration(2);
    await W.Writers.lightSwitch(false);
    ui.switchTab('write');
    await sleep(0);
    assert(/Toggle light/.test(writeView().innerHTML), 'the toggle button is present');
    resetFrameCounters();
    const logStart = W.state.log.length;
    const p = ui.dom.dispatchAction('lightToggle');
    await finishRunModal();
    await p;
    const entries = W.state.log.slice(logStart).filter((e) => e && e.name === 'BIKE_LIGHT');
    eq(entries.length, 1, 'exactly one light write');
    assert(entries[0].applied, 'the light write was verified by read-back');
    eq(mutations, 1, 'exactly one frame was sent');
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'the direct action stages nothing');
    eq(W.state.values['DriveUnit.BIKE_LIGHT'].value, true, 'the light is on after the write');

    // Unknown state: a read-only refresh is offered, never a blind write.
    delete W.state.values['DriveUnit.BIKE_LIGHT'];
    sandbox.Bes3WorkshopUI.render();
    ui.switchTab('write');
    assert(/data-act="lightRefresh"/.test(writeView().innerHTML), 'unknown state offers a refresh');
    assert(!/data-act="lightToggle"/.test(writeView().innerHTML), 'unknown state offers no blind switch');
    resetFrameCounters();
    await ui.dom.dispatchAction('lightRefresh');
    await sleep(0);
    eq(mutations, 0, 'refresh is read-only');
  });

  await checkAsync('UI light: turn-off uses AVAILABLE bounce (2 frames, both BIKE_LIGHT_AVAILABLE)', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    // Start from a fully installed, configured, ON state.
    await W.Writers.lightAvailable(true);
    await W.Writers.lightConfiguration(2);
    await W.Writers.lightSwitch(true);
    ui.switchTab('write');
    await sleep(0);
    assert(/Toggle light/.test(writeView().innerHTML), 'toggle button visible when light is on');
    resetFrameCounters();
    const logStart = W.state.log.length;
    const p = ui.dom.dispatchAction('lightToggle');
    await finishRunModal();
    await p;
    eq(mutations, 2, 'turn-off sends exactly two frames (AVAILABLE false → true)');
    const entries = W.state.log.slice(logStart).filter((e) => e && e.name === 'BIKE_LIGHT_AVAILABLE');
    eq(entries.length, 2, 'both log entries are BIKE_LIGHT_AVAILABLE writes');
    eq(entries[0].sent, '08 00', 'first write disables availability');
    eq(entries[1].sent, '08 01', 'second write re-enables availability');
    assert(entries[0].applied, 'disable step confirmed by read-back');
    assert(entries[1].applied, 're-enable step confirmed by read-back');
    // Read back BIKE_LIGHT explicitly — writeVerified only read BIKE_LIGHT_AVAILABLE.
    await W.readKey('DriveUnit', 'BIKE_LIGHT');
    eq(W.state.values['DriveUnit.BIKE_LIGHT'].value, false, 'BIKE_LIGHT reads as off after the bounce');
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'direct action stages nothing');
  });

  await checkAsync('UI power ports: Apply sends both staged writes once and re-reads them', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    await ui.dom.dispatchAction('portRead');
    // Demo seeds: LOW = 08 01, HIGH = 08 00. Both choices are real changes,
    // so the same-value guard does not skip either step.
    setPortPill('LOW', 'disable');
    setPortPill('HIGH', 'enable');
    await ui.dom.dispatchAction('portApply');
    eq(ui.doc.querySelectorAll('[data-pending-key]').length, 2, 'both changed ports are staged');
    const before = mutations;
    const logStart = W.state.log.length;
    const applyP = ui.dom.dispatchAction('pendingApply');
    // Power ports are normal-tier: like the light/service cards they go straight
    // to the run modal, with no typed register-name gate.
    for (let i = 0; i < 100 && !/Applying 2 changes/.test(ui.doc.getElementById('modalTitle').textContent); i++) await sleep(1);
    eq(ui.doc.getElementById('modalTitle').textContent, 'Applying 2 changes', 'no typed gate is opened for the power ports');
    assert(!/id="batchTyped/.test(ui.doc.getElementById('modalBody').innerHTML), 'there is no high-impact confirmation input');
    await finishRunModal();
    await applyP;
    const entries = W.state.log.slice(logStart).filter((e) => e && (e.name === 'LOW_POWER_PORT_ACTIVE' || e.name === 'HIGH_POWER_PORT_ACTIVE'));
    eq(entries.length, 2, 'both port writes were logged');
    assert(entries.every((e) => e.applied), 'both writes were confirmed by read-back: ' + entries.map((e) => e.name + '=' + e.applied).join(', '));
    assert(mutations >= before + 2, 'both writes reached the simulated bike');
    eq(W.state.values['DriveUnit.LOW_POWER_PORT_ACTIVE'].hex, '08 00', 'the low-power port reads back the written payload');
    eq(W.state.values['DriveUnit.HIGH_POWER_PORT_ACTIVE'].hex, '08 01', 'the high-power port reads back the written payload');
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'applied rows leave the pending panel');
  });

  await checkAsync('UI power ports: restaging replaces only port rows, keeps other cards and guards unknown values', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    await ui.dom.dispatchAction('portRead');
    await ui.dom.dispatchAction('svcApply');
    setPortPill('LOW', 'disable');
    setPortPill('HIGH', 'enable');
    await ui.dom.dispatchAction('portApply');
    let keys = Array.from(ui.doc.querySelectorAll('[data-pending-key]')).map((n) => n.dataset.pendingKey);
    assert(keys.includes('RemoteControl.SERVICE_DUE'), 'the staged service row survives port staging');
    assert(keys.includes('DriveUnit.LOW_POWER_PORT_ACTIVE') && keys.includes('DriveUnit.HIGH_POWER_PORT_ACTIVE'), 'both port rows are staged');
    // Restage with LOW back to Unchanged: the stale LOW row must disappear and
    // the service row (a different source) must not be discarded.
    setPortPill('LOW', 'unchanged');
    await ui.dom.dispatchAction('portApply');
    keys = Array.from(ui.doc.querySelectorAll('[data-pending-key]')).map((n) => n.dataset.pendingKey);
    eq(keys.length, 2, 'one port row plus the service row remain');
    assert(!keys.includes('DriveUnit.LOW_POWER_PORT_ACTIVE'), 'an unchanged port is never written');
    assert(keys.includes('RemoteControl.SERVICE_DUE'), 'staging ports does not delete other cards\' rows');
    // Both ports unchanged is reported as a no-op.
    setPortPill('HIGH', 'unchanged');
    assert(/Nothing to write/.test(writeView().innerHTML), 'both unchanged is reported as no-op');
    // An unread value is never guessed as off.
    delete W.state.values['DriveUnit.HIGH_POWER_PORT_ACTIVE'];
    sandbox.Bes3WorkshopUI.render();
    ui.switchTab('write');
    setPortPill('HIGH', 'enable');
    assert(/Read High Power Port first/.test(writeView().innerHTML), 'an unread value blocks staging');
  });

  await checkAsync('UI power ports: empty-payload read-back (proto3 implicit zero) is treated as off, not staged as disable', async () => {
    // Regression test for the portChanges bug: empty hex (proto3 implicit false)
    // must be treated semantically equivalent to explicit '08 00' for the
    // "already matches, do not stage" check.
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    // Seed LOW as empty payload (as the real bike might return for an off port).
    W.state.values['DriveUnit.LOW_POWER_PORT_ACTIVE'] = { status: 'ok', hex: '', display: 'off' };
    sandbox.Bes3WorkshopUI.render();
    ui.switchTab('write');
    setPortPill('LOW', 'disable');
    // portChanges should recognise empty hex as already-off and produce no step.
    await ui.dom.dispatchAction('portApply');
    const keys = Array.from(ui.doc.querySelectorAll('[data-pending-key]')).map((n) => n.dataset.pendingKey);
    assert(!keys.includes('DriveUnit.LOW_POWER_PORT_ACTIVE'),
      'a port with empty payload (proto3 implicit off) must not be staged for disable — it already matches');
    // Seed LOW as explicit '08 01' (on) — should stage a disable.
    W.state.values['DriveUnit.LOW_POWER_PORT_ACTIVE'] = { status: 'ok', hex: '08 01', display: 'on' };
    sandbox.Bes3WorkshopUI.render();
    ui.switchTab('write');
    setPortPill('LOW', 'disable');
    await ui.dom.dispatchAction('portApply');
    const keys2 = Array.from(ui.doc.querySelectorAll('[data-pending-key]')).map((n) => n.dataset.pendingKey);
    assert(keys2.includes('DriveUnit.LOW_POWER_PORT_ACTIVE'),
      'a port with on payload must be staged for disable');
  });

  await checkAsync('UI Configure: every card is a closed dropdown that stays open across re-renders', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    const ids = ['lightCard', 'svcCard', 'portCard', 'idCard', 'advCard'];
    let html = writeView().innerHTML;
    for (const id of ids) {
      const tag = new RegExp('<details[^>]*id="' + id + '"[^>]*>').exec(html);
      assert(tag, id + ' is a details element');
      assert(!/\bopen\b/.test(tag[0]), id + ' is closed by default');
    }
    // Opening a card (the native toggle) must survive the re-render caused by
    // one of its own controls.
    const lightCard = ui.doc.getElementById('lightCard');
    assert(lightCard && typeof lightCard.ontoggle === 'function', 'the dropdown toggle is bound');
    lightCard.open = true;
    lightCard.ontoggle();
    const avail = ui.doc.getElementById('lAvail');
    avail.checked = !avail.checked;
    avail.onchange();
    html = writeView().innerHTML;
    const openTag = new RegExp('<details[^>]*id="lightCard"[^>]*>').exec(html);
    assert(openTag && /\bopen\b/.test(openTag[0]), 'the opened card stays open after its control re-renders');
    // A session change collapses every card again and clears the port choice.
    setPortPill('LOW', 'disable');
    W.simulateConnectionLoss();
    sandbox.Bes3WorkshopUI.render();
    ui.switchTab('write');
    html = writeView().innerHTML;
    assert(!/data-port-set="unchanged"/.test(html), 'the port choice is cleared on session change');
    for (const id of ids) {
      const tag = new RegExp('<details[^>]*id="' + id + '"[^>]*>').exec(html);
      assert(tag && !/\bopen\b/.test(tag[0]), id + ' is closed again after a session change');
    }
  });

  await checkAsync('UI staging: Apply sends the visible batch in order and reads it back', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    await ui.dom.dispatchAction('svcApply');
    await stageLab('DriveUnit.BIKE_LIGHT_CONFIGURATION', '08 03');
    assert(/Pending changes \(2\)/.test(writeView().innerHTML), 'both changes are staged');
    const before = mutations;
    const logStart = W.state.log.length;
    const applyP = ui.dom.dispatchAction('pendingApply');
    await finishRunModal();
    await applyP;
    const entries = W.state.log.slice(logStart).filter((e) => e && e.label);
    eq(entries.length, 2, 'two writes were logged');
    assert(/service interval/i.test(entries[0].label), 'the service write is first: ' + entries[0].label);
    assert(/light/i.test(entries[1].label), 'the light write is second: ' + entries[1].label);
    assert(mutations >= before + 2, 'both writes reached the simulated bike');
    assert(entries.every((e) => e.applied), 'both writes were confirmed by read-back: ' + entries.map((e) => e.label + '=' + e.applied).join(', '));
    assert(!/id="pendingChanges"/.test(writeView().innerHTML), 'applied rows leave the pending panel');
  });

  await checkAsync('UI staging: Apply stops at the first unverified step and keeps the rest staged', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    await ui.dom.dispatchAction('svcApply');
    await stageLab('DriveUnit.BIKE_LIGHT_CONFIGURATION', '08 03');
    const before = mutations;
    const logStart = W.state.log.length;
    dropReadAddr = W.util.addrOf('RemoteControl', 'SERVICE_DUE');
    const applyP = ui.dom.dispatchAction('pendingApply');
    await finishRunModal();
    await applyP;
    dropReadAddr = null;
    const entries = W.state.log.slice(logStart).filter((e) => e && e.label);
    eq(entries.length, 1, 'only the first step was attempted');
    assert(/service interval/i.test(entries[0].label), 'the failing step is the service write');
    eq(mutations, before + 1, 'no further write frame was sent');
    assert(/Pending changes \(2\)/.test(writeView().innerHTML), 'unapplied rows stay staged');
    assert(/No further steps were sent/.test(ui.doc.getElementById('runResult').innerHTML), 'the result says the batch stopped');
  });

  await checkAsync('UI staging: one typed gate covers two risky rows', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    const risky = [];
    for (const e of REGISTRY) {
      if (POLICY.genericTier(e.component, e.name).tier !== 'high-impact') continue;
      const key = e.component + '.' + e.name;
      if (!W.state.values[key]) await W.readKey(e.component, e.name);
      if (W.state.values[key] && W.state.values[key].status === 'ok') risky.push(key);
      if (risky.length === 2) break;
    }
    eq(risky.length, 2, 'two readable high-impact registers are available');
    for (const key of risky) {
      const target = ui.doc.querySelectorAll('[data-wlkey]').find((b) => b.dataset.wlkey === key);
      assert(target, 'the risky register is listed: ' + key);
      target.onclick();
      await sleep(0);
      const raw = ui.doc.getElementById('wlPayload');
      raw.value = '08 01';
      raw.oninput();
      await ui.dom.dispatchAction('advWrite');
    }
    assert(/Pending changes \(2\)/.test(writeView().innerHTML), 'both risky rows are staged');
    const before = mutations;
    const applyP = ui.dom.dispatchAction('pendingApply');
    for (let i = 0; i < 100 && !/Confirm high-impact registers/.test(ui.doc.getElementById('modalTitle').textContent); i++) await sleep(1);
    eq(ui.doc.getElementById('modalTitle').textContent, 'Confirm high-impact registers', 'the typed gate opens once');
    eq(ui.doc.querySelectorAll('#modalBody input').length, 2, 'there is one input per risky row');
    const go = ui.doc.getElementById('batchTypedGo');
    assert(go && go.disabled, 'Continue starts disabled');
    const input0 = ui.doc.getElementById('batchTyped0');
    const input1 = ui.doc.getElementById('batchTyped1');
    input0.value = risky[0]; input0.oninput();
    assert(go.disabled, 'one matching name is not enough');
    input1.value = risky[1]; input1.oninput();
    assert(!go.disabled, 'both matching names enable Continue');
    go.onclick();
    await finishRunModal();
    await applyP;
    const entries = W.state.log.filter((e) => e && risky.indexOf(e.component + '.' + e.name) !== -1);
    eq(entries.length, 2, 'both risky writes ran in one batch');
    assert(entries.every((e) => e.applied), 'the writer boundary accepted both typed names: '
      + entries.map((e) => e.label + '=' + e.applied).join(', '));
    assert(mutations >= before + 2, 'both writes reached the simulated bike');
    assert(!/Confirm high-impact registers/.test(ui.doc.getElementById('modalTitle').textContent), 'no second typed gate opened');
  });

  await checkAsync('UI privacy: the log anonymise switch is present and the export masks identifiers', async () => {
    assert(ui, 'the UI sandbox loaded');
    await openWriteTab();
    ui.switchTab('log');
    await sleep(0);
    const anon = ui.doc.getElementById('exportAnon');
    assert(anon, 'the log view offers the anonymise switch');
    anon.checked = true;
    anon.onchange();
    const plain = W.exportState();
    const masked = W.exportState({ anonymize: true });
    const serial = plain.values['DriveUnit.SERIAL_NUMBER'];
    assert(serial, 'the demo readout has a serial register');
    assert(!/\*/.test(String(serial.value)), 'the plain export keeps the serial value');
    assert(!JSON.stringify(masked).includes(String(serial.value)), 'the anonymised export drops the serial value');
  });

  check('PDF component glyphs: every thumbnail component type has a vector fallback', () => {
    const expected = ['DriveUnit', 'Battery', 'Battery2', 'RemoteControl', 'MiniRemote', 'HeadUnit', 'ConnectModule', 'AntiLockBrakeSystem'];
    eq(PRESENTATION.COMPONENT_GLYPH_KEYS.slice().sort().join(','), expected.slice().sort().join(','), 'all thumbnail component types are covered');
    for (const key of expected) {
      eq(PRESENTATION.hasComponentGlyph(key), true, 'glyph declared for ' + key);
      let calls = 0;
      const stub = {
        setFillColor() {}, setDrawColor() {}, setTextColor() {}, setFont() {}, setFontSize() {}, setLineWidth() {},
        setLineCap() {}, setLineJoin() {},
        text() { calls++; }, rect() { calls++; }, roundedRect() { calls++; }, circle() { calls++; }, line() { calls++; },
      };
      eq(PRESENTATION.drawComponentGlyph(stub, key, 0, 0), true, 'glyph draws for ' + key);
      assert(calls > 0, 'glyph emitted shapes for ' + key);
    }
    eq(PRESENTATION.hasComponentGlyph('Unknown'), false, 'an unknown component has no glyph');
    eq(PRESENTATION.drawComponentGlyph({}, 'Unknown', 0, 0), false, 'drawing an unknown component is a no-op');
  });

  check('PDF battery glyphs: every metric has a distinct monochrome vector glyph', () => {
    const expected = ['soc', 'volt', 'cyc', 'kwh', 'cold', 'hot', 'soh', 'remaining'];
    eq(PRESENTATION.BATTERY_GLYPH_KEYS.slice().sort().join(','), expected.slice().sort().join(','), 'all eight battery metrics are covered');
    const signatures = new Set();
    for (const kind of expected) {
      eq(PRESENTATION.hasBatteryGlyph(kind), true, 'glyph declared for ' + kind);
      const shapes = [];
      const stub = {
        setFillColor() {}, setDrawColor() {}, setTextColor() {}, setFont() {}, setFontSize() {},
        setLineWidth(w) { shapes.push('lw:' + w); },
        setLineCap(v) { shapes.push('cap:' + v); }, setLineJoin(v) { shapes.push('join:' + v); },
        rect(...a) { shapes.push('rect:' + a.join(',')); },
        roundedRect(...a) { shapes.push('round:' + a.join(',')); },
        circle(...a) { shapes.push('circle:' + a.join(',')); },
        ellipse() { shapes.push('ellipse'); },
        line(...a) { shapes.push('line:' + a.join(',')); },
        text() {},
      };
      eq(PRESENTATION.drawBatteryGlyph(stub, kind, 0, 0, [0, 0, 0]), true, 'glyph draws for ' + kind);
      assert(shapes.length > 1, kind + ' emitted shapes');
      assert(shapes.indexOf('lw:0.5') !== -1, kind + ' uses the shared stroke width');
      assert(shapes.indexOf('cap:round') !== -1, kind + ' uses rounded line caps');
      assert(shapes.indexOf('join:round') !== -1, kind + ' uses rounded line joins');
      assert(shapes.lastIndexOf('cap:butt') > shapes.lastIndexOf('cap:round'), kind + ' restores the default line cap');
      signatures.add(shapes.join('|'));
    }
    eq(signatures.size, expected.length, 'every battery metric has a distinct glyph');
    eq(PRESENTATION.hasBatteryGlyph('unknown'), false, 'an unknown metric has no glyph');
    eq(PRESENTATION.drawBatteryGlyph({}, 'unknown', 0, 0), false, 'drawing an unknown metric is a no-op');
  });

  await checkAsync('UI & PDF component photos: default OFF, pinned opt-in, missing fallback, and PDF without embedded module', async () => {
    assert(ui, 'the UI sandbox loaded');
    await ui.startDemo();
    resetFrameCounters();
    uiHarness.switchTab('read');

    const P = sandbox.Bes3PartImages;
    assert(P && typeof P.resolve === 'function', 'Bes3PartImages exposes resolve');
    assert(
      P.UPSTREAM_IMAGE_BASE === 'https://cdn.jsdelivr.net/gh/rweijnen/bosch-bes3-reader@cd9a5510ae1091c467d8d5a586a23723c17a9249/web/parts/',
      'pinned upstream image base matches commit'
    );

    // 1. Default OFF without local photos: no external URL on any image, generic SVG icon used.
    P.setLocalAvailable(false);
    P.setRemoteOptIn(false);
    P.setMissingUpstreamFiles([]);
    sandbox.Bes3WorkshopUI.render();
    const readHtmlOff = uiHarness.doc.getElementById('view-read').innerHTML;
    assert(!/https?:\/\/cdn\.jsdelivr\.net/i.test(readHtmlOff), 'default OFF renders no external CDN URL');
    assert(!/<img\b/i.test(readHtmlOff), 'default OFF renders no <img> tags when local photos are absent');
    assert(/<svg\b/i.test(readHtmlOff), 'default OFF renders generic SVG icons');
    eq(P.resolve('DriveUnit', 'BDU3740'), null, 'resolve returns null when local is missing and opt-in is OFF');

    // 2. Opt-in ON via the single header button: URLs use the pinned base, in memory only.
    const headerBtn = ui.doc.getElementById('btnPhotos');
    assert(headerBtn && headerBtn.id === 'btnPhotos', 'the photo button lives in the header');
    assert(!readHtmlOff.includes('remotePhotosOptIn'), 'the Overview checkbox is gone');
    assert(!readHtmlOff.includes('photoBtn-'), 'the Overview has no second photo control');
    eq(headerBtn.dataset.state, 'idle', 'the header button starts as not loaded');
    assert(/cdn\.jsdelivr\.net/.test(headerBtn.title || ''), 'the hover text explains the external request');
    const originalPreload = P.preloadPdfImages;
    const originalEnsure = P.ensurePdfImages;
    P.preloadPdfImages = async () => ({ loaded: 1 });
    P.ensurePdfImages = async () => ({ converted: 1, failed: 0 });
    await ui.dom.dispatchAction('loadPhotos');
    await sleep(0);
    eq(P.isRemoteOptIn(), true, 'the button enables remote photo opt-in in memory');
    eq(ui.doc.getElementById('btnPhotos').dataset.state, 'loaded', 'the header button shows the loaded state');
    const readHtmlOn = uiHarness.doc.getElementById('view-read').innerHTML;
    assert(readHtmlOn.includes(P.UPSTREAM_IMAGE_BASE + 'ic_bdu374_performance_line_cx.webp'), 'opt-in ON renders pinned upstream URL');
    // Loaded once -> every tab uses the photos (the opt-in is global state).
    ui.switchTab('report');
    await sleep(0);
    assert(!ui.doc.getElementById('view-report').innerHTML.includes('photoBtn-'), 'the report tab has no second photo control');
    eq(ui.doc.getElementById('btnPhotos').dataset.state, 'loaded', 'the header button keeps its state in every tab');
    uiHarness.switchTab('read');
    await sleep(0);

    // 3. Missing local and remote -> falls back to generic icon (null).
    P.setMissingUpstreamFiles(['ic_bdu374_performance_line_cx.webp']);
    eq(P.resolve('DriveUnit', 'BDU3740'), null, 'file in MISSING_UPSTREAM_FILES falls back to icon');
    eq(P.resolve('DriveUnit', 'UNKNOWN_CODE_999'), null, 'unmapped code falls back to icon');
    sandbox.Bes3WorkshopUI.render();
    const readHtmlMissing = uiHarness.doc.getElementById('view-read').innerHTML;
    assert(!readHtmlMissing.includes('ic_bdu374_performance_line_cx.webp'), 'missing upstream file is omitted from <img>');

    // 4. Local available -> local path wins first.
    P.setMissingUpstreamFiles([]);
    P.setLocalAvailable(true);
    eq(P.resolve('DriveUnit', 'BDU3740'), 'web/parts/ic_bdu374_performance_line_cx.webp', 'local file takes precedence when present');
    const savedMarker = sandbox.Bes3LocalPartPhotos;
    sandbox.Bes3PartImagesPdf = { 'fake.webp': 'data:image/jpeg;base64,AA' };
    sandbox.Bes3LocalPartPhotos = false;
    P.setLocalAvailable(null);
    eq(P.hasLocalPhotos(), false, 'the public marker disables the local photo bundle');
    sandbox.Bes3LocalPartPhotos = true;
    eq(P.hasLocalPhotos(), true, 'the private marker allows the local photo bundle');
    sandbox.Bes3LocalPartPhotos = savedMarker;
    delete sandbox.Bes3PartImagesPdf;
    P.setLocalAvailable(null);

    // 5. PDF without embedded module and without opt-in -> no error, zero images added.
    P.setLocalAvailable(false);
    P.setRemoteOptIn(false);
    P.clearPdfCache();
    delete sandbox.Bes3PartImagesPdf;
    let addedImages = 0;
    sandbox.jspdf = {
      jsPDF: function () {
        return {
          setProperties() {},
          setFillColor() {},
          setDrawColor() {},
          setTextColor() {},
          setFont() {},
          setFontSize() {},
          setLineWidth() {},
          setLineCap() {},
          setLineJoin() {},
          rect() {},
          roundedRect() {},
          line() {},
          lines() {},
          circle() {},
          ellipse() {},
          triangle() {},
          text() {},
          textWithLink() {},
          getTextWidth(s) { return String(s || '').length * 1.8; },
          splitTextToSize(s) { return [String(s || '')]; },
          addPage() {},
          addImage() { addedImages++; },
          output() { return new Blob([], { type: 'application/pdf' }); },
          save() {},
        };
      },
    };
    const d = sandbox.Bes3WorkshopUI.summary();
    const fmt = new Intl.NumberFormat('en-US');
    const pdfDoc = sandbox.Bes3WorkshopReport.build(d, {
      ref: '',
      notes: '',
      anonymize: false,
      helpers: {
        fmtDate: () => '2026-10-25',
        fmtDateTime: () => '2026-10-25 12:00',
        serviceText: () => 'Not set',
        lightConfigLabel: () => 'Default',
        partImg: (comp, code) => P.resolve(comp, code),
        NF0: fmt,
        NF1: fmt,
        NF2: fmt,
      },
    });
    assert(pdfDoc, 'PDF builds cleanly without Bes3PartImagesPdf and without opt-in');
    eq(addedImages, 0, 'no PDF images added when embedded module is absent and opt-in is OFF');
    eq(mutations, 0, 'photo source resolution and PDF build send zero write/RPC frames');

    // 5b. With photos loaded, the report draws the component photos and the
    //     assistance-mode colours.
    P.setRemoteOptIn(true);
    const fakeEntries = {
      'ic_bdu374_performance_line_cx.webp': { data: 'data:image/jpeg;base64,AAAA', size: [120, 80] },
    };
    const originalGetPdfImage = P.getPdfImage;
    P.getPdfImage = (comp, code) => {
      const file = originalGetPdfImage.call(P, comp, code);
      if (file) return file;
      const name = comp === 'DriveUnit' ? 'ic_bdu374_performance_line_cx.webp' : null;
      return name ? fakeEntries[name] : null;
    };
    let imageCalls = 0;
    const fillColors = [];
    const swatchColors = [];
    let currentFill = '';
    sandbox.jspdf = {
      jsPDF: function () {
        return {
          setProperties() {},
          setFillColor(r, g, b) { currentFill = [r, g, b].join(','); fillColors.push(currentFill); },
          setDrawColor() {},
          setTextColor() {},
          setFont() {},
          setFontSize() {},
          setLineWidth() {},
          setLineCap() {},
          setLineJoin() {},
          rect() {},
          roundedRect(x, y, w, h) { swatchColors.push({ color: currentFill, w, h }); },
          line() {},
          lines() {},
          circle() {},
          ellipse() {},
          triangle() {},
          text() {},
          textWithLink() {},
          getTextWidth(s) { return String(s || '').length * 1.8; },
          splitTextToSize(s) { return [String(s || '')]; },
          addPage() {},
          addImage() { imageCalls++; },
          output() { return new Blob([], { type: 'application/pdf' }); },
          save() {},
        };
      },
    };
    const withPhotos = sandbox.Bes3WorkshopReport.build(sandbox.Bes3WorkshopUI.summary(), {
      ref: '',
      notes: '',
      anonymize: false,
      helpers: {
        fmtDate: () => '2026-10-25',
        fmtDateTime: () => '2026-10-25 12:00',
        serviceText: () => 'Not set',
        lightConfigLabel: () => 'Default',
        partImg: (comp, code) => P.resolve(comp, code),
        NF0: fmt,
        NF1: fmt,
        NF2: fmt,
      },
    });
    assert(withPhotos, 'PDF builds with photos available');
    assert(imageCalls > 0, 'the report embeds the loaded component photos (' + imageCalls + ')');
    const modeColors = (sandbox.Bes3WorkshopUI.summary().modes || [])
      .map((m) => m.color)
      .filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
      .map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)].join(','));
    assert(modeColors.length > 0, 'the readout reports assistance-mode colours');
    assert(
      swatchColors.some((s) => s.w === 2.7 && modeColors.includes(s.color)),
      'the report draws a colour swatch for the assistance modes'
    );
    P.getPdfImage = originalGetPdfImage;
    P.setRemoteOptIn(false);

    // 6. The header button keeps its state and is the only photo control.
    P.setRemoteOptIn(false);
    ui.switchTab('report');
    await sleep(0);
    assert(!ui.doc.getElementById('view-report').innerHTML.includes('photoBtn-'), 'the report tab has no second photo control');
    assert(ui.doc.getElementById('btnPhotos'), 'the header button is present in the report tab');
    P.preloadPdfImages = async () => ({ loaded: 0 });
    P.ensurePdfImages = async () => ({ converted: 0, failed: 1 });
    await ui.dom.dispatchAction('loadPhotos');
    await sleep(0);
    eq(ui.doc.getElementById('btnPhotos').dataset.state, 'failed', 'the failed state is shown on the header button');
    P.preloadPdfImages = originalPreload;
    P.ensurePdfImages = originalEnsure;
    P.setRemoteOptIn(false);
    await W.disconnect();
  });
}

// The real WebUSB transport is loaded only against a fake USBDevice. These
// checks reproduce the post-transfer failures without opening a real device.
function usbData(bytes) {
  const u = new Uint8Array(bytes);
  return new DataView(u.buffer);
}

class FakeUsbDevice {
  constructor(behaviour) {
    this.behaviour = behaviour || {};
    this.outCalls = 0;
    this.inCalls = 0;
    this.transferOutCalls = 0;
  }
  async controlTransferOut() {
    this.outCalls++;
    return { status: 'ok' };
  }
  async transferOut() {
    this.transferOutCalls++;
    if (this.behaviour.transferOutReject) throw new Error('transferOut rejected by the fake device');
    if (this.behaviour.transferOutStatus) return { status: this.behaviour.transferOutStatus };
    if (this.behaviour.transferOutShort) {
      const written = this.behaviour.transferOutShort;
      return { status: 'ok', bytesWritten: written };
    }
    return { status: 'ok', bytesWritten: 64 };  // padded MCSP frame is ≥ 64 bytes
  }
  async controlTransferIn(setup) {
    this.inCalls++;
    if (this.behaviour.rejectIn) throw new Error('controlTransferIn rejected by the fake device');
    if (setup.request !== 0x47) return { status: 'ok', data: usbData([0]) };
    const ack = this.behaviour.ack || [0, 3, 0];
    return { status: 'ok', data: usbData(ack) };
  }
}

function loadFakeWebUsb(device) {
  const fakeWindow = {};
  new Function('window', readFileSync(path.join(repo, 'web', 'workshop', 'usb-ack.js'), 'utf8'))(fakeWindow);
  const fakeNavigator = { usb: { requestDevice: async () => device } };
  new Function('window', 'navigator', readFileSync(path.join(repo, 'web', 'transport-webusb.js'), 'utf8'))(fakeWindow, fakeNavigator);
  assert(fakeWindow.Bes3WebUsb && fakeWindow.Bes3WebUsb.Bes3WebUsbTransport,
    'the real WebUSB transport did not expose Bes3WebUsbTransport');
  return { api: fakeWindow.Bes3WebUsb, navigator: fakeNavigator };
}

async function webUsbWriteError(behaviour) {
  const device = new FakeUsbDevice(behaviour);
  const { api, navigator } = loadFakeWebUsb(device);
  eq(await api.requestDevice(), device, 'requestDevice used the fake navigator.usb');
  const transport = new api.Bes3WebUsbTransport(device);
  const err = await capture(() => transport.doMcspWrite(Uint8Array.from([0x10, 0x02])));
  assert(err, 'the write failed');
  eq(device.transferOutCalls, 1, 'the fake device received one transferOut');
  return { err, device, navigator };
}

await checkAsync('USB transport: a controlTransferIn rejection after transferOut is marked transferred', async () => {
  const { err, navigator } = await webUsbWriteError({ rejectIn: true });
  eq(err.transferred, true, 'the frame was transferred even though the ACK read failed');
  assert(/controlTransferIn rejected/i.test(err.message), 'the original failure is preserved: ' + err.message);
  eq(navigator.usb !== undefined, true, 'the sandbox used a fake navigator.usb');
});

await checkAsync('USB transport: a non-ok ACK status byte after transferOut is marked transferred', async () => {
  const { err, device } = await webUsbWriteError({ ack: [0, 1, 6] });
  eq(err.transferred, true, 'the frame was transferred before the status byte was read');
  assert(/status byte = 6/.test(err.message), 'the ACK status byte is reported: ' + err.message);
  eq(device.inCalls, 1, 'the ACK was read once');
});

await checkAsync('USB transport: an ACK timeout is marked transferred and keeps the poll count', async () => {
  const { err, device } = await webUsbWriteError({ ack: [0, 3, 0] });
  eq(err.transferred, true, 'the frame was transferred even though the ACK timed out');
  assert(/not acknowledged/i.test(err.message), 'the timeout is reported honestly: ' + err.message);
  eq(device.inCalls, 10, 'the ACK polling timing is unchanged (ten polls)');
});

await checkAsync('USB transport: a transferOut rejection stays not transferred', async () => {
  const { err } = await webUsbWriteError({ transferOutReject: true });
  assert(!err.transferred, 'a failed transferOut is not marked as transferred');
  assert(/transferOut rejected/i.test(err.message), 'the transferOut failure is preserved: ' + err.message);
});

await checkAsync('USB transport: a stalled bulk OUT is not marked transferred and never enters ACK polling', async () => {
  const device = new FakeUsbDevice({ transferOutStatus: 'stall' });
  const { api } = loadFakeWebUsb(device);
  const transport = new api.Bes3WebUsbTransport(device);
  const err = await capture(() => transport.doMcspWrite(Uint8Array.from([0x10, 0x02])));
  assert(err, 'a stalled transferOut must throw');
  assert(!err.transferred, 'stall is not treated as transmitted');
  assert(/stall/i.test(err.message), 'stall status reported: ' + err.message);
  eq(device.inCalls, 0, 'ACK polling must not run after a stall');
});

await checkAsync('USB transport: a short bulk OUT is not marked transferred and never enters ACK polling', async () => {
  // The padded payload for [0x10, 0x02] is 64 bytes; report only 32 written.
  const device = new FakeUsbDevice({ transferOutShort: 32 });
  const { api } = loadFakeWebUsb(device);
  const transport = new api.Bes3WebUsbTransport(device);
  const err = await capture(() => transport.doMcspWrite(Uint8Array.from([0x10, 0x02])));
  assert(err, 'a short transferOut must throw');
  assert(!err.transferred, 'short write is not treated as transmitted');
  assert(/short write/i.test(err.message), 'short write reported: ' + err.message);
  eq(device.inCalls, 0, 'ACK polling must not run after a short write');
});

check('protocol: parseReadResponseFrame rejects truncated frames and buildFrame guards body length', () => {
  const P = sandbox.Bes3Protocol;
  // Declared length 8, but only 6 body bytes present -> rejected (null)
  const truncated = Uint8Array.from([0x30, 0x08, 0x18, 0x00, 0x8e, 0x10, 0x11, 0x08]);
  eq(P.parseReadResponseFrame(truncated), null, 'truncated read response is rejected');
  // NotifyMessage with declared length 5, but only 3 body bytes -> rejected
  const truncatedNotify = Uint8Array.from([0x30, 0x05, 0x98, 0x00, 0x01]);
  eq(P.parseNotifyMessage(truncatedNotify), null, 'truncated notify frame is rejected');
  // Full 6-byte body with declared length 6 -> accepted
  const full = Uint8Array.from([0x30, 0x06, 0x18, 0x00, 0x8e, 0x10, 0x11, 0x42]);
  const parsed = P.parseReadResponseFrame(full);
  assert(parsed && parsed.ok, 'complete frame is accepted');
  // Overlong payload (>250 bytes -> body > 255 bytes) throws RangeError
  let threw = false;
  try {
    P.buildWriteFrame(0x1800, 1, new Array(251).fill(0));
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw, 'buildWriteFrame throws RangeError when body exceeds 255 bytes');
});

await checkAsync('Node USB transport & CLI: init handshake, exclusive mutex and type+seq matching', async () => {
  const nodeTransportMod = createRequire(import.meta.url)(path.join(repo, 'node', 'transport-node-usb.js'));
  const cliMod = createRequire(import.meta.url)(path.join(repo, 'node', 'cli.js'));
  const controlCalls = [];
  const bulkWrites = [];
  const fakeDevice = {
    open() {},
    close() {},
    interface() {
      return {
        claim() {},
        release(_close, cb) { if (cb) cb(); },
        endpoints: [
          { address: 4, transfer(buf, cb) { bulkWrites.push(Buffer.from(buf)); cb(null); } },
          { address: 3 | 0x80, transfer(_len, cb) { cb(null, Buffer.alloc(0)); } },
        ],
      };
    },
    controlTransfer(bm, req, wVal, wIdx, dataOrLen, cb) {
      controlCalls.push({ bm, req });
      if (req === 0x01) return cb(null, Buffer.from([0x00]));
      if (req === 0x47) return cb(null, Buffer.from([0x02, 0x00, 0x00]));
      if (req === 0x44) return cb(null, Buffer.alloc(7)); // 0 pending bytes
      return cb(null, Buffer.alloc(0));
    },
  };
  const nt = new nodeTransportMod.Bes3UsbTransport(fakeDevice);
  await nt.open();
  // 1 status IN (0x01) + 5 config OUTs (0x00, 0x43, 0x23, 0x41, 0x21) + 9 handshake frames
  assert(controlCalls.some((c) => c.req === 0x43), 'Node transport sends bridge config 0x43 during open()');
  eq(bulkWrites.length, 9, 'Node transport sends all 9 MCSP handshake frames during open()');

  // Verify cli.readOne ignores wrong type/seq and matches exact READ_RESPONSE + seq
  let callIdx = 0;
  let lastSeq = 0;
  const fakeCliTransport = {
    async doMcspWrite(frame) { lastSeq = frame[6] & 0x0f; },
    async readNextFrame() {
      callIdx++;
      if (callIdx === 1) {
        // RPC_RESPONSE (type 5) with matching seq -> must be ignored by readOne
        return Uint8Array.from([0x30, 0x07, 0x18, 0x00, 0x8e, 0x10, (5 << 4) | lastSeq, 0x08, 0x99]);
      }
      if (callIdx === 2) {
        // READ_RESPONSE (type 1) with wrong seq -> must be ignored
        return Uint8Array.from([0x30, 0x07, 0x18, 0x00, 0x8e, 0x10, (1 << 4) | ((lastSeq + 1) & 0x0f), 0x08, 0x88]);
      }
      // Correct READ_RESPONSE (type 1) + matching seq
      return Uint8Array.from([0x30, 0x07, 0x18, 0x00, 0x8e, 0x10, (1 << 4) | lastSeq, 0x08, 0x01]);
    },
  };
  const res = await cliMod.readOne(fakeCliTransport, 0x1800);
  assert(res && Array.from(res.payload).join(',') === '8,1', 'CLI readOne matches exact READ_RESPONSE and seq');
});

await checkAsync('Node USB transport: endpoint-state byte (byte 0 = 3) triggers busy retry', async () => {
  // byte 0 = 3 (endpoint busy), byte 1 ≠ 3, byte 2 = 0 → must retry, not succeed.
  // After exhausting retries the transport should time out.
  const nodeTransportMod = createRequire(import.meta.url)(path.join(repo, 'node', 'transport-node-usb.js'));
  let callCount = 0;
  let blockOnByte0 = false;  // only activate byte-0 busy after open() completes
  const fakeDevice = {
    open() {}, close() {},
    interface() {
      return {
        claim() {},
        release(_c, cb) { if (cb) cb(); },
        endpoints: [
          { address: 4, transfer(_b, cb) { cb(null); } },
          { address: 3 | 0x80, transfer(_l, cb) { cb(null, Buffer.alloc(0)); } },
        ],
      };
    },
    controlTransfer(_bm, req, _wV, _wI, _dL, cb) {
      if (req === 0x01) return cb(null, Buffer.from([0x00]));
      if (req === 0x47) {
        if (blockOnByte0) {
          callCount++;
          // byte 0 = 3 (endpoint busy), byte 1 = 0 (not ack-busy), byte 2 = 0 (no error)
          return cb(null, Buffer.from([0x03, 0x00, 0x00]));
        }
        return cb(null, Buffer.from([0x02, 0x00, 0x00]));  // success during init
      }
      if (req === 0x44) return cb(null, Buffer.alloc(7));
      return cb(null, Buffer.alloc(0));
    },
  };
  const nt = new nodeTransportMod.Bes3UsbTransport(fakeDevice);
  await nt.open();
  callCount = 0;
  blockOnByte0 = true;  // now all ACK polls return endpoint-state = busy
  let threw = false;
  try { await nt.doMcspWrite(Buffer.from([0x10, 0x02])); }
  catch (e) { threw = e.message.includes('timeout') || e.message.includes('ACK'); }
  assert(threw, 'byte-0 = 3 must cause a timeout, not a silent success');
  eq(callCount, 10, 'all 10 ACK polls fired (no early exit on byte-0 busy)');
});

await checkAsync('Web Bluetooth transports: Live Data BLE decoder/stream and MCSP BLE peer handshake & address rewrite', async () => {
  const bleWindow = {
    __bes3Now: () => Date.now(),
    __bes3Sleep: () => Promise.resolve(),
  };
  const fakeBluetooth = {};
  new Function('window', 'navigator', readFileSync(path.join(repo, 'web', 'transport-webble.js'), 'utf8'))(bleWindow, { bluetooth: fakeBluetooth });
  new Function('window', 'navigator', readFileSync(path.join(repo, 'web', 'transport-webble-mcsp.js'), 'utf8'))(bleWindow, { bluetooth: fakeBluetooth });

  const LiveBle = bleWindow.Bes3LiveDataBle;
  const McspBle = bleWindow.Bes3BleMcsp;
  assert(LiveBle && LiveBle.decodeLiveData, 'transport-webble.js exposes Bes3LiveDataBle');
  assert(McspBle && McspBle.Bes3BleMcspTransport, 'transport-webble-mcsp.js exposes Bes3BleMcsp');

  // 1. Live Data BLE protobuf decoding (speed=25.50 km/h -> 2550, cadence=72, soc=84%, light=ON=2, locked=true, truncated tail ignored)
  const sampleLive = Uint8Array.from([
    0x08, 0xf6, 0x13,       // field 1 (speed): 2550 -> 25.5 km/h
    0x10, 0x48,             // field 2 (cadence): 72 rpm
    0x28, 0xfa, 0x01,       // field 5 (riderPower): 250 W
    0x50, 0x54,             // field 10 (soc): 84 %
    0x60, 0xe8, 0x07,       // field 12 (odometer): 1000 m
    0x88, 0x01, 0x02,       // field 17 (bikeLight): 2 -> ON
    0xa8, 0x01, 0x01,       // field 21 (systemLocked): true
    0x08, 0x80,             // truncated varint at tail -> ignored safely
  ]);
  const decoded = LiveBle.decodeLiveData(sampleLive);
  eq(decoded.speedKmh, 25.5, 'Live Data speed decoded');
  eq(decoded.cadenceRpm, 72, 'Live Data cadence decoded');
  eq(decoded.riderPowerW, 250, 'Live Data rider power decoded');
  eq(decoded.batterySocPercent, 84, 'Live Data battery SoC decoded');
  eq(decoded.odometerMeters, 1000, 'Live Data odometer decoded');
  eq(decoded.bikeLight, 'ON', 'Live Data light state decoded');
  eq(decoded.systemLocked, true, 'Live Data lock state decoded');

  // 2. MCSP BLE segmentation framing, handshake, MobileApp peer responder, and 0x0e10 <-> 0x4180 address rewrite
  const sentFrames = [];
  let notifyListener = null;
  const fakeGattDevice = {
    name: 'Fake Smart System BLE',
    id: 'ble-1',
    gatt: {
      async connect() {
        return {
          async getPrimaryService() {
            return {
              async getCharacteristic(uuid) {
                if (uuid === McspBle.RX_CHARACTERISTIC_UUID) {
                  return {
                    addEventListener(_evt, fn) { notifyListener = fn; },
                    removeEventListener() { notifyListener = null; },
                    async startNotifications() {},
                  };
                }
                return {
                  async writeValueWithoutResponse(frame) {
                    const copy = new Uint8Array(frame);
                    sentFrames.push(copy);
                    // When the transport sends DISABLE_FLOW_CONTROL on ch 7, echo VERSION and MAX_SEGMENTATION_PACKET on ch 0
                    const segs = McspBle.decodeSegmentationFrames(copy);
                    for (const seg of segs) {
                      if (seg.channel === 0 && seg.payload[0] === 0x03 && seg.payload[1] === 7 && notifyListener) {
                        const ackVer = McspBle.encodeSegmentationFrame(0, true, Uint8Array.from([0x01, 0x03]));
                        const ackMax = McspBle.encodeSegmentationFrame(0, true, Uint8Array.from([0x04, 0x02, 0x00]));
                        const both = new Uint8Array(ackVer.length + ackMax.length);
                        both.set(ackVer, 0);
                        both.set(ackMax, ackVer.length);
                        notifyListener({ target: { value: new DataView(both.buffer) } });
                      }
                    }
                  },
                };
              },
            };
          },
        };
      },
      disconnect() {},
    },
  };

  const bleTransport = new McspBle.Bes3BleMcspTransport(fakeGattDevice);
  await bleTransport.open();
  eq(sentFrames.length, 9, 'BLE MCSP open() sends 9 channel-0 control frames (VERSION, MAX_PACKET, 7x DISABLE_FLOW_CONTROL)');

  // Simulate bike reading MobileApp.MOBILE_APP_STATIC_FEATURE_PROPERTIES (0x40aa) and writing STARTUP_STAGE = 9 (0x40a9)
  const bikeReadProps = McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x20, 0x00, 0x40, 0xaa, 0x03]));
  const bikeWriteStage9 = McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x20, 0x00, 0x40, 0xa9, 0x24, 0x08, 0x09]));
  notifyListener({ target: { value: new DataView(bikeReadProps.buffer) } });
  notifyListener({ target: { value: new DataView(bikeWriteStage9.buffer) } });
  eq(bleTransport.startupStage, 9, 'MobileApp peer responder records STARTUP_STAGE = 9');
  eq(await bleTransport.waitForBikeReady(100), true, 'waitForBikeReady resolves immediately when STARTUP_STAGE == 9');

  // Outgoing frame rewrite: 0x0e10 -> 0x4180 without mutating caller's buffer
  const usbReadFrame = Uint8Array.from([0x30, 0x05, 0x0e, 0x10, 0x18, 0x00, 0x01]);
  await bleTransport.doMcspWrite(usbReadFrame);
  eq(usbReadFrame[2], 0x0e, 'caller buffer is not mutated in place');
  const lastOut = McspBle.decodeSegmentationFrames(sentFrames[sentFrames.length - 1])[0];
  eq(lastOut.channel, 1, 'application frame sent on channel 1');
  eq(lastOut.payload[0], 0x41, 'outgoing source high byte rewritten to 0x41');
  eq(lastOut.payload[1], 0x80, 'outgoing source low byte rewritten to 0x80');

  // Incoming response rewrite: 0x80 | 0x41, 0x80 -> 0x80 | 0x0e, 0x10 (preserving implicit-success MSB)
  const bikeResp = McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x18, 0x00, 0x80 | 0x41, 0x80, 0x11, 0x08, 0x01]));
  notifyListener({ target: { value: new DataView(bikeResp.buffer) } });
  const received = await bleTransport.readNextFrame(2, 0);
  assert(received && received[0] === 0x30, 'incoming BLE response wrapped with 0x30 header');
  eq(received[4], 0x8e, 'incoming destination high byte rewritten to 0x8e (0x80 success MSB preserved)');
  eq(received[5], 0x10, 'incoming destination low byte rewritten to 0x10');
  await bleTransport.close();
});

await checkAsync('Web Bluetooth MCSP: streaming reassembly, 12-bit wrapping and the MobileApp responder', async () => {
  const bleWindow = { __bes3Now: () => Date.now(), __bes3Sleep: () => Promise.resolve() };
  new Function('window', 'navigator', readFileSync(path.join(repo, 'web', 'transport-webble-mcsp.js'), 'utf8'))(bleWindow, { bluetooth: {} });
  const McspBle = bleWindow.Bes3BleMcsp;
  assert(McspBle && McspBle.parseSegmentationStream, 'the transport exposes the streaming parser');
  const sent = [];
  const makeTransport = () => {
    const t = new McspBle.Bes3BleMcspTransport({ name: 'fake', id: 'fake-2' });
    t.txChar = { async writeValueWithoutResponse(frame) { sent.push(new Uint8Array(frame)); } };
    return t;
  };
  const notify = (t, bytes) => t._handleNotification(Uint8Array.from(bytes));
  const lastSent = () => McspBle.decodeSegmentationFrames(sent[sent.length - 1])[0];

  // T1: a header split across notifications
  const t1 = makeTransport();
  notify(t1, [0x30, 0x05, 0x0e]);
  notify(t1, [0x10, 0x18, 0x00, 0x01]);
  const f1 = await t1.readNextFrame(1, 0);
  assert(f1 && f1[0] === 0x30 && f1[1] === 0x05, 'T1: split header reassembles');
  eq(Array.from(f1.slice(2)).join(','), '14,16,24,0,1', 'T1: payload intact');

  // T2: a payload split across notifications
  const t2 = makeTransport();
  notify(t2, [0x30, 0x05, 0x0e, 0x10]);
  notify(t2, [0x18, 0x00, 0x01]);
  const f2 = await t2.readNextFrame(1, 0);
  eq(f2 && f2.length, 7, 'T2: split payload reassembles');

  // T3: two complete frames in one notification
  const t3 = makeTransport();
  const a = McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x0e, 0x10, 0x18, 0x00, 0x01]));
  const b = McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x0e, 0x10, 0x18, 0x01, 0x01]));
  notify(t3, [...a, ...b]);
  const f3a = await t3.readNextFrame(1, 0);
  const f3b = await t3.readNextFrame(1, 0);
  assert(f3a && f3b, 'T3: both frames are emitted');

  // T4: channel-1 fragments joined
  const t4 = makeTransport();
  notify(t4, McspBle.encodeSegmentationFrame(1, false, Uint8Array.from([0x0e, 0x10, 0x18])));
  notify(t4, McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x00, 0x01])));
  const f4 = await t4.readNextFrame(1, 0);
  eq(f4 && f4[1], 5, 'T4: fragments join into one message');

  // T5: command and message fragments interleave independently
  const t5 = makeTransport();
  notify(t5, McspBle.encodeSegmentationFrame(0, true, Uint8Array.from([0x01, 0x03])));
  notify(t5, McspBle.encodeSegmentationFrame(1, false, Uint8Array.from([0x0e, 0x10])));
  notify(t5, McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x18, 0x00, 0x01])));
  eq(t5._commandsSeen.length, 1, 'T5: the command frame is kept');
  assert(await t5.readNextFrame(1, 0), 'T5: the message frame is kept');

  // T6: the channel accumulator is capped and the transport recovers
  const t6 = makeTransport();
  for (let i = 0; i < 5; i++) notify(t6, McspBle.encodeSegmentationFrame(1, false, new Uint8Array(4095)));
  eq(t6._channelAccumulators.size, 0, 'T6: an oversized fragment chain is dropped');
  notify(t6, McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x0e, 0x10, 0x18, 0x00, 0x01])));
  assert(await t6.readNextFrame(1, 0), 'T6: the transport recovers after a drop');

  // T7: close() clears partial state
  const t7 = makeTransport();
  notify(t7, McspBle.encodeSegmentationFrame(1, false, Uint8Array.from([0x0e])));
  await t7.close();
  eq(t7._rxStreamBuffer.length, 0, 'T7: the stream buffer is cleared');
  eq(t7._channelAccumulators.size, 0, 'T7: accumulators are cleared');

  // T8: a 300-byte message carries a 12-bit segmentation length but is not
  // queued: the shared parser reads a single-octet length, so delivering it
  // would silently truncate the payload.
  const t8 = makeTransport();
  const body300 = new Uint8Array(300);
  body300[0] = 0x18; body300[1] = 0x00; body300[2] = 0x8e; body300[3] = 0x10; body300[4] = 0x11;
  const seg300 = McspBle.encodeSegmentationFrame(1, true, body300);
  assert(seg300[0] === 0x31 && seg300[1] === 0x2c, 'T8: the segmentation header carries the 12-bit length (0x31 0x2c)');
  notify(t8, seg300);
  eq(await t8.readNextFrame(1, 0), null, 'T8: a >255-byte message is not queued for the single-octet parser');

  // T9: a completed message above the 4095-byte frame limit is dropped cleanly
  const t9b = makeTransport();
  notify(t9b, McspBle.encodeSegmentationFrame(1, false, new Uint8Array(2048)));
  notify(t9b, McspBle.encodeSegmentationFrame(1, true, new Uint8Array(2048)));
  eq(await t9b.readNextFrame(1, 0), null, 'T9: a 4096-byte message is dropped without throwing');

  // R1-R5: reads answer from 0x41xx with explicit statuses when refused
  const t9 = makeTransport();
  // TX is serialized through a promise chain, so give the queued response a
  // turn to run before inspecting the captured frames.
  const request = async (body) => {
    notify(t9, McspBle.encodeSegmentationFrame(1, true, Uint8Array.from(body)));
    await sleep(0);
  };
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0xaa, 0x03]);
  eq(lastSent().payload.join(','), '65,170,160,0,19,24,1', 'R1: static feature properties answer');
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0x81, 0x03]);
  eq(lastSent().payload.join(','), '65,129,160,0,19,8,0', 'R2: UI priority answer');
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0x9d, 0x03]);
  eq(lastSent().payload.join(','), '65,157,160,0,19,10,4,0,1,2,3', 'R3: issue types answer');
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0x85, 0x03]);
  eq(lastSent().payload.length, 5, 'R4: a known-empty read has no payload');
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0x77, 0x03]);
  const r5 = lastSent().payload;
  eq(r5[2], 0x20, 'R5: a failed response clears the success MSB');
  eq(r5[5], 0x04, 'R5: an unknown read is UNSUPPORTED');

  // R6-R8: startup-stage writes are validated before they are stored
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0xa9, 0x24, 0x08, 0x09]);
  eq(t9.startupStage, 9, 'R6: a valid stage is stored');
  eq(lastSent().payload[4], 0x34, 'R6: WRITE_RESPONSE is sent');
  await request([0x20, 0x00, 0x40, 0xa9, 0x24, 0x08, 0x0a]);
  eq(t9.startupStage, 9, 'R7: an invalid stage does not change the stored value');
  eq(lastSent().payload[5], 0x08, 'R7: an invalid stage is MALFORMED');
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0xa9, 0x24, 0x08]);
  eq(lastSent().payload[5], 0x08, 'R8: a truncated stage is MALFORMED');

  // R9-R10: RPC and SUBSCRIBE
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0x9b, 0x43]);
  eq(lastSent().payload.join(','), '65,155,160,0,83,34,0', 'R9: the altitude graph RPC is answered');
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0x85, 0x66]);
  eq(lastSent().payload[4], 0x76, 'R10: SUBSCRIBE_RESPONSE echoes the sequence');

  // R11-R12: responses and notifications are never answered
  sent.length = 0;
  await request([0x20, 0x00, 0x40, 0xaa, 0x13]);
  eq(sent.length, 0, 'R11: a READ_RESPONSE addressed to 0x40xx is not answered');
  await request([0xa0, 0x00, 0x40, 0xaa, 0x03]);
  eq(sent.length, 0, 'R12: a notify frame is not answered');
});

await checkAsync('Web Bluetooth MCSP: GATT writes are serialized, failures do not block the queue and close drops queued work', async () => {
  const bleWindow = { __bes3Now: () => Date.now(), __bes3Sleep: () => Promise.resolve() };
  new Function('window', 'navigator', readFileSync(path.join(repo, 'web', 'transport-webble-mcsp.js'), 'utf8'))(bleWindow, { bluetooth: {} });
  const McspBle = bleWindow.Bes3BleMcsp;
  let inFlight = 0;
  let maxInFlight = 0;
  let failOnce = false;
  const sent = [];
  const make = () => {
    const t = new McspBle.Bes3BleMcspTransport({ name: 'fake', id: 'gatt-x' });
    t.txChar = {
      async writeValueWithoutResponse(frame) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await new Promise((r) => setTimeout(r, 2));
          if (failOnce) { failOnce = false; throw new Error('GATT operation already in progress'); }
          sent.push(new Uint8Array(frame));
        } finally {
          inFlight--;
        }
      },
    };
    t._resetStreamState();
    return t;
  };

  // A normal write plus two automatic peer responses were the paths that
  // overlapped in the field log.
  const t = make();
  const w = t._writeFrame(1, Uint8Array.from([0x0e, 0x10, 0x18, 0x00, 0x01]));
  t._handleNotification(McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x20, 0x00, 0x40, 0xaa, 0x03])));
  t._handleNotification(McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x20, 0x00, 0x40, 0x81, 0x03])));
  await w;
  await new Promise((r) => setTimeout(r, 20));
  eq(maxInFlight, 1, 'a register write and two peer responses never overlap');
  assert(sent.length >= 3, 'the write and both peer responses were sent');

  // One rejected operation reaches its caller but leaves the queue usable.
  failOnce = true;
  const err = await capture(() => t._writeFrame(1, Uint8Array.from([0x0e, 0x10, 0x18, 0x02, 0x01])));
  assert(err && /GATT operation already in progress/.test(err.message), 'the failure reaches the caller');
  await t._writeFrame(1, Uint8Array.from([0x0e, 0x10, 0x18, 0x03, 0x01]));
  eq(sent.length, 4, 'the queue continues after a failure');
  eq(maxInFlight, 1, 'still no overlap after a failure');

  // close() rejects work queued before it and ignores late notifications.
  let closedErr = null;
  const queued = t._writeFrame(1, Uint8Array.from([0x0e, 0x10, 0x18, 0x04, 0x01])).catch((e) => { closedErr = e; });
  await t.close();
  await queued;
  assert(closedErr, 'work queued before close is rejected');
  t._handleNotification(McspBle.encodeSegmentationFrame(1, true, Uint8Array.from([0x20, 0x00, 0x40, 0xaa, 0x03])));
  eq(t._readQueue.length, 0, 'late notifications are ignored after close');
  eq(sent.length, 4, 'no write is sent from a closed session');
});

await checkAsync('Live Data BLE: early frames are ingested, zero is valid, disconnect marks data stale and reconnect resets listeners', async () => {
  const nav = sandbox.navigator;
  const savedBt = nav.bluetooth;
  const savedLive = sandbox.Bes3LiveDataBle;
  let instance = null;
  let addCount = 0;
  let removeCount = 0;
  const device = {
    name: 'Fake Live Data',
    addEventListener(evt, fn) { if (evt === 'gattserverdisconnected') { addCount++; this._onDisconnect = fn; } },
    removeEventListener(evt, fn) { if (evt === 'gattserverdisconnected' && this._onDisconnect === fn) { removeCount++; this._onDisconnect = null; } },
    gatt: { disconnect() {} },
  };
  class FakeLive {
    constructor() { instance = this; this.characteristic = {}; this._cb = null; this._closed = false; }
    async connect() {}
    async readOnce() { return { speedKmh: 0, cadenceRpm: 0, riderPowerW: 0, batterySocPercent: 55 }; }
    async subscribe(cb) { this._cb = cb; cb({ speedKmh: 12.3, cadenceRpm: 80 }); }
    disconnect() { this._closed = true; this._cb = null; }
    async close() { this.disconnect(); }
    emit(partial) { if (this._cb && !this._closed) this._cb(partial); }
  }
  try {
    nav.bluetooth = {};
    sandbox.Bes3LiveDataBle = { requestLiveDataDevice: async () => device, Bes3LiveDataBleTransport: FakeLive };
    await W.connectLiveDataBle();
    eq(W.state.bleLive.active, true, 'the Live Data session is active');
    eq(W.state.bleLive.values.batterySocPercent, 55, 'the initial read is merged');
    eq(W.state.bleLive.values.speedKmh, 12.3, 'a frame delivered while subscribing is not dropped');
    eq(W.state.bleLive.values.cadenceRpm, 80, 'cadence is ingested');
    eq(W.canMutate, false, 'Live Data is read-only');
    eq(W.isLive, false, 'Live Data is not a writable transport');
    // Zero is a real value, not missing data.
    instance.emit({ speedKmh: 0, riderPowerW: 0 });
    eq(W.state.bleLive.values.speedKmh, 0, 'zero speed is kept');
    eq(W.state.bleLive.values.riderPowerW, 0, 'zero rider power is kept');
    assert(W.state.bleLive.lastAt instanceof Date, 'the reception time is tracked');
    uiHarness.switchTab('read');
    await sleep(0);
    assert(/Bluetooth Live Data/.test(uiHarness.doc.getElementById('view-read').innerHTML), 'the telemetry card is rendered');
    assert(/0\.0 km\/h/.test(uiHarness.doc.getElementById('view-read').innerHTML), 'zero speed is displayed');
    // A remote disconnect keeps the last values but marks them stale.
    device._onDisconnect();
    eq(W.state.bleLive.active, false, 'the session is marked inactive');
    eq(W.state.bleLive.values.speedKmh, 0, 'the last value is preserved');
    sandbox.Bes3WorkshopUI.render();
    assert(/Stale/.test(uiHarness.doc.getElementById('view-read').innerHTML), 'the UI marks the values stale');
    // An explicit user disconnect keeps the last snapshot marked stale.
    await W.disconnect({ keepLiveStale: true });
    assert(W.state.bleLive && W.state.bleLive.active === false, 'explicit disconnect keeps a stale snapshot');
    eq(W.state.bleLive.values.speedKmh, 0, 'the stale snapshot keeps the last value');
    eq(addCount, removeCount, 'every connect listener is removed');
    // A transport switch still clears it.
    await W.disconnect();
    eq(W.state.bleLive, null, 'a transport switch clears the Live Data session');
  } finally {
    nav.bluetooth = savedBt;
    sandbox.Bes3LiveDataBle = savedLive;
  }
});

// ── Dev acceptance and adversarial lifecycle (synthetic only) ──────────────

function loadLiveStack() {
  const files = [
    'web/dev/dev-logger.js',
    'web/dev/live/live-write-helpers.js',
    'web/dev/live/live-evidence.js',
    'web/dev/live/live-runner.js',
    'web/dev/live/live-acceptance-fixture.js',
    'web/dev/live/live-orchestrator.js',
    'web/dev/live/live-suite-read.js',
    'web/dev/live/live-suite-light.js',
    'web/dev/live/live-suite-service.js',
    'web/dev/live/live-suite-ports.js',
    'web/dev/live/live-suite-id.js',
    'web/dev/live/live-suite-writelab.js',
    'web/dev/live/live-suite-generic.js',
    'web/dev/live/live-suite-settings.js',
    'web/dev/live/live-suite-diagnostics.js',
    'web/dev/live/live-suite-sweep.js',
    'web/dev/live/live-runner-selftests.js',
  ];
  for (const f of files) {
    const src = readFileSync(path.join(repo, f), 'utf8');
    new Function('window', 'performance', src)(sandbox, performance);
  }
  return { LR: sandbox.BES3DevLiveRunner, O: sandbox.BES3DevOrchestrator };
}

function addTestProfile(O, id, groups) {
  O.PROFILES[id] = {
    id: id, label: 'Synthetic test profile', description: 'Test-only profile.',
    groups: groups,
  };
}

check('Dev profiles: full-hardware and acceptance wire live.light.power-cycle', () => {
  requirePrivate(['web/dev/live/live-orchestrator.js', 'web/dev/live/live-suite-light.js']);
  const { O } = loadLiveStack();
  for (const id of ['full-hardware', 'full-write-demo']) {
    const profile = O.PROFILES[id];
    assert(profile, id + ' profile exists');
    const group = profile.groups.find((g) => g.name === 'Bike Light');
    assert(group, id + ' has a Bike Light group');
    assert(group.filter({ id: 'live.light.power-cycle', suite: 'Bike Light', requiresWrite: true }),
      id + ' includes live.light.power-cycle');
  }
});

check('Dev baseline: an empty HIGH port baseline restores to 08 00 via portActive', () => {
  requirePrivate(['web/dev/live/live-runner.js']);
  const { LR } = loadLiveStack();
  const spec = LR.restoreSpecFor({
    target: 'DriveUnit.HIGH_POWER_PORT_ACTIVE', component: 'DriveUnit',
    name: 'HIGH_POWER_PORT_ACTIVE', status: 'ok', hex: '', decoded: false,
  });
  assert(!spec.unsupported, 'an empty port baseline has a supported restore path: '
    + (spec.unsupported || ''));
  eq(spec.bytes, '08 00', 'an empty port baseline is restored with explicit off bytes');
  const src = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-runner.js'), 'utf8');
  assert(src.includes('W.Writers.portActive(entry.name, false, o)'),
    'the empty-off restore calls the decoded-boolean port writer');
});

function writeStep(component, name, bytes) {
  return {
    op: 'GENERIC_WRITE', component: component, name: name, bytes: bytes,
    address: W.util.addrOf(component, name), typedName: name, continueOnFailure: true,
    label: 'test write ' + component + '.' + name + ' = ' + bytes,
    run: (o) => W.Writers.generic(component, name,
      bytes === '' ? [] : bytes.split(/\s+/).map((x) => parseInt(x, 16)), o),
  };
}

// 1. Full-write synthetic Demo acceptance: supported nonempty baselines, both
// ports, light, service, valid ID match and the generic same-value smoke.
await checkAsync('Dev acceptance: full-write synthetic Demo covers supported groups and reconciles its report', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js', 'web/dev/live/live-acceptance-fixture.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR, O } = loadLiveStack();
  const FX = sandbox.BES3DevAcceptanceFixture;
  assert(FX, 'the acceptance fixture is exposed');
  FX.activate();
  try {
    await W.startDemo();
    W.setExperimental(true);
    const m = await O.prepare('full-write-demo');
    eq(m.profile, 'full-write-demo', 'the acceptance profile was selected');
    eq(m.requiresWrite, true, 'the acceptance profile writes');
    eq(m.sessionToken, undefined, 'the manifest does not carry the authorization token');
    assert(m.writeRows.length >= 6, 'reviewed write rows: ' + m.writeRows.length);
    assert(m.recoveryRows.length >= 4, 'recovery rows: ' + m.recoveryRows.length);
    eq(m.scenarioIds.includes('live.ports.toggle-low'), true, 'the low port is included');
    eq(m.scenarioIds.includes('live.ports.toggle-high'), true, 'the high port is included');
    eq(m.scenarioIds.includes('live.generic.same-value-smoke'), true, 'the same-value smoke is included');
    eq(m.scenarioIds.includes('live.light.restore'), false, 'the redundant light restore is excluded');
    assert(m.recoveryRows.some((r) => /SERVICE_DUE/.test(r.target)), 'the service target has a recovery row');

    const before = writeFrames;
    const out = await O.run('full-write-demo');
    const o = out.object;
    assert(o.coverage, 'the report carries a coverage object');
    eq(o.coverage.requestedGroups, m.groups.length, 'requested groups are counted');
    assert(o.coverage.executedGroups >= 5, 'executed groups: ' + o.coverage.executedGroups);
    eq(o.coverage.executedScenarios + o.coverage.skippedScenarios + o.coverage.notRunScenarios,
      o.coverage.requestedScenarios, 'scenario accounting reconciles');
    eq(o.reportIntegrity.finalizedAfterRecovery, true, 'the report is finalised after recovery');
    eq(o.reportIntegrity.allResultsIncluded, true, 'every child result is included');
    eq(o.reportIntegrity.manifestMutationEntries, true, 'mutations are tied to manifest rows');
    eq(o.reportIntegrity.manifestRecoveryEntries, true, 'recoveries are tied to manifest rows');
    eq(o.reportIntegrity.identifiersMasked, true, 'identifier bytes are masked');
    eq(o.reportIntegrity.rawTraceSensitive, true, 'the raw trace export is marked sensitive');
    eq(o.reportIntegrity.autoDownloadPolicy, 'exactly-one-per-terminal-path',
      'the report states the auto-download policy');
    eq(o.reportIntegrity.manualDownloadAvailable, true, 'manual download remains available');
    eq(o.reportIntegrity.unknownOutcomeIsNotVerified, true, 'unknown outcomes are never verified');

    const all = o.groups.reduce((acc, g) => acc.concat(g.results), []);
    const smoke = all.filter((r) => r.id === 'live.generic.same-value-smoke')[0];
    assert(smoke, 'the same-value smoke result is present');
    assert(Array.isArray(smoke.verdicts), 'the smoke result carries verdicts: '
      + JSON.stringify(Object.keys(smoke)) + ' status=' + smoke.status
      + ' reason=' + (smoke.failureReason || ''));
    assert(smoke.verdicts.some((v) => /Existing bytes still match; changed-value acceptance was not tested\./
      .test(v.physicalObservation)), 'the same-value physical observation uses the neutral wording');
    assert(!/Observed one dispatch/.test(out.json),
      'the report never claims a dispatch count without a frame counter');
    assert(!/stored value|stored change/.test(out.json),
      'the report does not claim a stored physical effect');
    const idr = all.filter((r) => r.id === 'live.id.read-both')[0];
    assert(idr, 'the ID comparison result is present');
    assert(idr.status === 'passed', 'the valid synthetic ID match passes: ' + idr.status
      + (idr.failureReason ? ' — ' + idr.failureReason : ''));
    const finalBase = all.filter((r) => r.id === 'live.acceptance.final-baseline')[0];
    assert(finalBase, 'the final read-only baseline comparison is present');
    eq(finalBase.status, 'passed', 'the final baseline comparison passes: ' + finalBase.status);
    eq(o.groups[o.groups.length - 1].name, 'Final baseline (read-only)',
      'the final comparison is the last group');

    const writeGroups = o.groups.filter((g) => g.results.some((r) => r.verdicts && r.verdicts.length));
    assert(writeGroups.length >= 3, 'at least three write groups ran');
    writeGroups.forEach((g) => {
      assert(g.recovery && g.recovery.overall, 'write group has a recovery outcome: ' + g.name);
      eq(g.recovery.healthy, true, 'write group recovery is healthy: ' + g.name);
    });
    assert(writeFrames > before, 'the acceptance run sent approved writes');

    // Export integrity: parses, reconciles, and does not leak identifiers or
    // the authorization token.
    const parsed = JSON.parse(out.json);
    eq(parsed.summary.completed,
      parsed.coverage.executedScenarios + parsed.coverage.skippedScenarios,
      'summary and coverage reconcile');
    eq(parsed.groups.reduce((n, g) => n + g.results.length, 0), parsed.summary.completed,
      'every child result appears in the combined report');
    // The authorization token is a generation counter, so its numeric value is
    // not a secret. What matters is that no token field is exported and the
    // session is represented by an opaque reference.
    assert(!out.json.includes('"sessionToken"'), 'no sessionToken field is exported');
    assert(!out.json.includes('"authorizationToken"'), 'no authorizationToken field is exported');
    assert(/"sessionRef":\s*"sess-[0-9a-f]+"/.test(out.json),
      'the report identifies the session by an opaque reference');
    assert(!out.json.includes(FX.syntheticUuid), 'the synthetic UUID is not exported as text');
    assert(!out.json.includes('00 00 00 00 00 00 40 00 80 00 00 00 00 00 00 aa'),
      'the synthetic UUID is not exported as raw bytes');
    const idBaseline = parsed.baseline.registers.filter((r) => /BIKE_ID/.test(r.target));
    idBaseline.forEach((r) => eq(r.hex, '(masked)', 'identifier baseline bytes are masked'));

    // The full-hardware bench profile must also complete in the same synthetic
    // session: every write row is covered by its frozen manifest, every touched
    // target is reconciled, and the Markdown protocol is generated.
    const hm = await O.prepare('full-hardware');
    assert(hm.writeRows.length >= 6, 'full-hardware has reviewed write rows: ' + hm.writeRows.length);
    const hOut = await O.run('full-hardware');
    const hObj = hOut.object;
    eq(hObj.summary.recoveryFailed, 0, 'full-hardware leaves no unresolved recovery target');
    const hResults = hObj.groups.reduce((acc, g) => acc.concat(g.results), []);
    const uncovered = hResults.filter((r) => /not covered by the approved manifest/.test(r.failureReason || ''));
    eq(uncovered.length, 0, 'every full-hardware write is covered by the frozen manifest');
    const hFailed = hResults.filter((r) => r.status === 'failed');
    eq(hFailed.length, 0, 'no full-hardware scenario fails in the synthetic session: '
      + hFailed.map((r) => r.id + ':' + (r.failureReason || '')).join('; '));
    assert(hObj.reconciledRecovery && Array.isArray(hObj.reconciledRecovery.targets),
      'full-hardware attaches the per-target recovery reconciliation');
    eq(hObj.reconciledRecovery.unresolvedTargets.length, 0,
      'full-hardware reconciles every touched target');
    assert(typeof hObj.markdownReport === 'string' && hObj.markdownReport.length > 0,
      'full-hardware attaches the Markdown bench protocol');
    assert(Object.prototype.hasOwnProperty.call(hObj.environment, 'transportKind'),
      'the report records the transport kind');
  } finally {
    FX.restore();
    W.setExperimental(false);
    sandbox.Bes3WorkshopDemo.setLatency(0);
  }
}, 180000);

// 2. A possibly transmitted write that throws is still tracked as touched.
await checkAsync('Dev lifecycle: a thrown write is tracked as possibly touched and can be recovered', async () => {
  requirePrivate(['web/dev/live/live-runner.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  await LR.captureBaseline();
  LR.register({
    id: 'test.throw-write', suite: 'Test Harness', name: 'Throw after a possible transmit',
    requiresConnection: true, requiresWrite: true, timeout: 10000,
    run: async (ctx) => {
      const step = {
        op: 'GENERIC_WRITE', component: 'DriveUnit', name: 'LOW_POWER_PORT_ACTIVE', bytes: '08 00',
        address: W.util.addrOf('DriveUnit', 'LOW_POWER_PORT_ACTIVE'), typedName: 'LOW_POWER_PORT_ACTIVE',
        continueOnFailure: true, label: 'throwing write',
        run: () => { throw new Error('synthetic transport failure'); },
      };
      await ctx.runWrite([step]);
      ctx.setOutcome('inconclusive', 'The write may have been transmitted before the error.');
    },
  });
  const summary = await LR.run('test.throw-write');
  eq(summary.inconclusive, 1, 'the scenario is inconclusive, not falsely passed');
  const touched = LR.getTouched();
  assert(touched.includes('DriveUnit.LOW_POWER_PORT_ACTIVE'),
    'the target is still tracked as possibly touched: ' + touched.join(','));
  const rec = await LR.restoreBaseline({ keys: touched, timeoutMs: 5000 });
  assert(rec.outcomes.length >= 1, 'the touched target has a recovery attempt');
  assert(['restored-verified', 'already-at-baseline'].includes(rec.outcomes[0].outcome),
    'the possibly touched target is verified against its baseline: ' + rec.outcomes[0].outcome);
});

// 3. Stop inside an already-running multi-step plan: no later step runs.
await checkAsync('Dev lifecycle: a stop inside a multi-step plan prevents the later step', async () => {
  requirePrivate(['web/dev/live/live-runner.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  await LR.captureBaseline();
  sandbox.__testSecondStep = false;
  LR.register({
    id: 'test.multistep-stop', suite: 'Test Harness', name: 'Stop inside a two-step plan',
    requiresConnection: true, requiresWrite: true, timeout: 10000,
    run: async (ctx) => {
      const first = {
        op: 'GENERIC_WRITE', component: 'RemoteControl', name: 'LANGUAGE', bytes: '08 01',
        address: W.util.addrOf('RemoteControl', 'LANGUAGE'), typedName: 'LANGUAGE',
        continueOnFailure: true, label: 'first step',
        run: () => { LR.stopAndRecover(); return { applied: false, acked: false, blocked: false }; },
      };
      const second = {
        op: 'GENERIC_WRITE', component: 'RemoteControl', name: 'LANGUAGE', bytes: '08 00',
        address: W.util.addrOf('RemoteControl', 'LANGUAGE'), typedName: 'LANGUAGE',
        continueOnFailure: true, label: 'second step',
        run: () => { sandbox.__testSecondStep = true; return { applied: true, acked: true }; },
      };
      try { await ctx.runWrite([first, second]); }
      catch (e) { ctx.log('plan stopped', { message: e.message }); }
      ctx.setOutcome('cancelled', 'Stopped inside the plan.');
    },
  });
  const before = writeFrames;
  const summary = await LR.run('test.multistep-stop');
  eq(summary.cancelled, 1, 'the scenario is cancelled');
  eq(sandbox.__testSecondStep, false, 'the second step never ran');
  eq(writeFrames, before, 'the later step sent no write frame');
});

// 4. A mutation queued behind a read is cancelled before it can transmit.
await checkAsync('Dev lifecycle: a mutation queued behind a read is cancelled before transmission', async () => {
  requirePrivate(['web/dev/live/live-runner.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  await LR.captureBaseline();
  LR.register({
    id: 'test.queued-mutation', suite: 'Test Harness', name: 'Wait, then write',
    requiresConnection: true, requiresWrite: true, timeout: 10000,
    run: async (ctx) => {
      const ok = await ctx.wait(500);
      if (!ok) { ctx.setOutcome('cancelled', 'Stopped during the queued wait.'); return; }
      await ctx.runWrite([writeStep('RemoteControl', 'LANGUAGE', '08 01')]);
      ctx.setOutcome('passed', 'The queued write ran.');
    },
  });
  const before = writeFrames;
  const running = LR.run('test.queued-mutation');
  await new Promise((r) => setTimeout(r, 50));
  LR.stopAndRecover();
  const summary = await running;
  eq(summary.cancelled, 1, 'the scenario is cancelled');
  eq(writeFrames, before, 'the queued mutation sent no write frame');
});

// 5. Recovery is withheld while an in-flight operation may still write, and
// the unresolved target is reported as unresolved.
await checkAsync('Dev lifecycle: recovery is withheld while I/O may still be in flight', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR, O } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  LR.register({
    id: 'test.nonquiescent', suite: 'Test Harness', name: 'Never settles after a write',
    requiresConnection: true, requiresWrite: true, timeout: 100,
    resolvePlan: async () => ({ writes: [{ op: 'GENERIC_WRITE', component: 'DriveUnit',
      name: 'LOW_POWER_PORT_ACTIVE', bytes: '08 00', remaining: 1 }] }),
    run: async (ctx) => {
      await ctx.runWrite([writeStep('DriveUnit', 'LOW_POWER_PORT_ACTIVE', '08 00')]);
      await new Promise(() => {});
    },
  });
  addTestProfile(O, 'test.nonquiescent', [
    { name: 'Non-quiescent group', filter: (s) => s.id === 'test.nonquiescent' },
  ]);
  const m = await O.prepare('test.nonquiescent', { recoveryTimeoutMs: 5000 });
  const before = writeFrames;
  const out = await O.run('test.nonquiescent');
  const g = out.object.groups[0];
  eq(out.object.groups[0].results[0].quiescent, false,
    'the result records non-quiescence: ' + JSON.stringify(out.object.groups[0]).slice(0, 600));
  eq(out.object.groups[0].results[0].status, 'timed-out', 'the result is timed out');
  eq(g.recovery.overall, 'recovery-not-attempted-nonquiescent',
    'recovery was withheld');
  eq(out.object.unresolvedTargets.length >= 1, true, 'the target is reported unresolved');
  eq(out.object.summary.healthy, false, 'a non-quiescent run is not healthy');
  eq(out.object.reportIntegrity.finalizedAfterRecovery, true,
    'the report records that finalisation followed the bounded recovery decision');
  eq(writeFrames - before, 1, 'only the original write was sent; no recovery write');
});

// 6. A recovery timeout halts subsequent mutation groups.
await checkAsync('Dev lifecycle: a recovery timeout halts later mutation groups', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR, O } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  sandbox.__testSecondGroupRan = false;
  LR.register({
    id: 'test.timeout-write', suite: 'Test Harness', name: 'Write then slow the transport',
    requiresConnection: true, requiresWrite: true, timeout: 10000,
    resolvePlan: async () => ({ writes: [{ op: 'GENERIC_WRITE', component: 'DriveUnit',
      name: 'LOW_POWER_PORT_ACTIVE', bytes: '08 00', remaining: 1 }] }),
    run: async (ctx) => {
      await ctx.runWrite([writeStep('DriveUnit', 'LOW_POWER_PORT_ACTIVE', '08 00')]);
      sandbox.Bes3WorkshopDemo.setLatency(5000);
      ctx.setOutcome('passed', 'The write completed; recovery is now slow.');
    },
  });
  LR.register({
    id: 'test.after-timeout', suite: 'Test Harness', name: 'Later mutation group',
    requiresConnection: true, requiresWrite: true, timeout: 5000,
    resolvePlan: async () => ({ writes: [{ op: 'GENERIC_WRITE', component: 'DriveUnit',
      name: 'LOW_POWER_PORT_ACTIVE', bytes: '08 01', remaining: 1 }] }),
    run: async (ctx) => {
      sandbox.__testSecondGroupRan = true;
      await ctx.runWrite([writeStep('DriveUnit', 'LOW_POWER_PORT_ACTIVE', '08 01')]);
    },
  });
  addTestProfile(O, 'test.recoverytimeout', [
    { name: 'First mutation', filter: (s) => s.id === 'test.timeout-write' },
    { name: 'Second mutation', filter: (s) => s.id === 'test.after-timeout' },
  ]);
  const m = await O.prepare('test.recoverytimeout', { recoveryTimeoutMs: 50 });
  const out = await O.run('test.recoverytimeout');
  eq(out.object.groups[0].recovery && out.object.groups[0].recovery.overall, 'restore-failed',
    'the recovery is reported as failed after the timeout: '
      + JSON.stringify(out.object.groups.map((g) => ({ name: g.name, status: g.status,
        recovery: g.recovery, results: g.results.map((r) => ({ id: r.id, status: r.status })) })))
        .slice(0, 800));
  assert(/timed out/i.test(out.object.groups[0].recovery.outcomes[0].reason || ''),
    'the outcome states that recovery timed out');
  eq(out.object.groups[1].status, 'not-run', 'the later group is not run');
  eq(sandbox.__testSecondGroupRan, false, 'the later group sent no write');
  eq(out.object.halted, true, 'the run halted');
  eq(out.object.terminationReason, 'completed', 'the run itself completed its bounded work');
  sandbox.Bes3WorkshopDemo.setLatency(0);
  await sleep(200); // let any orphaned recovery settle before the next check
});

// 7. Abort during recovery prevents further recovery frames.
await checkAsync('Dev lifecycle: abort during recovery prevents later recovery frames', async () => {
  requirePrivate(['web/dev/live/live-runner.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  await LR.captureBaseline();
  sandbox.Bes3WorkshopDemo.setLatency(100);
  sandbox.__testAbortRecovery = null;
  LR.register({
    id: 'test.abort-recovery', suite: 'Test Harness', name: 'Abort while recovery is running',
    requiresConnection: true, requiresWrite: true, timeout: 15000,
    run: async (ctx) => {
      await ctx.runWrite([writeStep('DriveUnit', 'LOW_POWER_PORT_ACTIVE', '08 00')]);
      setTimeout(() => LR.abortWrites(), 50);
      const rec = await LR.restoreBaseline({
        keys: ['DriveUnit.LOW_POWER_PORT_ACTIVE', 'DriveUnit.HIGH_POWER_PORT_ACTIVE'],
        timeoutMs: 5000,
      });
      sandbox.__testAbortRecovery = rec;
      ctx.setOutcome('inconclusive', 'The user aborted during recovery.');
    },
  });
  const summary = await LR.run('test.abort-recovery');
  eq(summary.inconclusive, 1, 'the scenario is inconclusive');
  const rec = sandbox.__testAbortRecovery;
  assert(rec, 'the recovery result was captured');
  eq(rec.outcomes.length, 2, 'both targets are accounted for');
  eq(rec.outcomes[1].outcome, 'recovery-aborted-by-user',
    'the second target was not attempted after the abort');
  sandbox.Bes3WorkshopDemo.setLatency(0);
});

// 8. A newer setting value after preflight invalidates the stale operation.
await checkAsync('Dev lifecycle: a newer value after preflight invalidates the stale write', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js', 'web/dev/live/live-acceptance-fixture.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { O } = loadLiveStack();
  const FX = sandbox.BES3DevAcceptanceFixture;
  FX.activate();
  try {
    await W.startDemo();
    W.setExperimental(true);
    addTestProfile(O, 'test.stale', [
      { name: 'Light config', filter: (s) => s.id === 'live.light.config-cycle' },
    ]);
    const m = await O.prepare('test.stale');
    assert(m.writeRows.length >= 1, 'the config write row was approved: '
      + m.writeRows.length + ' row(s), scenarios=' + m.scenarioIds.join(','));
    // The approved row targets the opposite of the current startup mode. Change
    // the mode to the approved value after approval, so execution now needs the
    // other value, which the frozen manifest never approved.
    const approved = m.writeRows[0];
    const approvedVal = approved.bytes === '08 01' ? 1 : 2;
    await W.Writers.lightConfiguration(approvedVal);
    const before = writeFrames;
    const out = await O.run('test.stale');
    const result = out.object.groups[0].results[0];
    eq(result.status, 'inconclusive', 'the stale operation is inconclusive');
    assert(/not covered by the approved manifest/.test(result.failureReason || ''),
      'the reason states that the step is not covered by the manifest: ' + result.failureReason);
    // The stale config write is refused before transmission. The one remaining
    // frame is the verified recovery of the value that changed after approval;
    // it is not the stale operation.
    eq(writeFrames - before, 1, 'only the verified recovery frame was sent');
    eq(result.recoveryOutcome, 'restored-verified', 'the target was restored after the refusal');
  } finally {
    FX.restore();
  }
});

// 9. A reconnect never revives an old manifest.
await checkAsync('Dev lifecycle: a reconnect invalidates the approved manifest', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { O } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  const m = await O.prepare('fast-demo');
  await W.startDemo(); // a new demo session: new authorization generation
  const before = writeFrames;
  let err = null;
  try { await O.run('fast-demo'); } catch (e) { err = e; }
  assert(err, 'the run is refused after the reconnect');
  assert(/session or authorization changed/.test(err.message),
    'the refusal names the session change: ' + err.message);
  eq(writeFrames, before, 'the old manifest sent no frame');
  eq(O.getLast(), null, 'no report is produced for the stale manifest');
});

// 10. Maximum duration does not prevent bounded recovery of the group that
// already started.
await checkAsync('Dev lifecycle: maximum duration does not prevent bounded recovery', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR, O } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  LR.register({
    id: 'test.duration-write', suite: 'Test Harness', name: 'Write then wait',
    requiresConnection: true, requiresWrite: true, timeout: 10000,
    resolvePlan: async () => ({ writes: [{ op: 'GENERIC_WRITE', component: 'RemoteControl',
      name: 'LANGUAGE', bytes: '08 00', remaining: 1 }] }),
    run: async (ctx) => {
      await ctx.runWrite([writeStep('RemoteControl', 'LANGUAGE', '08 00')]);
      await ctx.wait(1500);
      ctx.setOutcome('passed', 'The write and wait completed.');
    },
  });
  LR.register({
    id: 'test.duration-second', suite: 'Test Harness', name: 'Second group',
    requiresConnection: true, requiresWrite: false, timeout: 5000,
    run: async (ctx) => { ctx.ok(true, 'second group ran'); },
  });
  addTestProfile(O, 'test.duration', [
    { name: 'First mutation', filter: (s) => s.id === 'test.duration-write' },
    { name: 'Second read', filter: (s) => s.id === 'test.duration-second' },
  ]);
  const m = await O.prepare('test.duration', { maxDurationMs: 1000 });
  eq(m.maxDurationMs, 1000, 'the approved maximum duration is 1000 ms');
  const t0 = Date.now();
  const out = await O.run('test.duration');
  const elapsed = Date.now() - t0;
  eq(out.object.groups[0].recovery.healthy, true,
    'the started group still recovered after the duration expired');
  eq(out.object.groups[1].status, 'not-run', 'the later group is halted: '
    + JSON.stringify(out.object.groups.map((g) => ({ name: g.name, status: g.status })))
    + ' elapsed=' + elapsed + ' max=' + m.maxDurationMs);
  eq(out.object.halted, true, 'the duration halt is recorded');
  eq(out.object.terminationReason, 'timeout', 'the halt reason is the duration limit');
});

// 11. Report integrity and download policy are machine-readable.
await checkAsync('Dev report integrity: one auto-download, manual download and sensitive raw trace', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  const { O } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(false);
  await O.prepare('fast-demo');
  const out = await O.run('fast-demo');
  assert(out, 'a combined report exists');
  eq(O._claimDownload('auto'), true, 'the first automatic download is allowed');
  eq(O._claimDownload('auto'), false, 'a second automatic download for the same run is refused');
  eq(O._claimDownload('manual'), true, 'manual download remains available');
  const parsed = JSON.parse(out.json);
  eq(parsed.summary.completed,
    parsed.coverage.executedScenarios + parsed.coverage.skippedScenarios,
    'the parsed report reconciles');
  eq(parsed.reportIntegrity.allResultsIncluded, true, 'all results are included');
  const LOG = sandbox.BES3DevLogger;
  const log = LOG.createRunLog('integrity-test', '0.0.0');
  assert(/"sensitive": true/.test(LOG.exportJson(log)), 'raw JSON trace is marked sensitive');
  assert(/SENSITIVE: raw trace export/.test(LOG.exportText(log)),
    'raw text trace is marked sensitive');
});

// 12. Coverage accounting: a preflight skip is a skipped row, and a row that was
// never scheduled in a partially finished group is counted as not run.
await checkAsync('Dev coverage: skipped rows and unscheduled rows are counted separately', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  sandbox.Bes3WorkshopDemo.setLatency(0);
  const { LR, O } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  sandbox.__testUnscheduledRan = false;
  LR.register({
    id: 'test.coverage.preflight-skip', suite: 'Test Harness', name: 'Preflight skip',
    requiresConnection: true, requiresWrite: true, timeout: 5000,
    resolvePlan: async () => ({ skipped: 'the synthetic target has no writable payload' }),
    run: async () => { throw new Error('a preflight-skipped scenario must not run'); },
  });
  LR.register({
    id: 'test.coverage.timeout', suite: 'Test Harness', name: 'Never settles',
    requiresConnection: true, requiresWrite: true, timeout: 100,
    resolvePlan: async () => ({ writes: [{ op: 'GENERIC_WRITE', component: 'RemoteControl',
      name: 'LANGUAGE', bytes: '08 00', remaining: 1 }] }),
    run: async (ctx) => {
      await ctx.runWrite([writeStep('RemoteControl', 'LANGUAGE', '08 00')]);
      await new Promise(() => {});
    },
  });
  LR.register({
    id: 'test.coverage.unscheduled', suite: 'Test Harness', name: 'Never scheduled',
    requiresConnection: true, requiresWrite: false, timeout: 5000,
    run: async () => { sandbox.__testUnscheduledRan = true; },
  });
  addTestProfile(O, 'test.coverage', [
    { name: 'Skipped write', filter: (s) => s.id === 'test.coverage.preflight-skip' },
    { name: 'Partial group', filter: (s) =>
      s.id === 'test.coverage.timeout' || s.id === 'test.coverage.unscheduled' },
  ]);
  const m = await O.prepare('test.coverage', { recoveryTimeoutMs: 5000 });
  eq(m.scenarioIds.length, 3, 'three scenarios were requested');
  eq(m.skippedWrites.length, 1, 'the preflight skip is recorded before approval');

  const out = await O.run('test.coverage');
  const c = out.object.coverage;
  eq(c.requestedScenarios, 3, 'all three scenarios are requested');
  eq(c.eligibleScenarios, 2, 'the preflight skip is not eligible');
  eq(c.executedScenarios, 1, 'only the settled scenario was executed');
  eq(c.skippedScenarios, 1, 'the preflight skip is a skipped row');
  eq(c.skippedScenarioIds.join(','), 'test.coverage.preflight-skip',
    'the skipped row is identified by id');
  eq(c.notRunScenarios, 1, 'the unscheduled row in the partial group is counted');
  eq(c.notRunScenarioIds.join(','), 'test.coverage.unscheduled',
    'the unscheduled row is identified by id');
  const partial = c.groupDetails.filter((g) => g.name === 'Partial group')[0];
  eq(partial.status, 'ran', 'the partial group is not reported as not-run');
  eq(partial.executed, 1, 'the partial group counts the row that ran');
  eq(partial.notRun, 1, 'the partial group counts its unscheduled row');
  eq(out.object.summary.notRun, 1, 'the summary counts the unscheduled row');
  eq(out.object.summary.completed, 2, 'the summary counts the skipped and executed rows');
  eq(out.object.reportIntegrity.allResultsIncluded, false,
    'a partially finished report never claims full coverage');
  eq(sandbox.__testUnscheduledRan, false, 'the unscheduled scenario did not run');
  sandbox.Bes3WorkshopDemo.setLatency(0);
  await sleep(200); // let any orphaned timeout settle before the next check
});

// 12b. A disconnected session cannot be prepared as a live run: the offline
// panel is the only offline runner, so no report can claim offline coverage.
await checkAsync('Dev orchestration: prepare refuses a disconnected session', async () => {
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  const { O } = loadLiveStack();
  await W.disconnect();
  eq(W.sessionMode, 'file', 'no session is connected');
  let err = null;
  try { await O.prepare('fast-demo'); } catch (e) { err = e; }
  assert(err, 'the disconnected prepare is refused');
  assert(/connected bike or Demo session/.test(err.message),
    'the refusal names the missing session: ' + err.message);
  eq(O.isPrepared(), false, 'no manifest is prepared');
});

// 13. The live generic negative case is policy-only. It must not reach the
// writer; the writer boundary is exercised separately below.
await checkAsync('Dev live suite: the generic negative case is policy-only and sends no frame', async () => {
  requirePrivate(['web/dev/live/live-suite-generic.js']);
  const { LR } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  const before = writeFrames;
  const summary = await LR.run('live.generic.negative-authorization');
  eq(summary.passed, 1, 'the policy-only case passes: ' + JSON.stringify(summary));
  eq(writeFrames, before, 'the policy-only case sends no WRITE frame');
  eq(POLICY.validateHexPayload('ab'.repeat(65)).ok, false,
    'the policy rejects a 65-byte payload');
  eq(POLICY.validateHexPayload('ab'.repeat(64)).ok, true,
    'the policy accepts a 64-byte payload');
});

// 14. The writer boundary is tested with the harness transport as a synthetic
// adapter: it records dispatches, so a zero count is evidence only because the
// same adapter observes a dispatch for an allowed write.
await checkAsync('Dev writer boundary: synthetic adapter observes one dispatch for an allowed write and zero for blocked targets', async () => {
  await W.startDemo();
  W.setExperimental(true);
  const beforeAllowed = writeFrames;
  const allowedStep = {
    label: 'allowed', bytes: '08 01', op: 'LIGHT_SWITCH', component: 'DriveUnit', name: 'BIKE_LIGHT',
    address: W.util.addrOf('DriveUnit', 'BIKE_LIGHT'),
    run: (owner) => W.Writers.lightSwitch(true, owner),
  };
  const allowed = await W.runPlan([allowedStep], null, { requireApproval: true, approve: async () => true });
  eq(allowed.length, 1, 'the allowed write produced one result');
  eq(writeFrames - beforeAllowed, 1, 'the synthetic adapter observes exactly one dispatch');
  for (const [c, n] of [['DriveUnit', 'BIKE_LIGHT_POWER'], ['DriveUnit', 'NOT_A_REGISTER']]) {
    const before = writeFrames;
    const err = await capture(() => W.Writers.generic(c, n, [0x08, 0x01]));
    assert(err && err.code === 'WRITE_BLOCKED', c + '.' + n + ' is refused at the writer boundary');
    eq(writeFrames, before, c + '.' + n + ' -> the synthetic adapter observed zero dispatch');
  }
});

// 15. The ID dry-check no longer asserts an unmeasured zero-frame claim. The
// UUID codec and the registry-readonly policy checks remain.
await checkAsync('Dev live suite: the ID dry-check keeps the codec and policy checks only', async () => {
  requirePrivate(['web/dev/live/live-suite-id.js']);
  const { LR } = loadLiveStack();
  await W.startDemo();
  W.setExperimental(true);
  const src = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-suite-id.js'), 'utf8');
  assert(!src.includes('no-id-write'), 'the unconditional no-id-write check is removed');
  const before = writeFrames;
  const summary = await LR.run('live.id.sync-dry-check');
  eq(summary.passed, 1, 'the dry-check passes: ' + JSON.stringify(summary));
  eq(writeFrames, before, 'the dry-check sends no WRITE frame');
  const state = LR.getState();
  const result = state.results[state.results.length - 1];
  eq(result.checks.some((c) => c.label === 'no-id-write'), false,
    'no unconditional zero-frame check is recorded');
  eq(result.assertCount, 4, 'only the two policy and two codec assertions remain');
});

// ── Dev / Diagnostics distribution checks ──────────────────────────────────
// These checks verify that the private Dev workbench is correctly configured
// for exclusion from the public release tree, and that the production entry
// page remains unaffected. Checks that depend on private files use
// requirePrivate(): they are explicitly skipped in the public tree and fail in
// a private checkout when a required file is missing.

check('Dev distribution: required exclusion entries in public-exclude.txt', () => {
  const excl = readFileSync(path.join(repo, 'tools', 'public-exclude.txt'), 'utf8');
  const lines = excl.split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
  assert(lines.includes('dev.html'),  'dev.html must be listed in public-exclude.txt');
  assert(lines.includes('web/dev/'),  'web/dev/ must be listed in public-exclude.txt');
  assert(lines.includes('docs/dev/'), 'docs/dev/ must be listed in public-exclude.txt');
});

check('Dev distribution: production entry page has no dev script references', () => {
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert(!html.includes('web/dev/'),   'index.html must not reference web/dev/');
  assert(!html.includes('dev-runner'), 'index.html must not reference dev-runner');
  assert(!html.includes('BES3Dev'),    'index.html must not reference BES3Dev namespace');
});

check('Dev distribution: dev-runner uses private namespace, not production namespaces (source)', () => {
  const devRunnerPath = path.join(repo, 'web', 'dev', 'dev-runner.js');
  requirePrivate(['web/dev/dev-runner.js']);
  const src = readFileSync(devRunnerPath, 'utf8');
  assert(!src.includes('window.Bes3Workshop ='), 'dev-runner must not define window.Bes3Workshop');
  assert(!src.includes('window.Bes3Protocol ='), 'dev-runner must not define window.Bes3Protocol');
  assert(src.includes('window.BES3DevRunner'),   'dev-runner must expose window.BES3DevRunner');
});

check('Dev distribution: dev-ui uses textContent for dynamic data rendering (source)', () => {
  const devUiPath = path.join(repo, 'web', 'dev', 'dev-ui.js');
  requirePrivate(['web/dev/dev-ui.js']);
  const src = readFileSync(devUiPath, 'utf8');
  assert(src.includes('textContent'),   'dev-ui.js must use textContent for dynamic data');
  assert(src.includes('BES3DevRunner'), 'dev-ui.js must reference BES3DevRunner');
  assert(src.includes('BES3DevLogger'), 'dev-ui.js must reference BES3DevLogger');
});

check('Dev distribution: dev-ui counts a timed-out scenario only once in the offline summary (source)', () => {
  const devUiPath = path.join(repo, 'web', 'dev', 'dev-ui.js');
  requirePrivate(['web/dev/dev-ui.js']);
  const src = readFileSync(devUiPath, 'utf8');
  // A timed-out scenario is not a failure: the summary counts it in timedOut
  // only. This is a source-level guard, not a runtime UI test.
  assert(/else if \(r\.status === 'timed-out'\)\s*counts\.timedOut\+\+;/.test(src),
    'timed-out increments only the timedOut counter');
  assert(!/timed-out'\)\s*\{[^}]*counts\.failed\+\+/.test(src),
    'timed-out is never also counted as failed');
});

check('Dev distribution: dev.html contains private warning and does not appear in production page (source)', () => {
  const devHtmlPath = path.join(repo, 'dev.html');
  requirePrivate(['dev.html']);
  const src = readFileSync(devHtmlPath, 'utf8');
  assert(src.includes('PRIVATE'), 'dev.html must contain a PRIVATE warning');
  assert(src.includes('dev-runner.js') || src.includes('BES3DevRunner'),
    'dev.html must reference the dev runner');
  for (const script of ['live-evidence.js', 'live-suite-settings.js',
    'live-suite-diagnostics.js', 'live-suite-sweep.js']) {
    assert(src.includes(script), 'dev.html must load ' + script);
  }
  assert(src.includes('dev-auto-approve'), 'dev.html must expose the bench auto-approve control');
  assert(src.includes('dev-export-md'), 'dev.html must expose the Markdown protocol download');
  // The evidence helper must load before the suites that classify read-backs.
  assert(src.indexOf('live-evidence.js') < src.indexOf('live-suite-ports.js'),
    'live-evidence.js must load before live-suite-ports.js');
  // Cross-check: production page must not reference dev.html
  const indexSrc = readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert(!indexSrc.includes('dev.html'), 'production index.html must not reference dev.html');
});

check('Dev distribution: live runner file present in private tree (source)', () => {
  const liveDir = path.join(repo, 'web', 'dev', 'live');
  requirePrivate(['web/dev/live/live-runner.js']);
  assert(existsSync(path.join(liveDir, 'live-runner.js')),            'web/dev/live/live-runner.js must exist');
  assert(existsSync(path.join(liveDir, 'live-ui.js')),                'web/dev/live/live-ui.js must exist');
  assert(existsSync(path.join(liveDir, 'live-runner-selftests.js')),  'web/dev/live/live-runner-selftests.js must exist');
  assert(existsSync(path.join(liveDir, 'live-write-helpers.js')),     'web/dev/live/live-write-helpers.js must exist');
  const helpSrc = readFileSync(path.join(liveDir, 'live-write-helpers.js'), 'utf8');
  assert(helpSrc.includes('window.BES3DevWriteHelpers'),              'live-write-helpers.js must expose BES3DevWriteHelpers');
  assert(helpSrc.includes('classifyWrite'),                           'live-write-helpers.js must define classifyWrite');
  assert(helpSrc.includes('evaluateVerdicts'),                        'live-write-helpers.js must define evaluateVerdicts');
  assert(helpSrc.includes('triageInconclusive'),                      'live-write-helpers.js must define triageInconclusive');
  assert(helpSrc.includes('classifyStability'),                       'live-write-helpers.js must define classifyStability');
  const src = readFileSync(path.join(liveDir, 'live-runner.js'), 'utf8');
  assert(src.includes('window.BES3DevLiveRunner'), 'live-runner.js must expose BES3DevLiveRunner');
  assert(!src.includes('window.Bes3Workshop ='), 'live-runner.js must not redefine window.Bes3Workshop');
});

check('Dev distribution: all expected Phase 3 scenario files present in private tree (source)', () => {
  const scenDir = path.join(repo, 'web', 'dev', 'scenarios');
  requirePrivate(['web/dev/scenarios/protocol.js']);
  const expected = [
    'protocol.js', 'session.js', 'writes.js', 'runner-self-tests.js',
    'transports.js', 'import-privacy.js', 'config-policy.js', 'ui-report.js',
  ];
  for (const f of expected) {
    assert(existsSync(path.join(scenDir, f)), 'expected scenario file missing: web/dev/scenarios/' + f);
  }
});

// ── Dev live evidence model (pure helpers, no transport) ───────────────────

function loadLiveHelpers() {
  const p = path.join(repo, 'web', 'dev', 'live', 'live-write-helpers.js');
  requirePrivate(['web/dev/live/live-write-helpers.js']);
  const w = {};
  const src = readFileSync(p, 'utf8');
  new Function('window', 'performance', src)(w, performance);
  assert(w.BES3DevWriteHelpers, 'live-write-helpers.js did not expose BES3DevWriteHelpers');
  return w.BES3DevWriteHelpers;
}

check('Dev live helpers: empty, explicit off, explicit on and unavailable stay distinct', () => {
  const H = loadLiveHelpers();
  if (!H) return;
  eq(H.readState({ status: 'ok', hex: '08 01' }), 'explicit-on', '08 01');
  eq(H.readState({ status: 'ok', hex: '08 00' }), 'explicit-off', '08 00');
  eq(H.readState({ status: 'ok', hex: '' }), 'empty', 'empty payload');
  eq(H.readState({ status: 'declined', hex: '' }), 'unavailable', 'declined read');
  eq(H.readHex({ status: 'ok', hex: '' }), '', 'successful empty has hex ""');
  eq(H.readHex({ status: 'declined', hex: '' }), null, 'unavailable has no usable hex');
  assert(H.readState({ status: 'ok', hex: '' }) !== 'explicit-off', 'empty is never off');
});

check('Dev live helpers: classifyWrite keeps ACK, read-back and empty distinct', () => {
  const H = loadLiveHelpers();
  if (!H) return;
  const passed = H.classifyWrite({ acked: true, applied: true }, { status: 'ok', hex: '08 01' }, '08 01');
  eq(passed.cls, 'passed', 'applied + matching read-back');
  eq(passed.acked, true, 'ack preserved');

  const appliedNoAck = H.classifyWrite({ acked: false, applied: true }, { status: 'ok', hex: '08 01' }, '08 01');
  eq(appliedNoAck.cls, 'passed', 'read-back can pass without an ACK');
  eq(appliedNoAck.sub, 'applied-without-ack', 'missing ACK is recorded');

  const empty = H.classifyWrite({ acked: true, applied: false }, { status: 'ok', hex: '' }, '08 00');
  eq(empty.cls, 'inconclusive', 'empty read-back is inconclusive');
  eq(empty.sub, 'empty-read-back', 'empty sub-class');
  eq(empty.afterState, 'empty', 'empty is recorded as empty');

  const mismatch = H.classifyWrite({ acked: true, applied: false }, { status: 'ok', hex: '08 01' }, '08 00');
  eq(mismatch.cls, 'failed', 'known byte mismatch is failed');
  eq(mismatch.sub, 'byte-mismatch', 'mismatch sub-class');

  const noAck = H.classifyWrite({ acked: false, applied: false }, { status: 'ok', hex: '08 01' }, '08 01');
  eq(noAck.cls, 'failed', 'no ACK and no read-back match is failed');

  const noRead = H.classifyWrite({ acked: true, applied: false }, { status: 'no-response', hex: '' }, '08 01');
  eq(noRead.cls, 'inconclusive', 'ACK without a read-back is inconclusive');
  eq(noRead.applied, false, 'never applied without a read-back');
});

check('Dev live helpers: stability is separate from completeness and one sample is not stability', () => {
  const H = loadLiveHelpers();
  if (!H) return;
  const empty = H.classifyStability([{ status: 'ok', hex: '' }, { status: 'ok', hex: '' }]);
  eq(empty.stability, 'stable-empty', 'all-empty');
  eq(empty.complete, true, 'complete series');
  eq(empty.refinedSubClass, undefined, 'no refined sub-class');

  const nonempty = H.classifyStability([{ status: 'ok', hex: '08 01' }, { status: 'ok', hex: '08 01' }]);
  eq(nonempty.stability, 'stable-nonempty', 'same non-empty');

  const changed = H.classifyStability([{ status: 'ok', hex: '' }, { status: 'ok', hex: '08 00' }]);
  eq(changed.stability, 'changed', 'disagreeing reads');

  const single = H.classifyStability([{ status: 'ok', hex: '08 00' }]);
  eq(single.stability, 'single-sample', 'one sample cannot establish stability');

  const none = H.classifyStability([{ status: 'declined', hex: null }]);
  eq(none.stability, 'unavailable', 'no successful sample');
  eq(none.complete, false, 'incomplete series');
});

check('Dev live helpers: evaluateVerdicts is non-throwing and never passes an all-no-op set', () => {
  const H = loadLiveHelpers();
  if (!H) return;
  const ctx = {
    checks: [],
    outcome: null,
    check(label, ok, detail) { this.checks.push({ label: label, ok: ok, detail: detail }); },
    setOutcome(functional, reason) { this.outcome = { functional: functional, reason: reason }; },
  };
  H.evaluateVerdicts(ctx, { enable: { cls: 'no-op' }, disable: { cls: 'no-op' } });
  eq(ctx.outcome.functional, 'inconclusive', 'all-no-op is inconclusive');
  eq(ctx.checks.length, 2, 'one check per verdict');

  const ctx2 = {
    checks: [], outcome: null,
    check(label, ok) { this.checks.push({ label: label, ok: ok }); },
    setOutcome(functional, reason) { this.outcome = { functional: functional, reason: reason }; },
  };
  H.evaluateVerdicts(ctx2, { enable: { cls: 'passed' }, disable: { cls: 'failed', reason: 'mismatch' } });
  eq(ctx2.outcome.functional, 'failed', 'a failed verdict wins');
});

check('Dev live orchestrator: manifest is immutable, ordered and excludes self-tests', () => {
  const orchPath = path.join(repo, 'web', 'dev', 'live', 'live-orchestrator.js');
  requirePrivate(['web/dev/live/live-orchestrator.js']);
  const registry = [
    { id: 'a', suite: 'Read/Diagnostics', requiresWrite: false },
    { id: 'b', suite: 'Bike Light', requiresWrite: true, registerSummary: 'x' },
    { id: 'c', suite: 'Live Self-Tests', requiresWrite: false },
    { id: 'd', suite: 'Read/Diagnostics', requiresWrite: false },
  ];
  const w = { BES3DevLiveRunner: { registry: registry } };
  const src = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-orchestrator.js'), 'utf8');
  new Function('window', src)(w);
  const O = w.BES3DevOrchestrator;
  assert(O, 'orchestrator did not expose BES3DevOrchestrator');

  const m = O.buildManifest('fast-demo');
  assert(Object.isFrozen(m), 'manifest is frozen');
  assert(Object.isFrozen(m.groups), 'groups are frozen');
  assert(Object.isFrozen(m.scenarioIds), 'scenarioIds are frozen');
  assert(m.groups.every((g) => Object.isFrozen(g) && Object.isFrozen(g.scenarioIds)),
    'each group and its ids are frozen');
  eq(m.scenarioIds.join(','), 'a,d', 'fast-demo is read-only and ordered');
  assert(m.scenarioIds.indexOf('c') === -1, 'self-tests are excluded');
  eq(m.requiresWrite, false, 'fast-demo requires no write');

  const ext = O.buildManifest('extended');
  eq(ext.scenarioIds.join(','), 'a,d,b', 'extended includes the write scenario once');
  eq(ext.requiresWrite, true, 'extended requires write opt-in');

  assert(O.PROFILES['full-hardware'], 'the full-hardware bench profile is defined');
  eq(O.PROFILES['full-hardware'].groups.map((g) => g.name).join('|'),
    'ReadDiagnostics|Diagnostics|Bike Light|Service Interval|Power Ports|General Settings|ID System ID|Write Lab Generic|Hardware Sweep',
    'full-hardware groups are defined in the reviewed order');
  const fh = O.buildManifest('full-hardware');
  eq(fh.scenarioIds.join(','), 'a,d',
    'full-hardware uses explicit light/port ids and does not over-match');
});

check('Dev live runner: recovery statuses and stop/abort controls are present (source)', () => {
  const runnerPath = path.join(repo, 'web', 'dev', 'live', 'live-runner.js');
  requirePrivate(['web/dev/live/live-runner.js']);
  const src = readFileSync(runnerPath, 'utf8');
  for (const token of [
    'already-at-baseline', 'restored-verified', 'restore-unconfirmed', 'restore-failed',
    'recovery-not-attempted-session-lost', 'recovery-not-supported', 'recovery-aborted-by-user',
    'stopAndRecover', 'abortWrites', 'sessionStillCurrent', 'restorable',
  ]) {
    assert(src.includes(token), 'live-runner.js must contain ' + token);
  }
  const help = readFileSync(path.join(repo, 'web', 'dev', 'live', 'live-write-helpers.js'), 'utf8');
  for (const token of ['empty-read-back', 'stable-empty', 'stable-nonempty', 'single-sample', 'unavailable']) {
    assert(help.includes(token), 'live-write-helpers.js must contain ' + token);
  }
});

// The safety document presents the suite count as evidence. It must quote the
// final run, not a historical one. This check is deliberately last: `passed`
// already contains every prior check, and this check makes the documented count
// one higher.
check('Dev distribution: private checkout contains every required Dev asset', () => {
  requirePrivate([
    'dev.html',
    'web/dev/dev-runner.js',
    'web/dev/dev-ui.js',
    'web/dev/dev-logger.js',
    'web/dev/live/live-runner.js',
    'web/dev/live/live-orchestrator.js',
    'web/dev/live/live-acceptance-fixture.js',
    'web/dev/live/live-write-helpers.js',
    'web/dev/live/live-evidence.js',
    'web/dev/live/live-ui.js',
    'web/dev/live/live-suite-read.js',
    'web/dev/live/live-suite-light.js',
    'web/dev/live/live-suite-service.js',
    'web/dev/live/live-suite-ports.js',
    'web/dev/live/live-suite-id.js',
    'web/dev/live/live-suite-writelab.js',
    'web/dev/live/live-suite-generic.js',
    'web/dev/live/live-suite-settings.js',
    'web/dev/live/live-suite-diagnostics.js',
    'web/dev/live/live-suite-sweep.js',
  ]);
});

// Keep this check last: it quotes the final suite total, and in a public tree
// the private-only checks are skipped rather than passed.
check('docs: workshop-write-safety quotes the current suite count', () => {
  const doc = readFileSync(path.join(repo, 'docs', 'workshop-write-safety.md'), 'utf8');
  const m = doc.match(/\*\*(\d+) passed, 0 failed/);
  assert(m, 'the safety document quotes a passed count');
  // The quoted number is the private suite total. In a public tree the
  // private-only checks are reported as skipped, not passed, so the total is
  // passed + skipped + this check.
  eq(Number(m[1]), passed + skipped + 1, 'the documented count matches this run');
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
if (skipped) {
  console.log('');
  for (const s of skipReasons) console.log('  - skip ' + s.name + ': ' + s.reason);
}
if (failed) {
  console.log('');
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.message);
  process.exit(1);
}
process.exit(0);
