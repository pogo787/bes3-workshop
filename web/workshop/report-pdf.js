// BES3 Workshop – eBike report (PDF, A4, vector via jsPDF)
// Page structure follows a typical workshop eBike report:
// Overview · eBike statistics · Components & battery · Configuration & assistance modes
// · Software versions · (optional) Diagnostic results.
// Deliberately without any Bosch logo or trademarks of Bosch tools: unofficial report.
(function () {
  'use strict';

  const C = {
    ink: [0, 0, 0], ink2: [70, 72, 76], ink3: [125, 128, 133], muted: [170, 173, 178],
    card: [246, 246, 246], line: [215, 216, 218], ok: [0, 136, 74], warn: [237, 140, 0], bad: [226, 0, 21],
    link: [0, 98, 168], white: [255, 255, 255],
  };
  // Clean generic accent stripe (slate → workshop teal)
  const STRIPE = [[24, 34, 44], [15, 106, 102], [20, 138, 132]];
  // Bike graphic: frame dark blue → teal, multi-coloured wheels
  const GEO = {
    bb: [138, 122],
    tubes: [[[70, 118], [138, 122]], [[70, 118], [120, 58]], [[138, 122], [120, 58]], [[120, 58], [226, 56]],
      [[138, 122], [232, 74]], [[226, 56], [232, 74]], [[232, 74], [260, 118]], [[120, 58], [116, 44]], [[104, 42], [128, 42]],
      [[226, 56], [222, 38]], [[212, 36], [236, 34]]],
    batt: [[150, 110], [212, 82]],
    lamp: [240, 66],
  };
  window.Bes3BikeGeometry = GEO;
  const PAGE_W = 210; const PAGE_H = 297; const M = 14; const CW = PAGE_W - 2 * M;

  // The cadence bar is deliberately neutral: a grey track and a blue fill stay
  // distinguishable in the PDF preview and in the exported file, and the black
  // value text keeps a 21:1 contrast on the white page.
  const CADENCE_COLORS = {
    track: [215, 216, 218],
    fill: [0, 98, 168],
    text: [0, 0, 0],
    background: [255, 255, 255],
  };

  // The report and the on-screen readout share the Other segment: amber, last
  // in the stack, and based only on the bike's own totals.
  const OTHER_COLOR = '#f59e0b';
  const OTHER_NOTE = 'Riding in assist modes that are not tracked by the bike (for example eMTB, Turbo).';

  function finiteNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // Cadence fill in percent, clamped to the 0..120 rpm scale of the bar.
  // Numeric strings are accepted because a saved readout may carry them.
  function cadenceFill(value, max = 120) {
    const v = finiteNumber(value);
    const m = finiteNumber(max);
    if (v === null || m === null || m <= 0) return 0;
    return Math.max(0, Math.min(100, (v / m) * 100));
  }

  // Other = total - sum(tracked parts), in the unit of the caller (metres or
  // Wh). A missing or invalid total means there is no reliable residual, so
  // value is null and the segment must not be drawn. Values below the display
  // rounding (minVisible) are hidden instead of shown as a 0.0 segment.
  function otherShare(total, parts, minVisible = 0) {
    const t = finiteNumber(total);
    if (t === null || t < 0) return { value: null, visible: false };
    let sum = 0;
    for (const part of Array.isArray(parts) ? parts : []) {
      const n = finiteNumber(part);
      if (n !== null && n > 0) sum += n;
    }
    const value = Math.max(0, t - sum);
    const threshold = Math.max(0, finiteNumber(minVisible) || 0);
    return { value, visible: value > 0 && value >= threshold };
  }

  // Append the Other segment last. The helper does not mutate the caller's
  // items, so the same tracked-mode list can be reused for both charts.
  function withOtherSegment(items, other, key) {
    const out = Array.isArray(items) ? items.slice() : [];
    if (!other || !other.visible) return out;
    const value = finiteNumber(other.value);
    if (value === null || value <= 0) return out;
    const segment = { name: 'Other', color: OTHER_COLOR, other: true };
    segment[key === 'energy' ? 'energy' : 'distance'] = value;
    out.push(segment);
    return out;
  }

  // A probe row "returned a value" only when the read succeeded and the decoded
  // display is not an empty-payload placeholder.
  function probeRowHasValue(row) {
    if (!row || row.redacted === true || row.status !== 'ok') return false;
    const display = String(row.display === null || row.display === undefined ? '' : row.display).trim();
    if (!display || /^\(empty\)$/i.test(display) || display === '–' || display === '-') return false;
    return true;
  }

  function probeSummary(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let read = 0;
    for (const row of list) if (probeRowHasValue(row)) read += 1;
    return { total: list.length, read, empty: list.length - read };
  }

  // Average consumption of the untracked remainder: residual energy divided by
  // residual distance. Hidden when the residual distance is zero or either
  // total is missing, so a guess is never shown.
  function otherEfficiency(otherDistance, otherEnergy) {
    const d = otherDistance && finiteNumber(otherDistance.value);
    const e = otherEnergy && finiteNumber(otherEnergy.value);
    if (d === null || d <= 0 || e === null) return { visible: false, value: null };
    return { visible: true, value: e / (d / 1000) };
  }

  function hexToRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return [176, 180, 186];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fill = (doc, c) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (doc, c) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (doc, c) => doc.setTextColor(c[0], c[1], c[2]);
  function font(doc, size, style = 'normal', c = C.ink) { doc.setFont('helvetica', style); doc.setFontSize(size); color(doc, c); }

  function mask(s) {
    if (!s) return s;
    const str = String(s);
    if (str.length <= 4) return '****';
    return str.slice(0, 2) + str.slice(2, -2).replace(/[0-9A-Za-z]/g, '*') + str.slice(-2);
  }
  // EB13100000 -> "EB13 100 000" (grouped for readability)
  function fmtPart(p) {
    if (!p) return p;
    const m = /^([A-Z]{2}\d{2})(\w{3})(\w{3})$/.exec(String(p).replace(/\s/g, ''));
    return m ? `${m[1]} ${m[2]} ${m[3]}` : p;
  }

  // A dependency-free vector glyph per component type. Used in the report when
  // neither the embedded base64 images nor the session-only remote photos are
  // available, so the thumbnail column is never empty. Keys are the component
  // keys used by the UI (the same ones that receive a photograph).
  const COMPONENT_GLYPHS = Object.freeze({
    DriveUnit: 'motor',
    Battery: 'battery',
    Battery2: 'battery2',
    RemoteControl: 'control',
    MiniRemote: 'mini',
    HeadUnit: 'display',
    ConnectModule: 'module',
    AntiLockBrakeSystem: 'abs',
  });
  const COMPONENT_GLYPH_KEYS = Object.freeze(Object.keys(COMPONENT_GLYPHS));
  function hasComponentGlyph(key) {
    return Object.prototype.hasOwnProperty.call(COMPONENT_GLYPHS, key);
  }

  // Draws an 18 × 14 mm tile. All coordinates are relative to the tile, so the
  // same glyph works at any page size. Returns false for an unknown key.
  function drawComponentGlyph(doc, key, x, y, w = 18, h = 14) {
    if (!hasComponentGlyph(key)) return false;
    const kind = COMPONENT_GLYPHS[key];
    const cx = x + w / 2;
    const cy = y + h / 2;
    const line = [70, 72, 76];
    fill(doc, [243, 244, 246]);
    doc.roundedRect(x, y, w, h, 1.2, 1.2, 'F');
    stroke(doc, [208, 211, 215]);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, w, h, 1.2, 1.2, 'S');
    color(doc, line);
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.75);
    if (kind === 'motor') {
      doc.circle(cx, cy, 3.3, 'S');
      doc.circle(cx, cy, 1.0, 'F');
      doc.line(cx - 4.6, cy - 2.2, cx - 3.3, cy - 1.1);
      doc.line(cx - 4.6, cy + 2.2, cx - 3.3, cy + 1.1);
      doc.line(cx + 4.6, cy - 2.2, cx + 3.3, cy - 1.1);
      doc.line(cx + 4.6, cy + 2.2, cx + 3.3, cy + 1.1);
    } else if (kind === 'battery' || kind === 'battery2') {
      const bx = kind === 'battery2' ? cx - 5.2 : cx - 4.6;
      doc.roundedRect(bx, cy - 2.8, 8.0, 5.6, 0.9, 0.9, 'S');
      doc.rect(bx + 8.0, cy - 1.2, 1.2, 2.4, 'F');
      doc.line(bx + 2.0, cy - 1.7, bx + 2.0, cy + 1.7);
      doc.line(bx + 4.0, cy - 1.7, bx + 4.0, cy + 1.7);
      doc.line(bx + 6.0, cy - 1.7, bx + 6.0, cy + 1.7);
      if (kind === 'battery2') doc.line(cx + 6.0, cy - 3.4, cx + 8.2, cy - 3.4);
    } else if (kind === 'control') {
      doc.roundedRect(cx - 5.8, cy - 1.7, 11.6, 3.4, 1.7, 1.7, 'S');
      doc.circle(cx - 3.6, cy, 0.8, 'F');
      doc.circle(cx, cy, 0.8, 'F');
      doc.circle(cx + 3.6, cy, 0.8, 'F');
    } else if (kind === 'mini') {
      doc.roundedRect(cx - 3.1, cy - 1.6, 6.2, 3.2, 1.6, 1.6, 'S');
      doc.circle(cx - 1.3, cy, 0.6, 'F');
      doc.circle(cx + 1.3, cy, 0.6, 'F');
    } else if (kind === 'display') {
      doc.roundedRect(cx - 4.4, cy - 3.6, 8.8, 5.4, 0.7, 0.7, 'S');
      doc.line(cx, cy + 1.8, cx, cy + 3.2);
      doc.line(cx - 2.6, cy + 3.2, cx + 2.6, cy + 3.2);
      doc.line(cx - 2.6, cy - 1.4, cx + 2.6, cy - 1.4);
    } else if (kind === 'module') {
      doc.roundedRect(cx - 4.4, cy - 1.8, 8.8, 4.4, 0.7, 0.7, 'S');
      doc.line(cx + 1.4, cy - 1.8, cx + 3.4, cy - 4.2);
      doc.circle(cx + 3.9, cy - 4.6, 0.5, 'F');
      doc.line(cx - 5.2, cy + 3.6, cx + 5.2, cy + 3.6);
    } else if (kind === 'abs') {
      doc.circle(cx, cy, 4.4, 'S');
      doc.circle(cx, cy, 2.4, 'S');
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        doc.line(cx + Math.cos(a) * 4.4, cy + Math.sin(a) * 4.4, cx + Math.cos(a) * 5.0, cy + Math.sin(a) * 5.0);
      }
      font(doc, 3.4, 'bold', line);
      doc.text('ABS', cx, cy + 1.2, { align: 'center' });
    }
    return true;
  }

  function build(d, opts) {
    const { jsPDF } = window.jspdf;
    const H = opts.helpers;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: `eBike Report ${d.brand || ''}`.trim(), subject: 'Bosch Smart System – unofficial diagnostic report', creator: 'BES3 Workshop' });
    const createdTxt = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const A = (s) => (opts.anonymize ? mask(s) : s);
    const NF1 = H.NF1; const NF0 = H.NF0; const NF2 = H.NF2;
    const dash = 'Not available';
    const issues = d.issues || [];
    let pageNo = 0;

    // ------------------------------------------------------------ frame
    function stripe(y, h) {
      const w = CW / STRIPE.length;
      STRIPE.forEach((c, i) => { fill(doc, c); doc.rect(M + i * w, y, w + 0.05, h, 'F'); });
    }
    function wordmark(xr, y) {
      font(doc, 13, 'normal', C.ink3); const w2 = doc.getTextWidth('Workshop');
      doc.text('Workshop', xr, y, { align: 'right' });
      font(doc, 13, 'bold', C.ink); doc.text('BES3', xr - w2 - 1.6, y, { align: 'right' });
    }
    function header() {
      stripe(6, 1.6);
      font(doc, 21, 'bold', C.ink); doc.text('eBike Report', M, 20.5);
      font(doc, 15, 'normal', C.ink); doc.text(d.brand || 'Bosch Smart System', M, 29);
      wordmark(PAGE_W - M, 19);
      const demoData = d.simulated === true || d.source === 'demo';
      font(doc, 7, 'normal', C.ink3); doc.text(demoData ? 'Demo – simulated data' : 'unofficial diagnostic report', PAGE_W - M, 24, { align: 'right' });
    }
    function footer() {
      stroke(doc, C.line); doc.setLineWidth(0.25); doc.line(M, PAGE_H - 18, PAGE_W - M, PAGE_H - 18);
      font(doc, 8, 'bold', C.ink); doc.text(`Page ${pageNo}`, M, PAGE_H - 13.5);
      font(doc, 8, 'normal', C.ink2);
      const demoData = d.simulated === true || d.source === 'demo';
      const src = demoData ? 'Demo (simulated data)' : d.source === 'file' ? 'from saved readout' : `Read ${H.fmtDateTime(new Date(d.readAt))}`;
      doc.text(`Created: ${createdTxt} | ${src} | BES3 Workshop`, PAGE_W - M, PAGE_H - 13.5, { align: 'right' });
      font(doc, 6.2, 'normal', C.ink3);
      doc.text('Unofficial report, not affiliated with or endorsed by Robert Bosch GmbH. Values as reported by the bike.', M, PAGE_H - 9.3);
      const pre = 'Based on open source: ';
      doc.text(pre, M, PAGE_H - 6.3);
      let x = M + doc.getTextWidth(pre);
      color(doc, C.link);
      CREDITS.forEach((c, i) => {
        doc.textWithLink(c.label, x, PAGE_H - 6.3, { url: c.url });
        x += doc.getTextWidth(c.label);
        if (i < CREDITS.length - 1) { color(doc, C.ink3); doc.text(' · ', x, PAGE_H - 6.3); x += doc.getTextWidth(' · '); color(doc, C.link); }
      });
    }
    function newPage() {
      if (pageNo > 0) doc.addPage();
      pageNo += 1;
      header(); footer();
    }
    const CREDITS = [
      { label: 'github.com/rweijnen/bosch-bes3-reader', url: 'https://github.com/rweijnen/bosch-bes3-reader' },
      { label: 'github.com/radiohound/bosch-smart-system-ble', url: 'https://github.com/radiohound/bosch-smart-system-ble' },
      { label: 'github.com/revlat/bes3-analyzer', url: 'https://github.com/revlat/bes3-analyzer/tree/main' },
    ];
    function h1(t, y) { font(doc, 15.5, 'bold', C.ink); doc.text(t, M, y); return y + 5.5; }
    function badge(x, y, kind) {
      // kind: 'ok' | 'warn' | 'bad'
      fill(doc, kind === 'ok' ? C.ok : kind === 'bad' ? C.bad : C.warn); doc.circle(x, y, 2.7, 'F');
      stroke(doc, C.white); doc.setLineWidth(0.55); doc.setLineCap('round');
      if (kind === 'ok') { doc.line(x - 1.2, y + 0.05, x - 0.35, y + 0.95); doc.line(x - 0.35, y + 0.95, x + 1.3, y - 0.85); }
      else { doc.line(x, y - 1.35, x, y + 0.35); doc.line(x, y + 1.25, x, y + 1.3); }
      doc.setLineCap('butt');
    }
    function card(x, y, w, h, c = C.card) { fill(doc, c); doc.rect(x, y, w, h, 'F'); }
    const CARD_H = 13.2; const GAP = 3;
    function infoCard(x, y, w, label, value, mark) {
      card(x, y, w, CARD_H);
      font(doc, 8.6, 'bold', C.ink); doc.text(label, x + 4.5, y + 5.4);
      font(doc, 8.6, 'normal', C.ink2);
      const v = doc.splitTextToSize(String(value == null || value === '' ? dash : value), w - (mark ? 16 : 9));
      doc.text(v[0], x + 4.5, y + 10);
      if (mark) badge(x + w - 7, y + CARD_H / 2, mark);
    }
    function grid2(y, items) {
      const w = (CW - GAP) / 2;
      items.forEach((it, i) => infoCard(M + (i % 2) * (w + GAP), y + Math.floor(i / 2) * (CARD_H + GAP), w, it[0], it[1], it[2]));
      return y + Math.ceil(items.length / 2) * (CARD_H + GAP);
    }

    // ------------------------------------------------------------ generic eBike silhouette
    function bike(x, y, w) {
      const s = w / 330;
      const P = (px, py) => [x + px * s, y + py * s];
      const wheelCol = [125, 132, 140];
      const frameCol = [28, 34, 42];
      const accentCol = [15, 106, 102];
      // Clean solid wheels with subtle inner rim
      stroke(doc, wheelCol); doc.setLineWidth(8.5 * s);
      const w1 = P(70, 118); const w2 = P(260, 118);
      doc.circle(w1[0], w1[1], 50 * s, 'S');
      doc.circle(w2[0], w2[1], 50 * s, 'S');
      stroke(doc, [210, 214, 218]); doc.setLineWidth(2 * s);
      doc.circle(w1[0], w1[1], 42 * s, 'S');
      doc.circle(w2[0], w2[1], 42 * s, 'S');
      doc.setLineCap('round'); doc.setLineJoin('round');
      const seg = (a, b, c, lw = 7.5) => { stroke(doc, c); doc.setLineWidth(lw * s); const p = P(...a); const q = P(...b); doc.line(p[0], p[1], q[0], q[1]); };
      GEO.tubes.forEach(([a, b]) => seg(a, b, frameCol));
      seg(GEO.batt[0], GEO.batt[1], accentCol, 13.5);
      fill(doc, frameCol); const hub = P(...GEO.bb); doc.circle(hub[0], hub[1], 13 * s, 'F');
      fill(doc, accentCol); doc.circle(hub[0], hub[1], 5.5 * s, 'F');
      fill(doc, frameCol); doc.circle(w1[0], w1[1], 6 * s, 'F'); doc.circle(w2[0], w2[1], 6 * s, 'F');
      doc.setLineCap('butt');
    }

    // ============================================================ page 1 – overview
    newPage();
    bike(M, 38, 92);
    const issueCount = issues.length;
    const allOk = d.issuesScanned && !issueCount && !d.locked;
    const du = d.comps.find((c) => c.key === 'DriveUnit') || {};
    let y = h1('Overview', 104);
    y = grid2(y, [
      ['Total distance', d.odoKm != null ? `eBike: ${NF1.format(d.odoKm)} km` : null],
      ['Service interval', d.service.set ? H.serviceText(d.service) : 'Not set'],
      ['Battery state of charge', d.soc != null ? `${d.soc} %${d.battery2 && d.battery2.soc != null ? ` / ${d.battery2.soc} %` : ''}` : null],
      ['Software version', du.sw ? `Drive unit ${du.sw}` : null],
      ['General condition', !d.issuesScanned ? 'Not checked' : allOk ? 'All good' : 'Needs attention', d.issuesScanned ? (allOk ? 'ok' : 'warn') : null],
      ['Diagnostic results', !d.issuesScanned ? 'Not read' : issueCount ? `${issueCount === 1 ? '1 fault entry' : `${issueCount} fault entries`} (${issues.map((i) => i.code || i.issueId).join(', ')})` : 'All good', d.issuesScanned ? (issueCount ? 'warn' : 'ok') : null],
    ]);
    y = h1('eBike information', y + 7);
    y = grid2(y, [
      ['Bike model ID', A(d.modelId)],
      ['Brand', d.brand],
      ['Product line', d.line],
      ['eBike ID', A(d.oemBikeId)],
      ['Bosch System ID', A(d.bikeId)],
      ['Battery key lock number', A(d.keyLock)],
      ['Max. assisted speed', d.legal != null ? `${NF1.format(d.legal)} km/h` : null],
      ['Bike category', d.category],
    ]);
    y = h1('Workshop information', y + 7);
    {
      const w = (CW - GAP) / 2;
      font(doc, 8.6, 'normal', C.ink2);
      // The customer reference/address and notes are the most personal fields
      // in the report. The anonymise switch must redact them completely, not
      // apply the partial mask used for identifiers.
      const refText = opts.anonymize ? 'Redacted' : (opts.ref || 'Not specified');
      const noteText = opts.anonymize ? 'Redacted' : opts.notes;
      const refL = doc.splitTextToSize(refText, w - 9).slice(0, 5);
      const noteL = noteText ? doc.splitTextToSize(noteText, w - 9).slice(0, 5) : [];
      const bh = Math.max(24, 10 + Math.max(refL.length, noteL.length) * 4.1 + 4);
      card(M, y, w, bh);
      font(doc, 8.6, 'bold', C.ink); doc.text('Customer reference / address', M + 4.5, y + 6);
      font(doc, 8.6, 'normal', C.ink2); doc.text(refL, M + 4.5, y + 11);
      if (noteL.length) {
        card(M + w + GAP, y, w, bh);
        font(doc, 8.6, 'bold', C.ink); doc.text('Notes', M + w + GAP + 4.5, y + 6);
        font(doc, 8.6, 'normal', C.ink2); doc.text(noteL, M + w + GAP + 4.5, y + 11);
      }
    }

    // ============================================================ page 2 – statistics
    newPage();
    y = h1('eBike statistics (since first use)', 46);
    const modes = d.modes.filter((m) => m.distance != null);
    const eff = (m) => (m.distance ? (m.energy || 0) / (m.distance / 1000) : 0);
    function layoutWidths(vals) {
      const sum = vals.reduce((a, b) => a + b, 0) || 1;
      const minW = 14; const gap = 0.9;
      let widths = vals.map((v) => Math.max(minW, (v / sum) * CW));
      const scale = (CW - gap * (vals.length - 1)) / widths.reduce((a, b) => a + b, 0);
      return { widths: widths.map((w) => w * scale), gap };
    }
    function hills(x, base, w, c, amp) {
      // hill silhouette for the distance bar
      fill(doc, c);
      const n = Math.max(1, Math.round(w / 48));
      const pts = []; const N = 36;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const yy = base - 2.6 - amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * n * t)) * (w < 22 ? 0.5 : 1);
        pts.push([x + t * w, yy]);
      }
      const segs = [];
      for (let k = 1; k < pts.length; k++) segs.push([pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]]);
      segs.push([0, base - pts[pts.length - 1][1]]); segs.push([-w, 0]);
      doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'F', true);
      doc.rect(x, base - 2.6, w, 2.6, 'F');
    }
    function segBar(title, total, getter, fmt, caption, y0, hilly, barModes = modes) {
      font(doc, 11, 'normal', C.ink); doc.text(title, M, y0);
      font(doc, 15, 'bold', C.ink); doc.text(barModes.length ? total : 'Not available', M, y0 + 7.5);
      const base = y0 + (hilly ? 22 : 14.5);
      if (!barModes.length) { font(doc, 8.5, 'normal', C.ink3); doc.text('Connect the eBike live to read ride statistics.', M, y0 + 14); return y0 + 24; }
      const vals = barModes.map(getter);
      const { widths, gap } = layoutWidths(vals);
      const maxV = Math.max(...vals) || 1;
      let x = M;
      barModes.forEach((m, i) => {
        const c = hexToRgb(m.color);
        if (hilly && vals[i] > 0 && m.configId !== '0') hills(x, base, widths[i], c, 3 + 5 * (vals[i] / maxV));
        else { fill(doc, c); doc.rect(x, base - 2.6, widths[i], 2.6, 'F'); }
        const cx = x + widths[i] / 2;
        font(doc, 7.8, 'normal', C.ink); doc.text(String(m.name || '').slice(0, 10), cx, base + 4.6, { align: 'center' });
        font(doc, 7.8, 'bold', C.ink); doc.text(fmt(vals[i]), cx, base + 9.2, { align: 'center' });
        x += widths[i] + gap;
      });
      font(doc, 6.8, 'normal', C.ink); doc.text(caption, PAGE_W - M, base + 14, { align: 'right' });
      stroke(doc, C.line); doc.setLineWidth(0.25); doc.line(M, base + 16.5, PAGE_W - M, base + 16.5);
      return base + 27;
    }
    const nf = (v, nfmt) => (v === 0 ? '0' : nfmt.format(v));
    const totD = modes.reduce((a, m) => a + (m.distance || 0), 0);
    const totE = modes.reduce((a, m) => a + (m.energy || 0), 0);
    // The bike's own totals are the only source for the untracked remainder.
    // If either total was not read, Other is skipped for that quantity.
    const totalDistM = d.odoKm != null ? d.odoKm * 1000 : null;
    const totalEnergyWh = d.totalEnergyWh != null ? d.totalEnergyWh : null;
    const otherD = otherShare(totalDistM, modes.map((m) => m.distance), 50);
    const otherE = otherShare(totalEnergyWh, modes.map((m) => m.energy), 5);
    const distModes = withOtherSegment(modes, otherD, 'distance');
    const energyModes = withOtherSegment(modes, otherE, 'energy');
    const distTotal = otherD.visible ? totalDistM : totD;
    const energyTotal = otherE.visible ? totalEnergyWh : totE;
    const otherEff = otherEfficiency(otherD, otherE);
    const effModes = modes.slice();
    if (otherEff.visible) effModes.push({ name: 'Other', color: OTHER_COLOR, other: true, distance: otherD.value, energy: otherE.value });
    y = segBar('Distance ridden', `${NF1.format(distTotal / 1000)} km`, (m) => (m.distance || 0) / 1000, (v) => nf(v, NF1), 'Distance ridden per assistance mode (km)', y + 5, true, distModes);
    y = segBar('Energy consumption (assistance modes)', `${NF2.format(energyTotal / 1000)} kWh`, (m) => (m.energy || 0) / 1000, (v) => nf(v, NF2), 'Energy consumption per assistance mode (kWh)', y, false, energyModes);
    y = segBar('Average energy consumption', `${NF2.format(totD ? totE / (totD / 1000) : 0)} Wh/km`, eff, (v) => nf(v, NF2), 'Average energy consumption per assistance mode (Wh/km)', y, false, effModes);
    if (otherD.visible || otherE.visible) {
      font(doc, 6.8, 'normal', C.ink3);
      doc.text(doc.splitTextToSize('Other: ' + OTHER_NOTE, CW), M, y + 1);
      y += 6;
    }

    // operating hours + cadence
    {
      const lw = 112;
      font(doc, 11, 'normal', C.ink);
      doc.text(doc.splitTextToSize('Total operating time with assistance', 60), M, y);
      doc.text('Total operating time', M + lw, y, { align: 'right' });
      doc.text(doc.splitTextToSize('Average rider cadence', 44), M + lw + 10, y);
      const cadenceRpm = finiteNumber(d.cadence);
      const hasCadence = cadenceRpm !== null && cadenceRpm >= 0;
      font(doc, 15, 'bold', C.ink);
      doc.text(d.supportH != null ? `${NF0.format(d.supportH)} h` : '–', M, y + 13);
      doc.text(d.powerOnH != null ? `${NF0.format(d.powerOnH)} h` : '–', M + lw, y + 13, { align: 'right' });
      doc.text(hasCadence ? `${cadenceRpm} rpm` : '–', M + lw + 10, y + 13);
      fill(doc, [80, 170, 245]); doc.rect(M, y + 19, lw, 2.6, 'F');
      if (d.supportH != null && d.powerOnH) { fill(doc, [0, 110, 180]); doc.rect(M, y + 19, lw * Math.min(1, d.supportH / d.powerOnH), 2.6, 'F'); }
      // cadence: one horizontal bar, 0..120 rpm. The track is grey and the fill
      // blue, so a 64 % fill cannot be mistaken for a full bar; the black value
      // text is set explicitly instead of inheriting a previous drawing colour.
      const cx0 = M + lw + 10; const cw2 = PAGE_W - M - cx0;
      stroke(doc, CADENCE_COLORS.track); doc.setLineWidth(2.6); doc.setLineCap('butt');
      doc.line(cx0, y + 20.3, cx0 + cw2, y + 20.3);
      if (hasCadence) {
        const frac = cadenceFill(cadenceRpm) / 120;
        fill(doc, CADENCE_COLORS.fill); doc.rect(cx0, y + 19, cw2 * frac, 2.6, 'F');
      }
      font(doc, 6.8, 'normal', C.muted);
      doc.text('0 rpm', cx0, y + 27);
      doc.text('120 rpm', cx0 + cw2, y + 27, { align: 'right' });
      y += 34;
    }
    // battery energy & health
    stroke(doc, C.line); doc.setLineWidth(0.25); doc.line(M, y - 4, PAGE_W - M, y - 4);
    font(doc, 11, 'normal', C.ink); doc.text('Energy delivered by battery', M, y + 4);
    doc.text('Battery state of health', PAGE_W - M, y + 4, { align: 'right' });
    font(doc, 15, 'bold', C.ink);
    doc.text(d.deliveredWh != null ? `${NF1.format(d.deliveredWh / 1000)} kWh` : '–', M, y + 11.5);
    doc.text(d.soh != null ? `${d.soh} %` : '–', PAGE_W - M, y + 11.5, { align: 'right' });
    fill(doc, [120, 200, 150]); doc.rect(M, y + 16, CW, 2.6, 'F');
    if (d.soh != null) { fill(doc, C.ok); doc.rect(M, y + 16, (CW * Math.min(100, d.soh)) / 100, 2.6, 'F'); }
    font(doc, 6.8, 'normal', C.ink); doc.text(`Full charge cycles: ${d.cycles != null ? NF1.format(d.cycles) : '–'}`, PAGE_W - M, y + 23, { align: 'right' });

    // ============================================================ page 3 – components
    newPage();
    y = h1('Components', 46);
    const comps = d.comps.filter((c) => c.present || (c.core && c.key !== 'MiniRemote'));
    const cw = (CW - GAP) / 2; const ch = comps.length > 4 ? 46 : 52;
    comps.forEach((c, i) => {
      const x = M + (i % 2) * (cw + GAP); const yy = y + Math.floor(i / 2) * (ch + GAP);
      if (!c.present) {
        stroke(doc, C.line); doc.setLineWidth(0.35); doc.rect(x, yy, cw, ch, 'S');
        drawIcon(c.key, x + 4, yy + 4, C.muted);
        font(doc, 8.5, 'normal', C.muted); doc.text(c.type, x + 16, yy + 8);
        font(doc, 13, 'bold', C.muted); doc.text('Not connected', x + 16, yy + 14.5);
        if (c.hint) { font(doc, 7.5, 'normal', C.muted); doc.text(doc.splitTextToSize(c.hint, cw - 22).slice(0, 2), x + 16, yy + 20); }
        return;
      }
      card(x, yy, cw, ch);
      drawIcon(c.key, x + 4, yy + 4, C.ink);
      font(doc, 8.5, 'normal', C.ink); doc.text(c.type, x + 16, yy + 8);
      font(doc, 13, 'bold', C.ink); doc.text(doc.splitTextToSize(c.name || c.key, cw - 20)[0], x + 16, yy + 14.5);
      badge(x + 18.5, yy + 24, 'ok');
      font(doc, 8.5, 'normal', C.ink); doc.text('OK', x + 23, yy + 25.2);
      const c1 = x + 16; const c2 = x + 16 + (cw - 18) / 2;
      const kv = (k, v, xx, yy0) => {
        font(doc, 8.3, 'bold', C.ink); doc.text(k, xx, yy0);
        font(doc, 8.3, 'normal', C.ink2); doc.text(doc.splitTextToSize(String(v || 'Not available'), (cw - 20) / 2 - 1).slice(0, 2), xx, yy0 + 4);
      };
      const r1y = comps.length > 4 ? yy + 29 : yy + 31;
      const r2y = comps.length > 4 ? yy + 39.5 : yy + 44;
      if (c.note) { font(doc, 8.3, 'normal', C.ink2); doc.text(doc.splitTextToSize(c.note, cw - 20).slice(0, 3), c1, r1y); return; }
      kv('Serial number', A(c.serial), c1, r1y); kv('Software version', c.sw, c2, r1y);
      kv('Product code', c.code, c1, r2y); kv('Part number', fmtPart(c.part), c2, r2y);
    });
    y += Math.ceil(comps.length / 2) * (ch + GAP) + 1;
    {
      const missingExtras = d.comps.filter((c) => !c.core && !c.present);
      font(doc, 7.3, 'normal', C.ink3);
      const mini = d.comps.find((c) => c.key === 'MiniRemote');
      // Only mention the optional Mini Remote when the strict BRC3300 detection
      // found it. Otherwise the PDF has no Remote placeholder or note at all.
      const note = 'Control unit: System Controller, LED Remote, Purion 200 or Kiox 400C depending on the bike.'
        + (mini && mini.present ? ' A Mini Remote (BRC3300) is paired in addition (paired accessory detected).' : '')
        + (missingExtras.length ? ` Not installed: ${missingExtras.map((c) => c.type).join(', ')}.` : '');
      const sl = doc.splitTextToSize(note, CW); doc.text(sl, M, y + 2.5); y += sl.length * 3.3 + 8;
    }
    {
      const items = [
        ['Battery state of charge', d.soc != null ? `${d.soc} %` : null, 'soc'],
        ['Battery voltage', d.voltage != null ? `${NF1.format(d.voltage)} V` : null, 'volt'],
        ['Full charge cycles', d.cycles != null ? NF1.format(d.cycles) : null, 'cyc'],
        ['Total energy delivered', d.deliveredWh != null ? `${NF1.format(d.deliveredWh / 1000)} kWh (lifetime)` : null, 'kwh'],
        ['Minimum battery temperature', d.tMin != null ? `${NF1.format(d.tMin)} °C (lifetime)` : null, 'cold'],
        ['Maximum battery temperature', d.tMax != null ? `${NF1.format(d.tMax)} °C (lifetime)` : null, 'hot'],
        ['Battery state of health', d.soh != null ? `${d.soh} %` : null, 'soc'],
        ['Remaining energy', d.remainingWh != null ? `${NF0.format(d.remainingWh)} Wh` : null, 'kwh'],
      ];
      if (d.battery2) {
        items.push(['Battery 2 state of charge', d.battery2.soc != null ? `${d.battery2.soc} %` : null, 'soc']);
        items.push(['Battery 2 state of health', d.battery2.soh != null ? `${d.battery2.soh} %` : null, 'soc']);
      }
      const w = (CW - GAP) / 2; const bh = 14.2;
      const needed = 8 + Math.ceil(items.length / 2) * (bh + GAP);
      if (y + needed > PAGE_H - 22) { newPage(); y = 46; }
      y = h1('Battery information', y);
      items.forEach((it, i) => {
        const x = M + (i % 2) * (w + GAP); const yy = y + Math.floor(i / 2) * (bh + GAP);
        card(x, yy, w, bh);
        battIcon(x + 5, yy + 3.2, it[2]);
        font(doc, 8.6, 'bold', C.ink); doc.text(it[0], x + 15, yy + 6.2);
        font(doc, 8.6, 'normal', C.ink2); doc.text(String(it[1] == null ? 'Not available' : it[1]), x + 15, yy + 11);
      });
    }

    function battIcon(x, y0, kind) {
      stroke(doc, C.ink); doc.setLineWidth(0.4);
      doc.roundedRect(x, y0 + 1, 5, 8.2, 0.6, 0.6, 'S'); doc.line(x + 1.6, y0 + 0.3, x + 3.4, y0 + 0.3);
      if (kind === 'soc') { fill(doc, C.ink); [0, 1, 2].forEach((k) => doc.rect(x + 1, y0 + 6.8 - k * 2, 3, 1.4, 'F')); }
      else if (kind === 'volt') { doc.line(x + 2.9, y0 + 3, x + 1.9, y0 + 5.3); doc.line(x + 1.9, y0 + 5.3, x + 3.1, y0 + 5.3); doc.line(x + 3.1, y0 + 5.3, x + 2.1, y0 + 7.6); }
      else if (kind === 'cyc') { doc.circle(x + 5.2, y0 + 8, 1.4, 'S'); }
      else if (kind === 'kwh') { doc.line(x + 4.2, y0 + 8.2, x + 5.4, y0 + 6.6); doc.line(x + 5.4, y0 + 6.6, x + 6.2, y0 + 8.4); }
      else if (kind === 'cold') { doc.line(x + 5.2, y0 + 6, x + 5.2, y0 + 9.6); doc.line(x + 3.6, y0 + 7.8, x + 6.8, y0 + 7.8); }
      else if (kind === 'hot') { [4.4, 5.6, 6.8].forEach((xx) => doc.line(x + xx, y0 + 6.4, x + xx, y0 + 9.4)); }
    }
    function drawIcon(key, x, y0, col) {
      stroke(doc, col); doc.setLineWidth(0.5);
      if (key === 'RemoteControl') { doc.roundedRect(x + 1.5, y0, 6, 10, 1.2, 1.2, 'S'); doc.line(x + 4.5, y0 + 2, x + 4.5, y0 + 4.4); doc.line(x + 3.3, y0 + 3.2, x + 5.7, y0 + 3.2); doc.line(x + 3.3, y0 + 7.6, x + 5.7, y0 + 7.6); }
      else if (key === 'DriveUnit') { doc.ellipse(x + 4.5, y0 + 5, 4.5, 3.4, 'S'); doc.circle(x + 5.4, y0 + 5, 1.5, 'S'); }
      else if (key === 'Battery' || key === 'Battery2') { doc.roundedRect(x + 2, y0 + 1, 5, 9.5, 0.8, 0.8, 'S'); doc.line(x + 3.3, y0, x + 5.7, y0); doc.line(x + 3.2, y0 + 4, x + 5.8, y0 + 4); doc.line(x + 3.2, y0 + 6.5, x + 5.8, y0 + 6.5); }
      else { doc.roundedRect(x + 1, y0, 8, 10.5, 0.8, 0.8, 'S'); doc.rect(x + 2.6, y0 + 1.8, 4.8, 6, 'S'); }
    }

    // ============================================================ page 4 – configuration
    newPage();
    y = h1('Configuration', 44);
    const colW = (CW - GAP) / 2;
    function kvBlock(groups) {
      let yy = 7.5;
      const lines = [];
      groups.forEach((g) => {
        lines.push({ head: g[0], y: yy }); yy += 6.4;
        g[1].forEach(([k, v]) => {
          font(doc, 8.6, 'normal');
          const kl = doc.splitTextToSize(k + ':', colW * 0.52);
          font(doc, 8.6, 'bold');
          const vl = doc.splitTextToSize(String(v == null || v === '' ? dash : v), colW * 0.4);
          lines.push({ k: kl, v: vl, y: yy });
          yy += Math.max(kl.length, vl.length) * 4.2 + 0.9;
        });
        yy += 2.4;
      });
      return { lines, h: yy };
    }
    const yesNo = (v) => (v == null ? null : v ? 'Yes' : 'No');
    const left = [
      ['Speed', [['Speed class', d.speedClass], ['Max. assisted speed', d.legal != null ? `${NF1.format(d.legal)} km/h` : null], ['Assistance cut-off speed', d.maxAssist != null ? `${NF1.format(d.maxAssist)} km/h` : null]]],
      ['General settings', [['System language', d.language], ['Units', d.units], ['Date/time', d.time ? `${H.fmtDateTime(new Date(d.time * 1000))}${d.tz ? ` (${d.tz})` : ''}` : null], ['Start mode', d.startMode]]],
      ['Security', [['Battery key lock number', A(d.keyLock)], ['eBike Lock feature enabled', yesNo(d.lockFeature)], ['eBike Lock engaged', yesNo(d.locked)], ['Tuning detected', d.tuning ? yesNo(d.tuning.flag) : null],
        ['System ID drive unit / control unit', d.duId && d.rcId ? (d.idConflict ? 'Mismatch' : 'Matching') : null]]],
    ];
    const right = [
      ['Bike light', [['Light configuration', d.light.config != null ? (d.light.config ? H.lightConfigLabel(d.light.config) : 'Not set') : null], ['Light installed', yesNo(d.light.available)], ['Light power rating', d.light.powerW != null ? `${NF1.format(d.light.powerW)} W` : null], ['Light at time of reading', d.light.on == null ? null : d.light.on ? 'On' : 'Off']]],
      ['Walk assist', [['Walk assist enabled', d.walk ? yesNo(d.walk.enabled) : null], ['Walk assist speed', d.walk && d.walk.speed ? `${NF1.format(d.walk.speed)} km/h` : null]]],
      ['Drivetrain', [['Gearing system', d.gearing ? `${d.gearing}${d.eShift ? ' (eShift)' : ''}` : null], ['Max. gear ratio', d.gearRatio != null ? NF2.format(d.gearRatio) : null]]],
      ['Wheels', [['Rear wheel circumference', d.wheelOem != null ? `${NF0.format(d.wheelOem)} mm` : null], ['Rear wheel circumference (user)', d.wheelUser != null ? `${NF0.format(d.wheelUser)} mm` : null]]],
    ];
    const L = kvBlock(left); const R = kvBlock(right);
    const bh = Math.max(L.h, R.h) + 1;
    card(M, y, colW, bh); card(M + colW + GAP, y, colW, bh);
    [[L, M], [R, M + colW + GAP]].forEach(([B, x]) => {
      B.lines.forEach((ln) => {
        if (ln.head) { font(doc, 11, 'bold', C.ink); doc.text(ln.head, x + 4, y + ln.y); return; }
        font(doc, 8.6, 'normal', C.ink); doc.text(ln.k, x + 4, y + ln.y);
        font(doc, 8.6, 'bold', C.ink); doc.text(ln.v, x + colW - 4, y + ln.y, { align: 'right' });
      });
    });
    y += bh + 10;

    y = h1('Assistance modes', y);
    const rows = d.modes.filter((m) => m.udam);
    const tH = 11 + Math.max(1, rows.length) * 4.6 + 4;
    card(M, y, CW, tH);
    const cx = [M + 4, M + 110, M + 128, M + 150, M + 166, PAGE_W - M - 4];
    font(doc, 8.6, 'normal', C.ink);
    doc.text('Name', cx[0], y + 6.5);
    ['Max. torque', 'Assist', 'Max. speed', 'Dynamics', 'Power'].forEach((t, i) => { font(doc, 7, 'normal', C.ink2); doc.text(t, cx[i + 1], y + 6.5, { align: 'right' }); });
    rows.forEach((m, i) => {
      const yy = y + 12.5 + i * 4.6;
      const u = m.udam;
      font(doc, 8.6, 'bold', C.ink); doc.text(String(m.name), cx[0], yy);
      [u.maximumMotorTorque != null ? `${u.maximumMotorTorque} Nm` : '–', u.assistLevel != null ? `${u.assistLevel} %` : '–',
        u.maximumBikeSpeed != null ? `${NF0.format(u.maximumBikeSpeed / 100)} km/h` : '–', u.accelerationResponse != null ? `${u.accelerationResponse} %` : '–',
        u.maximumMotorPower != null ? `${u.maximumMotorPower} W` : '–'].forEach((v, k) => doc.text(v, cx[k + 1], yy, { align: 'right' }));
    });
    if (!rows.length) { font(doc, 8.6, 'normal', C.ink3); doc.text('No mode values read', cx[0], y + 12.5); }
    y += tH;
    card(M, y + 1.2, CW, 8);
    font(doc, 7, 'normal', C.ink2);
    doc.text('Max. torque = maximum motor torque (Nm) · Assist = assistance level · Max. speed = maximum assisted speed · Dynamics · Power = max. motor power', M + 4, y + 6.2);

    // ============================================================ page 5 – software versions
    newPage();
    font(doc, 24, 'normal', C.ink); doc.text('Software versions', M, 50);
    font(doc, 8.6, 'normal', C.ink); doc.text('Read on (odometer): ', M, 56);
    font(doc, 8.6, 'bold', C.ink);
    doc.text(`${H.fmtDate(Math.floor(new Date(d.readAt).getTime() / 1000))}${d.odoKm != null ? ` (${NF0.format(d.odoKm)} km)` : ''}`, M + doc.getTextWidth('Read on (odometer): ') + 1, 56);
    y = 68;
    function section(title, y0) {
      font(doc, 8.6, 'bold', C.ink); doc.text(title, M + 1, y0);
      stroke(doc, C.ink3); doc.setLineWidth(0.25); doc.line(M, y0 + 2.6, PAGE_W - M, y0 + 2.6);
      return y0 + 8;
    }
    y = section('eBike information', y);
    [['eBike ID:', A(d.oemBikeId)], ['Brand:', d.brand], ['Bosch System ID:', A(d.bikeId)]].forEach(([k, v]) => {
      font(doc, 8.6, 'normal', C.ink); doc.text(k, M + 1, y); doc.text(String(v || '–'), M + 64, y); y += 4.6;
    });
    y += 6;
    const pdfImg = (c) => {
      if (window.Bes3PartImages && typeof window.Bes3PartImages.getPdfImage === 'function') {
        return window.Bes3PartImages.getPdfImage(c.key, c.code);
      }
      const f = H.partImg && H.partImg(c.key, c.code);
      const tbl = window.Bes3PartImagesPdf;
      if (!f || !tbl) return null;
      const name = f.split('/').pop();
      return tbl[name] && Array.isArray(tbl[name + '#size']) ? { data: tbl[name], size: tbl[name + '#size'] } : null;
    };
    d.comps.filter((c) => c.present && (c.sw || c.part || c.serial || c.code)).forEach((c) => {
      if (y > PAGE_H - 52) { newPage(); y = 46; }
      const img = pdfImg(c);
      let ty = y + 10.5;
      let hasThumb = false;
      if (img) {
        const [iw, ih] = img.size; const sc = Math.min(18 / iw, 14 / ih);
        try { doc.addImage(img.data, 'JPEG', M + 1, y, iw * sc, ih * sc); ty = y + Math.max(10.5, ih * sc - 1); hasThumb = true; } catch (_) { /* fall back to the vector glyph */ }
      }
      if (!hasThumb && hasComponentGlyph(c.key)) {
        try { hasThumb = drawComponentGlyph(doc, c.key, M + 1, y); } catch (_) { hasThumb = false; }
      }
      font(doc, 8.6, 'bold', C.ink); doc.text(`${c.type} ${c.name || ''}`.trim(), M + (hasThumb ? 23 : 1), ty);
      stroke(doc, C.ink3); doc.setLineWidth(0.25); doc.line(M, ty + 2.2, PAGE_W - M, ty + 2.2);
      let yy = ty + 6.8;
      const row = (k1, v1, k2, v2) => {
        font(doc, 8.4, 'normal', C.ink);
        doc.text(k1, M + 1, yy); doc.text(String(v1 || '–'), M + 64, yy);
        if (k2) { doc.text(k2, M + 106, yy); doc.text(doc.splitTextToSize(String(v2 || '–'), 42), M + 138, yy); }
        yy += 4.4;
      };
      row('Software version', c.sw, 'Product code:', c.code);
      row('Hardware version', c.hw, 'Serial number:', A(c.serial));
      row('Part number', fmtPart(c.part));
      y = yy + 5.5;
    });
    const apps = d.modes.filter((m) => m.configId && m.configId !== '0');
    if (apps.length) {
      if (y > PAGE_H - 50) { newPage(); y = 46; }
      y = section('Assistance modes', y);
      font(doc, 8.6, 'normal', C.ink); doc.text('Display name', M + 1, y); doc.text('Application number', M + 64, y); y += 5;
      apps.forEach((m) => {
        if (y > PAGE_H - 26) { newPage(); y = 46; }
        font(doc, 8.6, 'bold', C.ink); doc.text(String(m.name), M + 1, y); doc.text(String(m.configId), M + 64, y); y += 4.6;
      });
    }

    // ============================================================ optional – diagnostic results
    if (issues.length) {
      newPage();
      y = h1('Diagnostic results', 46);
      font(doc, 8.3, 'normal', C.ink2);
      doc.text('Error codes as shown in the Bosch apps. Detailed guidance is available in the Bosch eBike Help Center for each code.', M, y + 1);
      y += 7;
      const sevRgb = (sv) => (sv === 'CRITICAL_ERROR' || sv === 'ERROR' ? C.bad : sv === 'WARNING' ? C.warn : C.ink3);
      issues.forEach((it) => {
        const tw = CW - 10;
        font(doc, 8.4, 'normal', C.ink2);
        const desc = it.description ? doc.splitTextToSize(it.description, tw) : [];
        const meas = it.measures ? doc.splitTextToSize('What to do: ' + it.measures.replace(/\n+/g, ' '), tw) : [];
        const none = !it.title && !desc.length && !meas.length ? doc.splitTextToSize('No description bundled. See the Bosch eBike Help Center page for this code.', tw) : [];
        const h = 15 + (it.title ? 6 : 0) + (desc.length + meas.length + none.length) * 3.9 + 8;
        if (y + h > PAGE_H - 26) { newPage(); y = h1('Diagnostic results (continued)', 46); }
        card(M, y, CW, h);
        badge(M + 6, y + 6, it.severity === 'WARNING' || !it.severity ? 'warn' : 'bad');
        let yy = y + 7.2;
        const codeTxt = String(it.code || it.issueId);
        font(doc, 12, 'bold', C.ink); doc.text(codeTxt, M + 11, yy);
        let x2 = M + 11 + doc.getTextWidth(codeTxt) + 5;
        font(doc, 8.6, 'bold', C.ink); doc.text(String(it.componentDe || it.component), x2, yy);
        x2 += doc.getTextWidth(String(it.componentDe || it.component)) + 4;
        if (it.severityDe) { font(doc, 8.6, 'bold', sevRgb(it.severity)); doc.text(it.severityDe, x2, yy); }
        font(doc, 8, 'normal', C.ink2);
        doc.text(`${it.timestamp ? 'last ' + H.fmtDateTime(new Date(it.timestamp * 1000)) : ''}${it.activationCount != null ? ` · occurred ${it.activationCount}x` : ''}`, PAGE_W - M - 5, yy, { align: 'right' });
        yy += 7;
        if (it.title) { font(doc, 9.6, 'bold', C.ink); doc.text(doc.splitTextToSize(it.title, tw)[0], M + 5, yy); yy += 6; }
        font(doc, 8.4, 'normal', C.ink2);
        [...desc, ...meas, ...none].forEach((ln) => { doc.text(ln, M + 5, yy); yy += 3.9; });
        yy += 2.5;
        if (it.helpUrl) { font(doc, 7.8, 'normal', C.link); doc.textWithLink(it.helpUrl.replace('https://', ''), M + 5, yy, { url: it.helpUrl }); }
        y += h + 4;
      });
    }
    return doc;
  }

  window.Bes3WorkshopReport = { build };
  window.Bes3WorkshopPresentation = {
    cadenceFill, otherShare, withOtherSegment, otherEfficiency, probeRowHasValue, probeSummary,
    OTHER_COLOR, OTHER_NOTE, CADENCE_COLORS,
    COMPONENT_GLYPH_KEYS, hasComponentGlyph, drawComponentGlyph,
  };
})();
