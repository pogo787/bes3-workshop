// BES3 Workshop – battery health card (read-only heuristic)
// This is a presentation heuristic, not a Bosch rating. All thresholds live in
// one reviewed object so the card and the tests cannot drift apart.
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const THRESHOLDS = Object.freeze({
    sohGood: 80,
    sohWarn: 60,
    cyclesWarn: 800,
    cyclesBad: 1200,
    whPerCycleGood: 2.0,
    whPerCycleWarn: 1.2,
    tempWarn: 45,
    tempBad: 55,
  });
  const NOTE = 'Heuristic, not a Bosch rating.';

  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function assess(d) {
    const soh = num(d && d.soh);
    const cycles = num(d && d.cycles);
    const deliveredWh = num(d && d.deliveredWh);
    const tMin = num(d && d.tMin);
    const tMax = num(d && d.tMax);
    const whPerCycle = cycles != null && cycles > 0 && deliveredWh != null ? deliveredWh / cycles : null;
    const reasons = [];
    let level = 'unknown';
    const raise = (next, why) => {
      reasons.push(why);
      if (next === 'bad' || level === 'bad') level = 'bad';
      else if (next === 'warn' || level === 'warn') level = 'warn';
      else if (level === 'unknown') level = 'good';
    };
    if (soh != null) {
      if (soh < THRESHOLDS.sohWarn) raise('bad', 'State of health is below ' + THRESHOLDS.sohWarn + ' %.');
      else if (soh < THRESHOLDS.sohGood) raise('warn', 'State of health is below ' + THRESHOLDS.sohGood + ' %.');
      else raise('good', 'State of health is at or above ' + THRESHOLDS.sohGood + ' %.');
    }
    if (cycles != null) {
      if (cycles >= THRESHOLDS.cyclesBad) raise('bad', 'Full charge cycles are at or above ' + THRESHOLDS.cyclesBad + '.');
      else if (cycles >= THRESHOLDS.cyclesWarn) raise('warn', 'Full charge cycles are at or above ' + THRESHOLDS.cyclesWarn + '.');
    }
    if (whPerCycle != null) {
      if (whPerCycle < THRESHOLDS.whPerCycleWarn) raise('bad', 'Lifetime Wh per cycle is below ' + THRESHOLDS.whPerCycleWarn + '.');
      else if (whPerCycle < THRESHOLDS.whPerCycleGood) raise('warn', 'Lifetime Wh per cycle is below ' + THRESHOLDS.whPerCycleGood + '.');
    }
    if (tMax != null) {
      if (tMax > THRESHOLDS.tempBad) raise('bad', 'Maximum pack temperature is above ' + THRESHOLDS.tempBad + ' °C.');
      else if (tMax > THRESHOLDS.tempWarn) raise('warn', 'Maximum pack temperature is above ' + THRESHOLDS.tempWarn + ' °C.');
    }
    // A temperature alone is not enough for a health level. If any core
    // capacity value exists and no threshold was crossed, the card says good.
    if (level === 'unknown' && (soh != null || cycles != null || whPerCycle != null)) level = 'good';
    return { level, reasons, values: { soh, cycles, deliveredWh, tMin, tMax, whPerCycle }, thresholds: THRESHOLDS };
  }

  function fmt(v, unit) {
    if (v == null) return '–';
    const n = Math.round(v * 100) / 100;
    return String(n) + (unit ? ' ' + unit : '');
  }

  function render(d) {
    const a = assess(d);
    const chip = a.level === 'bad' ? 'bad' : a.level === 'warn' ? 'warn' : a.level === 'good' ? 'ok' : '';
    const label = a.level === 'bad' ? 'Concern' : a.level === 'warn' ? 'Watch' : a.level === 'good' ? 'Good' : 'Not enough data';
    const rows = [
      ['State of health', fmt(a.values.soh, '%')],
      ['Full charge cycles', fmt(a.values.cycles, '')],
      ['Lifetime energy delivered', a.values.deliveredWh == null ? '–' : fmt(a.values.deliveredWh / 1000, 'kWh')],
      ['Wh per full cycle', fmt(a.values.whPerCycle, 'Wh')],
      ['Pack temperature min. / max.', a.values.tMin == null && a.values.tMax == null ? '–' : fmt(a.values.tMin, '°C') + ' / ' + fmt(a.values.tMax, '°C')],
    ].map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
    const reasons = a.reasons.length ? '<ul>' + a.reasons.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '';
    return '<div class="section" id="batteryHealth"><div class="section__head"><div><h2 class="section__title">Battery health</h2>'
      + '<p class="section__sub">A conservative presentation heuristic for the main battery. It is not a Bosch rating and does not replace a dealer battery test.</p></div>'
      + '<span class="chip' + (chip ? ' chip--' + chip : '') + '">' + esc(label) + '</span></div>'
      + '<div class="card"><p class="field__hint" style="margin-top:0"><strong>' + esc(NOTE) + '</strong></p>'
      + '<dl class="kv">' + rows + '</dl>' + reasons + '</div></div>';
  }

  window.Bes3BatteryHealth = { THRESHOLDS, NOTE, assess, render };
})();
