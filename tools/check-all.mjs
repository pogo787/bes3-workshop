#!/usr/bin/env node
// BES3 Workshop – repository quality gate.
//
// Dependency-free (Node built-ins only). No child processes, no network, no
// writes. Every JavaScript file is parsed with vm.Script, which compiles the
// source without executing any of it.
//
// Checks:
//   a) syntax of every browser/CommonJS .js file under web/workshop, src and
//      node, plus the tools and web/*.js (parsed, never executed);
//   b) every <script src> in index.html resolves to a real file, and the
//      load order is write-policy.js -> engine.js -> ui.js;
//   c) no injected <script data-pplx-inline-edit> block in index.html;
//   d) the Bosch serial-number pattern is absent from text files (only the
//      file and line number are printed, never the matched text);
//   e) Markdown relative-link file targets in README.md, WORKSHOP.md and
//      docs/*.md exist;
//   f) every value interpolated into an innerHTML template is escaped, literal
//      or an explicitly allow-listed helper/fragment;
//   g) the bodies of allow-listed HTML builders are scanned too, including
//      their nested templates.
//
// Every finding blocks. There is no baseline/limitation escape hatch: a finding
// must be fixed rather than filed as a pre-existing exception.
//
//   node tools/check-all.mjs
//
// Exit code 0 = no findings, 1 = at least one finding.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const findings = [];
let passed = 0;

function rel(abs) { return path.relative(repo, abs).split(path.sep).join('/'); }

// Every finding blocks. There is no baseline/limitation escape hatch: a
// finding must be fixed rather than filed as a pre-existing exception.
function record(check, fileRel, line, message) {
  findings.push({ check, file: fileRel, line: line || null, message });
}

function walk(absDir, out) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
}

function jsFilesIn(absDir) {
  const out = [];
  if (!existsSync(absDir)) return out;
  walk(absDir, out);
  return out.filter((f) => f.endsWith('.js'));
}

