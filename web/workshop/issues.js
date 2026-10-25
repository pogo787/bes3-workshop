// BES3 Workshop – Human-readable error codes for Bosch Smart System (BES3).
//
// Each fault memory entry returned by the bike only contains a numeric `issueId`, timestamp, and count.
// Bosch displays `issueId` in 6-digit hexadecimal: e.g. issueId 1122304 = 0x112000 -> "112000".
// Human-readable descriptions live in Bosch's apps rather than the bike firmware. Therefore we provide:
//   1. A built-in English reference table of common BES3 error codes (summarized from help.bosch-ebike.com),
//   2. Optional import of a user-supplied Bosch catalog (`issues_<lang>_Rider.json`, persisted in localStorage),
//   3. A direct link to the official Bosch eBike Help Center page for every code.
(function () {
  'use strict';

  const COMPONENT_DE = {
    DriveUnit: 'Drive Unit',
    Battery: 'Battery',
    Battery2: 'Second Battery',
    RemoteControl: 'Control Unit',
    HeadUnit: 'Display',
    ConnectModule: 'ConnectModule',
    AntiLockBrakeSystem: 'ABS',
    GearShift: 'Gear Shift (eShift)',
  };

  // Concise English summaries based on https://help.bosch-ebike.com/en/help-center/error/<code>
  const BUILTIN = {
    '111000': {
      severity: 'ERROR',
      title: 'Control unit: internal software error',
      description: 'An internal software error occurred in the control unit; assistance may be disabled.',
      measures: 'Restart the eBike and check for software updates in the eBike Flow app.',
    },
    '112000': {
      severity: 'ERROR',
      title: 'Control unit: smartphone connection failed',
      description: 'An error occurred while pairing or connecting the smartphone to the eBike.',
      measures: 'Log out and back in to the eBike Flow app and reconnect the smartphone. If that does not help, reinstall the app, restart the eBike, and pair again. If the issue persists, contact an authorized dealer.',
    },
    '112001': {
      severity: 'ERROR',
      title: 'Control unit: invalid eBike configuration',
      description: 'The configuration backup copy is missing in the control unit, typically after replacing the control unit.',
      measures: 'Acknowledge the error; the eBike remains usable. Check the eBike Flow app regularly for updates.',
    },
    '112002': {
      severity: 'ERROR',
      title: 'Control unit: configuration error / ID mismatch',
      description: 'The control unit reports a configuration or System ID mismatch; functionality may be restricted.',
      measures: 'Verify System IDs (DriveUnit vs. RemoteControl) or contact an authorized dealer.',
    },
    '113100': {
      severity: 'WARNING',
      title: 'Mini Remote: coin cell battery low',
      description: 'The CR1620 battery in the wireless Mini Remote is nearly depleted.',
      measures: 'Replace the coin cell battery (CR1620) in the Mini Remote promptly.',
    },
    '113112': {
      severity: 'CRITICAL_ERROR',
      title: 'Control unit: memory error',
      description: 'Motor assistance may be unavailable and the eBike may shut down.',
      measures: 'Contact an authorized Bosch eBike dealer.',
    },
    '213100': {
      severity: 'WARNING',
      title: 'Display: internal battery voltage low',
      description: 'The internal coin cell battery of the display (e.g. Intuvia 100) is running low.',
      measures: 'Replace the display coin cell battery.',
    },
    '312001': {
      severity: 'WARNING',
      title: 'Battery: temperature outside charging range',
      description: 'The battery temperature is too high or too low for charging.',
      measures: 'Allow the battery to return to room temperature before charging.',
    },
    '504000': {
      severity: 'WARNING',
      title: 'Drive unit: manipulation / speed sensor plausibility',
      description: 'Implausible signals were detected at the speed sensor.',
      measures: 'Check spoke/rim magnet position and sensor clearance; remove any third-party tuning devices.',
    },
    '523001': {
      severity: 'WARNING',
      title: 'Speed sensor: no signal',
      description: 'The drive unit is not receiving a valid signal from the speed sensor.',
      measures: 'Check the magnet position and speed sensor alignment.',
    },
    '523005': {
      severity: 'WARNING',
      title: 'Drive unit: sensor warning',
      description: 'Power output may be reduced and speed may not be displayed accurately.',
      measures: 'Check the mounting of the speed sensor and magnet, then restart the eBike. If the issue persists, contact an authorized dealer.',
    },
    '546001': {
      severity: 'WARNING',
      title: 'Bike light: electrical fault at light output',
      description: 'A short circuit, overload, or implausible current draw was detected at the light output.',
      measures: 'Check light wiring, connectors, and configured wattage rating.',
    },
  };

  const SEVERITY_DE = { CRITICAL_ERROR: 'Critical Error', ERROR: 'Error', WARNING: 'Warning', INFO: 'Info' };
  const STORE_KEY = 'bes3-workshop-issue-catalog';

  let userCatalog = null; // {name, issues}
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) userCatalog = JSON.parse(raw);
  } catch (_) { userCatalog = null; }

  function code(issueId) {
    if (issueId == null) return null;
    return Number(issueId).toString(16).toUpperCase().padStart(6, '0');
  }

  function strip(html) {
    if (html == null) return '';
    return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li)>/gi, '\n').replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
  }

  function lookup(issueId) {
    const c = code(issueId);
    if (!c) return null;
    const helpUrl = `https://help.bosch-ebike.com/en/help-center/error/${c}`;
    if (userCatalog && userCatalog.issues) {
      const e = userCatalog.issues[c] || userCatalog.issues[c.replace(/^0+/, '')];
      if (e) {
        return {
          code: c, helpUrl, source: userCatalog.name || 'Custom Catalog',
          severity: e.severity || null,
          title: strip(e.AppRiderErrorTitle || e.title || e.component_name || ''),
          description: strip(e.description || ''),
          measures: strip(e.measures || ''),
        };
      }
    }
    const b = BUILTIN[c];
    if (b) return { code: c, helpUrl, source: 'Bosch eBike Help Center', ...b };
    return { code: c, helpUrl, source: null, severity: null, title: '', description: '', measures: '' };
  }

  function enrich(issue) {
    const info = lookup(issue.issueId) || {};
    return {
      ...issue,
      code: info.code || null,
      componentDe: COMPONENT_DE[issue.component] || issue.component,
      severity: info.severity || null,
      severityDe: info.severity ? (SEVERITY_DE[info.severity] || info.severity) : null,
      title: info.title || '',
      description: info.description || '',
      measures: info.measures || '',
      helpUrl: info.helpUrl || null,
      source: info.source || null,
    };
  }

  function setUserCatalog(name, data) {
    const issues = data && (data.issues || data);
    if (!issues || typeof issues !== 'object' || !Object.keys(issues).length) throw new Error('File does not contain a valid error catalog (missing "issues" object).');
    userCatalog = { name, issues };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(userCatalog)); } catch (_) { /* session only if too large */ }
    return Object.keys(issues).length;
  }
  function clearUserCatalog() { userCatalog = null; try { localStorage.removeItem(STORE_KEY); } catch (_) { /* ignore */ } }
  function catalogInfo() { return userCatalog ? { name: userCatalog.name, count: Object.keys(userCatalog.issues).length } : null; }

  window.Bes3Issues = { code, lookup, enrich, setUserCatalog, clearUserCatalog, catalogInfo, COMPONENT_DE };
})();
