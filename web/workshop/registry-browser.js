// BES3 Workshop – read-only address-registry browser
// The table is built from the existing generated registry. The only device
// action is the existing read path W.readKey(); there is no write control.
(function () {
  'use strict';

  const W = window.Bes3Workshop;
  const POLICY = window.Bes3WritePolicy;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_ROWS = 200;
  const state = { query: '' };

  function entries() {
    const reg = window.Bes3AddressRegistry && window.Bes3AddressRegistry.ADDRESS_REGISTRY;
    return reg && Array.isArray(reg.addresses) ? reg.addresses : [];
  }

  function registryMeta() {
    const reg = window.Bes3AddressRegistry && window.Bes3AddressRegistry.ADDRESS_REGISTRY;
    return reg && reg._meta && typeof reg._meta === 'object' ? reg._meta : {};
  }

  const SOURCE_FILE = 'src/address-registry.json';
  const GENERATED_FILE = 'src/address-registry.generated.js';
  const UPSTREAM_NAME = 'rweijnen/bosch-bes3-reader';
  const UPSTREAM_URL = 'https://github.com/rweijnen/bosch-bes3-reader';

  // The provenance block shown above the table. Values come from the registry
  // _meta block where available, with the reviewed upstream defaults otherwise.
  function sourceSummary() {
    const meta = registryMeta();
    const licence = meta.license || 'CC-BY-4.0';
    return {
      upstream: UPSTREAM_NAME,
      upstreamUrl: typeof meta.sourceUrl === 'string' && /^https?:\/\//i.test(meta.sourceUrl) ? meta.sourceUrl : UPSTREAM_URL,
      licence: licence === 'CC-BY-4.0' ? 'CC BY 4.0' : licence,
      sourceFile: SOURCE_FILE,
      generatedFile: GENERATED_FILE,
      count: entries().length,
      version: typeof meta.registryVersion === 'string' ? meta.registryVersion : null,
      attribution: typeof meta.attribution === 'string' ? meta.attribution : null,
    };
  }

  function tierFor(entry, tiers) {
    const key = entry.component + '.' + entry.name;
    return tiers.get(key) || { tier: 'blocked', reason: 'Not in the policy tier map.' };
  }

  function evidence(entry) {
    const status = entry.confirmed ? 'Confirmed' : 'Unconfirmed';
    return entry.source ? status + ' · ' + entry.source : status;
  }

  function address(entry) {
    return Number.isFinite(entry.address) ? '0x' + entry.address.toString(16) + ' (' + entry.address + ')' : '–';
  }

  function filter(query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    const list = entries();
    if (!q) return list;
    return list.filter((e) => {
      const hay = [e.component, e.name, e.label, address(e), e.kind, evidence(e), e.readable ? 'readable yes' : 'readable no']
        .map((v) => String(v == null ? '' : v).toLowerCase()).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }

  function rowHtml(entry, index, tiers, live) {
    const t = tierFor(entry, tiers);
    const canRead = entry.readable === true;
    const button = canRead
      ? '<button type="button" class="btn btn--ghost btn--sm" data-reg-read data-reg-row="' + index + '" data-component="' + esc(entry.component) + '" data-name="' + esc(entry.name) + '"' + (live ? '' : ' disabled title="Connect to an eBike or start the demo first"') + '>Read now</button>'
      : '<span class="muted">not readable</span>';
    return '<tr id="reg-row-' + index + '">'
      + '<td>' + esc(entry.component) + '</td>'
      + '<td class="mono">' + esc(entry.name) + '</td>'
      + '<td class="mono">' + esc(address(entry)) + '</td>'
      + '<td>' + esc(entry.kind || '–') + '</td>'
      + '<td title="' + esc(t.reason || '') + '">' + esc(t.tier) + '</td>'
      + '<td>' + esc(evidence(entry)) + '</td>'
      + '<td>' + (canRead ? 'yes' : 'no') + '</td>'
      + '<td>' + button + '</td>'
      + '<td data-reg-value="' + index + '">–</td>'
      + '</tr>';
  }

  function rowsHtml(query, tiers, live) {
    const list = filter(query);
    const shown = list.slice(0, MAX_ROWS);
    if (!shown.length) return '<tr><td colspan="9" class="muted">No registry entries match.</td></tr>';
    return shown.map((e, i) => rowHtml(e, i, tiers, live)).join('');
  }

  function render() {
    if (!POLICY || !POLICY.genericTierMap) {
      return '<div class="section"><p class="section__sub">The write-policy tier map is not loaded.</p></div>';
    }
    const tiers = POLICY.genericTierMap();
    const list = filter(state.query);
    const live = !!(W && W.isLive);
    const src = sourceSummary();
    return '<div class="section" id="registryBrowser"><div class="section__head"><div><h2 class="section__title">Address registry</h2>'
      + '<p class="section__sub">Search the existing registry. The only device action is a single read for a readable entry on a live connection; this view has no write controls.</p></div>'
      + '<button type="button" class="btn btn--ghost btn--sm" data-act="probeRemote">Probe remote registers</button></div>'
      + '<div class="card" id="registrySource" style="margin-bottom:12px"><dl class="kv">'
      + '<dt>Upstream project</dt><dd><a href="' + esc(src.upstreamUrl) + '" target="_blank" rel="noopener">' + esc(src.upstream) + '</a></dd>'
      + '<dt>Licence</dt><dd>' + esc(src.licence) + ' (attribution required)</dd>'
      + '<dt>Source file</dt><dd class="mono">' + esc(src.sourceFile) + '</dd>'
      + '<dt>Generated file</dt><dd class="mono">' + esc(src.generatedFile) + '</dd>'
      + '<dt>Entries</dt><dd>' + esc(String(src.count)) + '</dd>'
      + (src.version ? '<dt>Registry version</dt><dd class="mono">' + esc(src.version) + '</dd>' : '')
      + (src.attribution ? '<dt>Attribution</dt><dd>' + esc(src.attribution) + '</dd>' : '')
      + '</dl></div>'
      + '<div class="notice"><div><strong>Read-only.</strong> Tiers are shown from the existing write policy for context. They do not add a write button or grant.</div></div>'
      + '<label class="field__label" for="regSearch">Filter component, register, address, kind, tier or evidence</label>'
      + '<input class="input" id="regSearch" type="search" value="' + esc(state.query) + '" placeholder="e.g. Battery STATE_OF_HEALTH, 0x2210, high-impact">'
      + '<p class="field__hint" id="regCount">Showing ' + Math.min(list.length, MAX_ROWS) + ' of ' + list.length + ' entries' + (list.length > MAX_ROWS ? ' (narrow the search to see more)' : '') + '.</p>'
      + '<div class="table-wrap"><table class="t"><thead><tr><th>Component</th><th>Register</th><th>Address</th><th>Kind</th><th>Tier</th><th>Evidence</th><th>Readable</th><th>Read</th><th>Last read</th></tr></thead>'
      + '<tbody id="regRows">' + rowsHtml(state.query, tiers, live) + '</tbody></table></div></div>';
  }

  async function readNow(btn, root) {
    if (!W || !W.isLive || !W.readKey) return;
    const component = btn.dataset.component;
    const name = btn.dataset.name;
    const index = btn.dataset.regRow;
    const entry = entries().find((e) => e.component === component && e.name === name);
    if (!entry || entry.readable !== true) return;
    const cell = root && root.querySelector('[data-reg-value="' + index + '"]');
    try {
      const v = await W.readKey(component, name);
      if (cell) cell.textContent = v ? (v.display || v.status || 'read') : 'no response';
      btn.textContent = 'Read again';
    } catch (err) {
      if (cell) cell.textContent = 'error: ' + ((err && err.message) || String(err));
    }
  }

  function bindRows(root) {
    root.querySelectorAll('[data-reg-read]').forEach((btn) => {
      btn.onclick = () => readNow(btn, root);
    });
  }

  function mount(root) {
    if (!root) return;
    const input = root.querySelector('#regSearch');
    if (input) {
      input.oninput = () => {
        state.query = input.value;
        const tiers = POLICY.genericTierMap();
        const list = filter(state.query);
        const body = root.querySelector('#regRows');
        if (body) body.innerHTML = rowsHtml(state.query, tiers, !!(W && W.isLive));
        const count = root.querySelector('#regCount');
        if (count) count.textContent = 'Showing ' + Math.min(list.length, MAX_ROWS) + ' of ' + list.length + ' entries' + (list.length > MAX_ROWS ? ' (narrow the search to see more)' : '') + '.';
        bindRows(root);
      };
    }
    bindRows(root);
  }

  window.Bes3RegistryBrowser = { entries, filter, rowsHtml, render, mount, readNow, sourceSummary, MAX_ROWS };
})();