// ---- a) syntax (parse only, never execute) --------------------------------
for (const file of [
  ...jsFilesIn(path.join(repo, 'web', 'workshop')),
  ...jsFilesIn(path.join(repo, 'src')),
  ...jsFilesIn(path.join(repo, 'node')),
]) {
  const fileRel = rel(file);
  const source = readFileSync(file, 'utf8');
  try {
    // eslint-disable-next-line no-new
    new vm.Script(source, { filename: fileRel });
    passed++;
  } catch (err) {
    record('syntax', fileRel, null, err.message);
  }
}
// The tools are CommonJS/ESM modules (they use import/export), which vm.Script
// cannot parse. The module syntax is removed and the rest is parsed as a
// script: this still catches every syntax error in the body of the file.
for (const file of readdirSync(path.join(repo, 'tools')).filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))) {
  const abs = path.join(repo, 'tools', file);
  const fileRel = rel(abs);
  const source = readFileSync(abs, 'utf8');
  const stripped = source
    .replace(/^#![^\n]*\n/, '')
    .replace(/import\.meta/g, '({ url: "" })')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'const __default = ')
    .replace(/^\s*export\s+(const|let|var|function|async|class)\s/gm, '$1 ')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  try {
    // eslint-disable-next-line no-new
    // The body is wrapped so that a top-level await (valid in a module) parses.
    new vm.Script('(async () => {\n' + stripped + '\n})()', { filename: fileRel });
    passed++;
  } catch (err) {
    record('syntax', fileRel, null, err.message);
  }
}
for (const entry of readdirSync(path.join(repo, 'web'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const abs = path.join(repo, 'web', entry.name);
  const fileRel = rel(abs);
  const source = readFileSync(abs, 'utf8');
  try {
    // eslint-disable-next-line no-new
    new vm.Script(source, { filename: fileRel });
    passed++;
  } catch (err) {
    record('syntax', fileRel, null, err.message);
  }
}

// ---- b) + c) index.html scripts -------------------------------------------
const appHtml = path.join(repo, 'index.html');
if (!existsSync(appHtml)) {
  record('app-html', 'index.html', null, 'index.html is missing');
} else {
  const html = readFileSync(appHtml, 'utf8');
  // Paths removed from the public release tree. A local resource referenced by
  // index.html must never be one of them, or the public page loads a 404.
  const excludeManifest = path.join(repo, 'tools', 'public-exclude.txt');
  const publicExclusions = existsSync(excludeManifest)
    ? readFileSync(excludeManifest, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
    : [];
  const isPublicExcluded = (relPath) => publicExclusions.some((rule) => (rule.endsWith('/') ? relPath.startsWith(rule) : relPath === rule));
  const resourceRe = /<(script|link|img|source)\b[^>]*\b(src|href)\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
  let m;
  while ((m = resourceRe.exec(html)) !== null) {
    const ref = (m[4] !== undefined ? m[4] : m[5]).trim();
    if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
    const relRef = ref.replace(/^\.\//, '').split('?')[0].split('#')[0];
    const line = html.slice(0, m.index).split('\n').length;
    if (isPublicExcluded(relRef)) {
      record('public-exclude-reference', 'index.html', line, 'index.html references a file removed from the public tree: ' + ref);
    }
  }
  const srcRe = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
  const seen = [];
  while ((m = srcRe.exec(html)) !== null) {
    const src = (m[2] !== undefined ? m[2] : m[3]).trim();
    if (/^[a-z]+:/i.test(src) || src.startsWith('//')) continue;
    const target = path.resolve(repo, src.split('?')[0].split('#')[0]);
    const line = html.slice(0, m.index).split('\n').length;
    if (existsSync(target)) passed++;
    else record('app-script-missing', 'index.html', line, '<script src> target does not exist: ' + src);
    seen.push({ src, index: m.index });
  }
  const orderAt = (name) => {
    const hit = seen.find((s) => s.src === name);
    return hit ? hit.index : -1;
  };
  const wp = orderAt('web/workshop/write-policy.js');
  const eng = orderAt('web/workshop/engine.js');
  const ui = orderAt('web/workshop/ui.js');
  if (wp >= 0 && eng >= 0 && wp < eng) passed++;
  else record('app-script-order', 'index.html', null, 'write-policy.js must load before engine.js');
  if (eng >= 0 && ui >= 0 && eng < ui) passed++;
  else record('app-script-order', 'index.html', null, 'engine.js must load before ui.js');

  if (/<script\b[^>]*\bdata-pplx-inline-edit\b/i.test(html)) {
    const line = html.slice(0, html.search(/<script\b[^>]*\bdata-pplx-inline-edit\b/i)).split('\n').length;
    record('pplx-inline-script', 'index.html', line, 'injected preview-editor script block present');
  } else {
    passed++;
  }
  if (/<(?:link|script)\b[^>]*(?:href|src)\s*=\s*["']https?:\/\//i.test(html)) {
    const line = html.slice(0, html.search(/<(?:link|script)\b[^>]*(?:href|src)\s*=\s*["']https?:\/\//i)).split('\n').length;
    record('external-subresource', 'index.html', line, 'index.html must not load external stylesheets, preconnects, or scripts over http(s)');
  } else {
    passed++;
  }
}

// ---- c2) no runtime-loading external URLs except the one photo constant ----
const ALLOWED_PHOTO_CONST_FILE = 'web/workshop/part-images.js';
const ALLOWED_PHOTO_CONST_URL = 'https://cdn.jsdelivr.net/gh/rweijnen/bosch-bes3-reader@cd9a5510ae1091c467d8d5a586a23723c17a9249/web/parts/';function findRuntimeExternalUrls(source, fileRel) {
  const hits = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const isAllowedConst =
      fileRel === ALLOWED_PHOTO_CONST_FILE &&
      /^\s*const\s+UPSTREAM_IMAGE_BASE\s*=\s*'https:\/\/cdn\.jsdelivr\.net\/gh\/rweijnen\/bosch-bes3-reader@cd9a5510ae1091c467d8d5a586a23723c17a9249\/web\/parts\/'\s*;\s*$/.test(raw);
    if (isAllowedConst) continue;
    if (
      /<(?:img|script|link|iframe|audio|video|source|embed|object)\b[^>]*(?:src|href|data)\s*=\s*["'`]https?:\/\//i.test(raw) ||
      /\bfetch\s*\(\s*["'`]https?:\/\//i.test(raw) ||
      /\bnew\s+(?:window\.)?Image\b[^\n;]*\.src\s*=\s*["'`]https?:\/\//i.test(raw) ||
      /\.src\s*=\s*["'`]https?:\/\//i.test(raw) ||
      /@import\s+(?:url\s*\(\s*)?["']?https?:\/\//i.test(raw) ||
      /\burl\s*\(\s*["']?https?:\/\//i.test(raw) ||
      /https?:\/\/cdn\.jsdelivr\.net\b/i.test(raw)
    ) {
      hits.push({ line: i + 1, text: trimmed.slice(0, 120) });
    }
  }
  return hits;
}
{
  const runtimeFiles = [
    ...(existsSync(appHtml) ? [appHtml] : []),
    ...(existsSync(path.join(repo, 'web', 'workshop', 'workshop.css')) ? [path.join(repo, 'web', 'workshop', 'workshop.css')] : []),
    ...jsFilesIn(path.join(repo, 'web', 'workshop')).filter((f) => path.basename(f) !== 'part-images-pdf.js'),
    ...readdirSync(path.join(repo, 'web')).filter((f) => f.endsWith('.js')).map((f) => path.join(repo, 'web', f)),
    ...jsFilesIn(path.join(repo, 'src')),
    ...jsFilesIn(path.join(repo, 'node')),
  ];
  let constCount = 0;
  for (const abs of runtimeFiles) {
    const fileRel = rel(abs);
    const source = readFileSync(abs, 'utf8');
    if (source.includes(ALLOWED_PHOTO_CONST_URL)) {
      const matches = source.split(ALLOWED_PHOTO_CONST_URL).length - 1;
      constCount += matches;
      if (fileRel !== ALLOWED_PHOTO_CONST_FILE) {
        record('external-runtime-url', fileRel, null, 'UPSTREAM_IMAGE_BASE URL may only appear in ' + ALLOWED_PHOTO_CONST_FILE);
      }
    }
    const hits = findRuntimeExternalUrls(source, fileRel);
    if (hits.length) {
      for (const h of hits) {
        record('external-runtime-url', fileRel, h.line, 'forbidden runtime-loading external URL: ' + h.text);
      }
    } else {
      passed++;
    }
  }
  if (constCount === 1) passed++;
  else record('external-runtime-url', ALLOWED_PHOTO_CONST_FILE, null, 'UPSTREAM_IMAGE_BASE URL must exist in exactly one constant (found ' + constCount + ')');

  // Self-test the runtime external-URL detector.
  if (
    findRuntimeExternalUrls('<img src="https://example.com/a.webp">', 'test.js').length === 1 &&
    findRuntimeExternalUrls('fetch("https://example.com/api")', 'test.js').length === 1 &&
    findRuntimeExternalUrls('const im = new Image(); im.src = "https://example.com/a.webp";', 'test.js').length === 1 &&
    findRuntimeExternalUrls('@import "https://example.com/a.css";', 'test.css').length === 1 &&
    findRuntimeExternalUrls('background: url(https://example.com/a.png);', 'test.css').length === 1 &&
    findRuntimeExternalUrls('<a href="https://help.bosch-ebike.com/en/help-center">Help</a>', 'test.js').length === 0 &&
    findRuntimeExternalUrls('const note = "Visit https://zadig.akeo.ie/ for WinUSB";', 'web/workshop/connection-doctor.js').length === 0
  ) {
    passed++;
  } else {
    record('external-runtime-url-rule', 'tools/check-all.mjs', null, 'runtime external-URL detector self-test failed');
  }
}

// ---- f) innerHTML escaping ------------------------------------------------
// Every value that is interpolated into an `innerHTML =` template must be
// escaped, a literal, or an explicitly allow-listed helper or fragment. The
// allow-list below is reviewed on purpose; there is no blanket exception.
//
// Allow-listed helpers: they either escape their argument or build markup from
// app-owned constants only.
const ESCAPING_HELPERS = ['esc', 'escNum', 'escColor'];
const SAFE_HELPERS = [
  'chip', 'chipsRow', 'opChip', 'experimentalChip', 'diffRow', 'issueCard', 'rawDetails',
  'connBanner', 'bikeSvg', 'partImg', 'photoLoadControl', 'opt', 'fmtDate', 'fmtDateTime', 'fmtKm', 'fmtW',
  'yesNo', 'versionLabel', 'kpi', 'serviceText', 'lightConfigLabel', 'summary', 'esc',
  'catalogBtn', 'stack', 'legend', 'compCards', 'remoteProbeTable', 'remoteProbeBlock', 'rowHtml', 'fmt',
  'pendingPanel', 'renderLogRow', 'renderLogHistory', 'serviceReasons',
];
// These allow-listed builders render device- or file-derived values. Their
// bodies are scanned as well, so an allow-list entry cannot hide an unescaped
// interpolation inside a nested template.
const SCANNED_HELPERS = ['compCards', 'remoteProbeTable', 'rowHtml', 'legend', 'stack', 'catalogBtn', 'modeRows', 'pendingPanel', 'renderLogRow', 'renderLogHistory', 'photoLoadControl', 'serviceReasons'];
// Allow-listed fragments: whole HTML fragments built by the app above (never
// raw device or file text).
const SAFE_FRAGMENTS = [
  'badge', 'extra', 'inner', 'ic', 'rows', 'compCards', 'resultsHtml', 'friendly',
  'banner', 'writeLabCard', 'authNotice', 'demoNote', 'modeRows', 'compChips',
  'reportUrl', 'stamp', 'stack', 'legend', 'bikeSvg', 'nextYear', 'statsNote',
  'img', 'emptyRows', 'batteryCard',
];
// Allow-listed member expressions: constants and numeric helpers.
const SAFE_MEMBERS = [
  /^ICON\./, /^NF[012]\.format\(/, /^Math\./, /^Number\(/, /^String\(/, /^Boolean\(/,
  /^Object\.keys\(/, /^Object\.entries\(/, /^Array\./, /^JSON\.stringify\(/,
  /^(['"`]).*\1\.repeat\(\d+\)$/, /^[\w$.]+\.toFixed\(\d+\)$/, /^Date\.now\(/,
  /\.toString\((16|10)?\)$/,
];
// Allow-listed plain numbers (loop counters and counters shown in the UI).
const SAFE_NUMBERS = ['index', 'total', 'i', 'n'];
// Allow-listed callback parameters of the app's own map/filter callbacks.
const SAFE_CALLBACKS = ['c', 'p', 'v', 'm', 'e', 's', 'x', 'k', 't', 'r', 'w', 'fmt', 'id'];
// Allow-listed collections the app iterates over (their items are escaped by
// the callback or by the builder that renders them).
const SAFE_COLLECTIONS = ['missingExtras', 'modes', 'steps', 'PRESETS', 'rows', 'filtered', 'entries', 'components', 'mappings'];

function templateInterpolations(src, allTemplates = false) {
  // The top-level ${...} expressions of a template literal, plus the ones of
  // nested template literals inside them. With allTemplates, every template
  // literal in the text is scanned, not only an `innerHTML =` assignment.
  const out = [];
  const scan = (text, lineOffset) => {
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') {
        // a nested template: scan it as well
        let j = i + 1;
        while (j < text.length && text[j] !== '`') { if (text[j] === '\\') j++; j++; }
        scan(text.slice(i + 1, j), lineOffset);
        i = j + 1;
        continue;
      }
      if (ch === '$' && text[i + 1] === '{') {
        let j = i + 2;
        let depth = 1;
        let inStr = null;
        while (j < text.length && depth > 0) {
          const c = text[j];
          if (inStr) {
            if (c === '\\') { j += 2; continue; }
            if (c === inStr) inStr = null;
            j++; continue;
          }
          if (c === '"' || c === "'" || c === '`') { inStr = c; j++; continue; }
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) break; }
          j++;
        }
        const expr = text.slice(i + 2, j);
        out.push({ expr, line: lineOffset + text.slice(0, i).split('\n').length });
        i = j + 1;
        continue;
      }
      i++;
    }
  };
  if (allTemplates) return allTemplateInterpolations(src);
  const re = /\.innerHTML\s*=\s*`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    // Find the end of the outer template literal, skipping interpolations
    // (which may contain nested template literals themselves).
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && src[i + 1] === '{') {
        let j = i + 2;
        let d = 1;
        let inStr = null;
        while (j < src.length && d > 0) {
          const cc = src[j];
          if (inStr) {
            if (cc === '\\') { j += 2; continue; }
            if (cc === inStr) inStr = null;
            j++; continue;
          }
          if (cc === '"' || cc === "'" || cc === '`') { inStr = cc; j++; continue; }
          if (cc === '{') d++;
          else if (cc === '}') { d--; if (d === 0) break; }
          j++;
        }
        i = j + 1;
        continue;
      }
      if (c === '`') break;
      i++;
    }
    scan(src.slice(start, i), src.slice(0, start).split('\n').length);
    re.lastIndex = i;
  }
  return out;
}

function allTemplateInterpolations(text, lineOffset = 1) {
  // Every ${...} expression in every template literal, including templates
  // nested inside an interpolation. The robust brace scanner keeps a ternary
  // with a nested template in one piece.
  const out = [];
  let i = 0;
  let line = lineOffset;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const j = skipComment(text, i);
      line += text.slice(i, j).split('\n').length - 1;
      i = j;
      continue;
    }
    if (c !== '`') { i++; continue; }
    i++;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\n') { line++; i++; continue; }
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { i++; break; }
      if (ch === '$' && text[i + 1] === '{') {
        const exprStart = i + 2;
        const exprEnd = skipBracedAt(text, exprStart);
        const expr = text.slice(exprStart, exprEnd - 1);
        out.push({ expr, line });
        out.push(...allTemplateInterpolations(expr, line));
        line += expr.split('\n').length - 1;
        i = exprEnd;
        continue;
      }
      i++;
    }
  }
  return out;
}

function nestedTemplateItems(text) {
  // Every ${...} expression inside the template literals of a text.
  const items = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let j = i + 1;
      let inStr = null;
      while (j < text.length) {
        const cc = text[j];
        if (inStr) {
          if (cc === '\\') { j += 2; continue; }
          if (cc === inStr) inStr = null;
          j++; continue;
        }
        if (cc === '"' || cc === "'" || cc === '`') { inStr = cc; j++; continue; }
        if (cc === '$' && text[j + 1] === '{') {
          let k = j + 2;
          let d = 1;
          while (k < text.length && d > 0) {
            const c3 = text[k];
            if (c3 === '{') d++;
            else if (c3 === '}') { d--; if (d === 0) break; }
            k++;
          }
          items.push(text.slice(j + 2, k));
          j = k + 1;
          continue;
        }
        if (cc === '`') break;
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return items;
}

function stripTemplates(text) {
  // Removes every template literal (including nested ones) from a text.
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (c === '`') {
      let j = i + 1;
      while (j < text.length) {
        const cc = text[j];
        if (cc === '\\') { j += 2; continue; }
        if (cc === '`') { j++; break; }
        if (cc === '$' && text[j + 1] === '{') {
          let k = j + 2;
          let d = 1;
          while (k < text.length && d > 0) {
            const c3 = text[k];
            if (c3 === '{') d++;
            else if (c3 === '}') { d--; if (d === 0) break; }
            k++;
          }
          j = k + 1;
          continue;
        }
        j++;
      }
      out += ' ';
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function topLevelTernary(expr) {
  // Returns [condition, then, else] for a ternary at the top level. Strings,
  // template literals and nested brackets are skipped, so the branches can be
  // checked independently of a complex condition.
  let i = 0;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let q = -1;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(expr, i); continue; }
    if (c === '/' && (expr[i + 1] === '/' || expr[i + 1] === '*')) { i = skipComment(expr, i); continue; }
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
    else if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '?' && parens === 0 && brackets === 0 && braces === 0) { q = i; break; }
    i++;
  }
  if (q === -1) return null;
  let depth = 0;
  let nested = 0;
  i = q + 1;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(expr, i); continue; }
    if (c === '/' && (expr[i + 1] === '/' || expr[i + 1] === '*')) { i = skipComment(expr, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '?') nested++;
    else if (depth === 0 && c === ':') {
      if (nested === 0) return [expr.slice(0, q), expr.slice(q + 1, i), expr.slice(i + 1)];
      nested--;
    }
    i++;
  }
  return null;
}

function interpolationIsSafe(expr) {
  const e0 = expr.replace(/\s+/g, ' ').trim();
  if (!e0) return true;
  const unparen = (x) => x.trim().replace(/^\((.*)\)$/s, '$1').trim();
  const ternary = topLevelTernary(e0);
  if (ternary) {
    // The condition is a boolean. Both rendered branches must be safe.
    return interpolationIsSafe(unparen(ternary[1])) && interpolationIsSafe(unparen(ternary[2]));
  }
  // A nested template literal: every interpolation inside it must be safe.
  let e = e0;
  if (e.includes('`')) {
    const items = nestedTemplateItems(e);
    if (!items.every((x) => interpolationIsSafe(x))) return false;
    // the rest of the expression (the call around the template) is checked below
    e = stripTemplates(e).replace(/\s+/g, ' ').trim();
    if (!e) return true;
    // an app-owned builder that escapes its own arguments
    const code0 = e.replace(/'[^']*'/g, '""').replace(/"[^"]*"/g, '""');
    for (const h of SAFE_HELPERS) {
      if (new RegExp('(^|[^\\w$.])' + h + '\\b').test(code0)) return true;
    }
    // a call over an app-owned collection whose items are escaped inside the
    // template (e.g. `items.map((c) => \`${esc(c.x)}\`)`)
    if (/\.(map|filter|forEach|join)\(/.test(e)) return true;
  }
  // a literal
  if (/^(['"]).*\1$/s.test(e)) return true;
  if (/^-?\d+(\.\d+)?$/.test(e)) return true;
  if (/^(true|false|null|undefined)$/.test(e)) return true;
  for (const h of ESCAPING_HELPERS) if (e.startsWith(h + '(')) return true;
  // an app-owned builder: called, or passed as a callback (e.g. `.map(issueCard)`)
  const code = e.replace(/'[^']*'/g, '""').replace(/"[^"]*"/g, '""');
  for (const h of SAFE_HELPERS) {
    if (new RegExp('(^|[^\\w$.])' + h + '\\b').test(code)) return true;
  }
  for (const m of SAFE_MEMBERS) if (m.test(e)) return true;
  // a plain identifier from the allow-list of app-built fragments
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    return SAFE_FRAGMENTS.includes(e) || SAFE_NUMBERS.includes(e)
      || SAFE_CALLBACKS.includes(e) || SAFE_COLLECTIONS.includes(e);
  }
  // simple arithmetic on allow-listed counters (e.g. `index + 1`)
  const arith = /^([A-Za-z_$][\w$]*)\s*([+\-*/])\s*(\d+)$/.exec(e);
  if (arith && SAFE_NUMBERS.includes(arith[1])) return true;
  // a comparison yields a boolean: it cannot inject markup
  if (/[=!]==?|[<>]=?/.test(e) && !/[`'"$]/.test(e)) return true;
  // a member access on an allow-listed fragment (e.g. `badge.length`)
  const member = /^([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*$/.exec(e);
  if (member && SAFE_FRAGMENTS.includes(member[1])) return true;
  // a ternary: both branches must be safe
  const q = e.indexOf('?');
  if (q > -1) {
    const cond = e.slice(0, q);
    const rest = e.slice(q + 1);
    // find the matching ':' of the ternary (skipping nested ternaries and
    // anything inside a string or a nested template literal)
    let depth = 0;
    let colon = -1;
    let inStr = null;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '$' && rest[i + 1] === '{') {
        // skip the whole interpolation (it may contain nested templates)
        let j = i + 2;
        let d = 1;
        while (j < rest.length && d > 0) {
          const cc = rest[j];
          if (cc === '{') d++;
          else if (cc === '}') { d--; if (d === 0) break; }
          j++;
        }
        i = j;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === '?' && depth === 0) {
        // a nested ternary: skip to its ':'
        let d2 = 0;
        let inStr2 = null;
        for (let k = i + 1; k < rest.length; k++) {
          const c2 = rest[k];
          if (inStr2) { if (c2 === '\\') { k++; continue; } if (c2 === inStr2) inStr2 = null; continue; }
          if (c2 === '"' || c2 === "'" || c2 === '`') { inStr2 = c2; continue; }
          if (c2 === '(' || c2 === '[' || c2 === '{') d2++;
          else if (c2 === ')' || c2 === ']' || c2 === '}') d2--;
          else if (c2 === ':' && d2 === 0) { i = k; break; }
        }
        continue;
      } else if (c === ':' && depth === 0) { colon = i; break; }
    }
    if (colon > -1) {
      const a = unparen(rest.slice(0, colon));
      const b = unparen(rest.slice(colon + 1));
      return interpolationIsSafe(a) && interpolationIsSafe(b);
    }
  }
  // a logical expression: both sides must be safe. A bare member access is a
  // boolean operand inside a logical expression.
  const or = e.split('||');
  if (or.length > 1) {
    return or.every((part) => {
      const p = unparen(part);
      return interpolationIsSafe(p) || /^[\w$]+\.[\w$]+$/.test(p);
    });
  }
  const and = e.split('&&');
  if (and.length > 1) {
    return and.every((part) => {
      const p = unparen(part);
      return interpolationIsSafe(p) || /^[\w$]+\.[\w$]+$/.test(p);
    });
  }
  // An expression that contains an escaping helper call is safe when every
  // other free identifier is allow-listed: the escaped argument cannot inject
  // markup, and the rest is app-owned data.
  let rest = e;
  let foundEscaper = false;
  for (const helper of ESCAPING_HELPERS) {
    let at = rest.indexOf(helper + '(');
    while (at !== -1) {
      foundEscaper = true;
      let depth = 1;
      let j = at + helper.length + 1;
      while (j < rest.length && depth > 0) {
        if (rest[j] === '(') depth++;
        else if (rest[j] === ')') { depth--; if (depth === 0) break; }
        j++;
      }
      rest = rest.slice(0, at) + rest.slice(j + 1);
      at = rest.indexOf(helper + '(');
    }
  }
  if (foundEscaper) {
    const free = rest.match(/[A-Za-z_$][\w$]*/g) || [];
    return free.every((id) => SAFE_FRAGMENTS.includes(id) || SAFE_NUMBERS.includes(id)
      || SAFE_CALLBACKS.includes(id) || SAFE_COLLECTIONS.includes(id)
      // a name that is used as a property (x.y) or a call (x()) is not free
      || new RegExp('(^|[^\\w$.])' + id + '\\s*\\(').test(rest)
      || new RegExp('\\.' + id + '\\b').test(rest));
  }
  // an expression that calls an app-owned builder that escapes its own input
  for (const h of SAFE_HELPERS) {
    if (new RegExp('(^|[^\\w$.])' + h + '\\(').test(e)) return true;
  }
  return false;
}

// The body of a named function or const binding, used to scan allow-listed
// HTML builders. The scanner skips strings, template literals and comments so a
// brace in rendered markup cannot end the body early.
function skipQuoted(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (quote === '`' && c === '$' && text[i + 1] === '{') {
      i = skipBracedAt(text, i + 2);
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return i;
}
function skipComment(text, i) {
  if (text[i] !== '/') return i;
  if (text[i + 1] === '/') {
    const end = text.indexOf('\n', i + 2);
    return end === -1 ? text.length : end;
  }
  if (text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i;
}
function skipBracedAt(text, i) {
  // i points just after the opening brace.
  let depth = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(text, i); continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) { i = skipComment(text, i); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}
function bindingSource(src, name) {
  const functionAt = src.search(new RegExp('function\\s+' + name + '\\s*\\('));
  const constAt = src.search(new RegExp('(?:const|let|var)\\s+' + name + '\\s*='));
  let start = -1;
  let isFunction = false;
  if (functionAt !== -1 && (constAt === -1 || functionAt < constAt)) { start = functionAt; isFunction = true; }
  else if (constAt !== -1) start = constAt;
  if (start === -1) return '';
  if (isFunction) {
    const brace = src.indexOf('{', start);
    if (brace === -1) return '';
    return src.slice(start, skipBracedAt(src, brace + 1));
  }
  const eq = src.indexOf('=', start);
  if (eq === -1) return '';
  let i = eq + 1;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(src, i); continue; }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { i = skipComment(src, i); continue; }
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
    else if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === ';' && parens === 0 && brackets === 0 && braces === 0) return src.slice(start, i + 1);
    i++;
  }
  return src.slice(start);
}

for (const file of jsFilesIn(path.join(repo, 'web', 'workshop'))) {
  const fileRel = rel(file);
  const source = readFileSync(file, 'utf8');
  const items = templateInterpolations(source);
  let bad = 0;
  for (const item of items) {
    if (interpolationIsSafe(item.expr)) continue;
    bad++;
    record('html-escape', fileRel, item.line,
      'value interpolated into innerHTML without escaping: ' + item.expr.replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  if (!bad) passed++;
}

// Batch 8 feature modules are new plain scripts. Scan every template literal
// in them, not only an `innerHTML =` assignment, so a builder that returns
// markup cannot bypass the escaping rule.
const FEATURE_HTML_FILES = [
  'connection-doctor.js', 'battery-health.js', 'registry-browser.js',
];
for (const name of FEATURE_HTML_FILES) {
  const file = path.join(repo, 'web', 'workshop', name);
  if (!existsSync(file)) continue;
  const fileRel = rel(file);
  const source = readFileSync(file, 'utf8');
  let bad = 0;
  for (const item of allTemplateInterpolations(source)) {
    if (interpolationIsSafe(item.expr)) continue;
    bad++;
    record('html-escape', fileRel, item.line,
      'feature template interpolation without escaping: ' + item.expr.replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  if (!bad) passed++;
}

// Allow-listed builders are only safe if their own bodies escape every
// interpolation. Scan the real binding, including nested templates.
for (const name of SCANNED_HELPERS) {
  const file = path.join(repo, 'web', 'workshop', 'ui.js');
  const fileRel = rel(file);
  const source = readFileSync(file, 'utf8');
  const body = bindingSource(source, name);
  if (!body) {
    record('html-escape-helper', fileRel, null, 'allow-listed helper body not found: ' + name);
    continue;
  }
  const start = source.indexOf(body.slice(0, Math.min(body.length, 40)));
  const lineOffset = source.slice(0, start).split('\n').length - 1;
  let bad = 0;
  for (const item of templateInterpolations(body, true)) {
    if (interpolationIsSafe(item.expr)) continue;
    bad++;
    record('html-escape-helper', fileRel, item.line + lineOffset,
      'allow-listed helper ' + name + ' has an unescaped interpolation: ' + item.expr.replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  if (!bad) passed++;
}

// The escaping rule must actually catch an unescaped interpolation (it is not
// a rule that passes everything).
if (interpolationIsSafe('d.duId') || !interpolationIsSafe('esc(d.duId)') || !interpolationIsSafe('escNum(d.soc)')) {
  record('html-escape-rule', 'tools/check-all.mjs', null, 'the innerHTML escaping rule does not behave as expected');
} else {
  passed++;
}
const helperFixture = 'const modeRows = d.modes.map((m) => `<td>${m.udam.maximumMotorTorque}</td>`).join("");';
const helperBody = bindingSource(helperFixture, 'modeRows');
const helperUnsafe = helperBody
  && templateInterpolations(helperBody, true).some((item) => !interpolationIsSafe(item.expr));
const helperSafeFixture = 'const modeRows = d.modes.map((m) => `<td>${escNum(m.udam.maximumMotorTorque)}</td>`).join("");';
const helperSafeBody = bindingSource(helperSafeFixture, 'modeRows');
const helperSafe = helperSafeBody
  && templateInterpolations(helperSafeBody, true).every((item) => interpolationIsSafe(item.expr));
if (!helperBody || !helperUnsafe || !helperSafeBody || !helperSafe) {
  record('html-escape-helper-rule', 'tools/check-all.mjs', null, 'the allow-listed helper body check does not behave as expected');
} else {
  passed++;
}

// ---- d) Bosch serial pattern ----------------------------------------------
const SERIAL_RE = /\d{5}-\d{4}-\d{2}-[A-Z0-9]{3}-\d{2}-[A-Z0-9]{4}/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'reviews']);
const SKIP_SUBDIRS = ['web/parts/', 'web/vendor/'];
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.jar', '.apk', '.bin', '.exe', '.dll', '.so', '.mp4', '.mp3']);
let serialScannedFiles = 0;
const allFiles = [];
for (const entry of readdirSync(repo, { withFileTypes: true })) {
  if (entry.name === '.git' || SKIP_DIRS.has(entry.name)) continue;
  const abs = path.join(repo, entry.name);
  if (entry.isDirectory()) {
    const sub = [];
    walk(abs, sub);
    allFiles.push(...sub);
  } else if (entry.isFile()) {
    allFiles.push(abs);
  }
}
for (const abs of allFiles) {
  const fileRel = rel(abs);
  if (SKIP_DIRS.has(fileRel.split('/')[0])) continue;
  if (SKIP_SUBDIRS.some((p) => fileRel.startsWith(p))) continue;
  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) continue;
  let source;
  try { source = readFileSync(abs, 'utf8'); } catch (_) { continue; }
  if (source.indexOf('\u0000') !== -1) continue; // binary
  serialScannedFiles++;
  const lines = source.split(/\r?\n/);
  let hit = false;
  for (let i = 0; i < lines.length; i++) {
    if (SERIAL_RE.test(lines[i])) {
      hit = true;
      record('bosch-serial', fileRel, i + 1, 'Bosch serial pattern present');
    }
  }
  if (!hit) passed++;
}

// ---- e) Markdown relative links -------------------------------------------
function markdownFiles() {
  const out = [];
  for (const name of ['README.md', 'WORKSHOP.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md']) {
    const abs = path.join(repo, name);
    if (existsSync(abs)) out.push(abs);
  }
  const docsDir = path.join(repo, 'docs');
  if (existsSync(docsDir)) {
    for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(path.join(docsDir, entry.name));
    }
  }
  return out;
}
const internalDocsDir = path.join(repo, 'docs', 'internal');
for (const abs of markdownFiles()) {
  const fileRel = rel(abs);
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let lm;
    linkRe.lastIndex = 0;
    while ((lm = linkRe.exec(lines[i])) !== null) {
      let target = lm[1].trim();
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
      target = target.replace(/\s+["'(].*$/, '').trim();
      if (!target) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:, data:, ...
      if (target.startsWith('//')) continue;
      const hash = target.indexOf('#');
      const filePart = (hash === -1 ? target : target.slice(0, hash)).split('?')[0];
      if (!filePart) continue; // pure in-page anchor; anchors are not validated
      const resolved = path.resolve(path.dirname(abs), decodeURIComponent(filePart));
      if (resolved === internalDocsDir || resolved.startsWith(internalDocsDir + path.sep)) {
        record('markdown-internal-link', fileRel, i + 1, 'public doc must not link into docs/internal: ' + filePart);
      } else if (existsSync(resolved)) {
        passed++;
      } else {
        record('markdown-link', fileRel, i + 1, 'relative link target does not exist: ' + filePart);
      }
    }
  }
}

// ---- report ---------------------------------------------------------------
console.log('BES3 Workshop repository quality gate');
console.log('');
console.log('  checks passed: ' + passed);
console.log('  blocking findings: ' + findings.length);
console.log('  serial-scan: ' + serialScannedFiles + ' text files');
console.log('');
if (findings.length) {
  console.log('Blocking findings:');
  for (const f of findings) {
    console.log('  FAIL  [' + f.check + '] ' + f.file + (f.line ? ':' + f.line : '') + ' — ' + f.message);
  }
  console.log('');
  console.log(findings.length + ' blocking finding(s).');
  process.exit(1);
}
console.log('OK — no blocking findings.');
process.exit(0);
