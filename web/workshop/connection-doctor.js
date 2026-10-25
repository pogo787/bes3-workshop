// BES3 Workshop – connection doctor (read-only)
// Classifies a failed WebUSB connect using only the error object and the
// session state that engine.js/ui.js already expose. It never opens a device,
// sends a frame or changes a transport.
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const UDEV_RULE = [
    '# Bosch eBike USB (vendor id 108c) – run once, then replug the eBike',
    'SUBSYSTEM=="usb", ATTR{idVendor}=="108c", MODE="0666"',
  ].join('\n');

  const ZADIG_STEPS = [
    '1. Install and open Zadig (https://zadig.akeo.ie/).',
    '2. Switch the eBike on and connect the USB data cable.',
    '3. In Zadig, choose Options > List All Devices.',
    '4. Select the Bosch eBike interface (vendor id 108c).',
    '5. Choose WinUSB as the driver and click Replace Driver.',
    '6. Replug the eBike, then close other diagnostic tools and retry.',
  ].join('\n');

  const GENERIC = {
    id: 'generic',
    title: 'The connection could not be completed',
    summary: 'No specific cause was reported. Work through the checklist below; the readout and the rest of the Workshop stay read-only until a session opens.',
    failed: ['The browser did not complete the USB session.'],
    steps: [
      'Switch the eBike on and keep it awake.',
      'Use a USB data cable, not a charge-only cable.',
      'Close other diagnostic tools and browser tabs that may own the interface.',
      'Replug the cable and retry. On Windows, check the WinUSB driver with Zadig.',
      'On Linux, install the udev rule below and replug the eBike.',
    ],
  };

  function messageOf(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    return String(err.message || err.name || err);
  }

  function classify(err, state) {
    const name = err && err.name ? String(err.name) : '';
    const message = messageOf(err);
    const low = message.toLowerCase();
    const lost = !!(state && state.connectionLost);

    if (name === 'NotFoundError' || name === 'AbortError' || /no device selected|picker.*cancel|cancel.*picker/.test(low)) {
      return {
        id: 'picker-cancelled',
        title: 'No device was selected',
        summary: 'The browser device picker closed without a selection, so no USB session was opened.',
        failed: ['The device picker was cancelled or returned no device.'],
        steps: [
          'Click Connect again and select the Bosch eBike interface in the picker.',
          'If no interface is listed, check the cable, switch the eBike on and replug it.',
          'On Windows, bind WinUSB with Zadig if the interface is still missing.',
          'On Linux, install the udev rule below and replug the eBike.',
        ],
      };
    }

    if (name === 'SecurityError' || /access denied|permission|not allowed|blocked by/i.test(low)) {
      return {
        id: 'access-denied',
        title: 'USB access was denied',
        summary: 'The browser or the operating system refused access to the USB interface. No read or write frame was sent.',
        failed: ['The browser reported a security or permission error.'],
        steps: [
          'Allow USB device access for this page and retry.',
          'Close other software that may own the eBike interface.',
          'On Linux, install the udev rule below (vendor id 108c) and replug the eBike.',
          'On Windows, bind the interface to WinUSB with Zadig.',
        ],
      };
    }

    if (/claim|interface.*busy|failed to claim|could not claim/i.test(low)) {
      return {
        id: 'claim-failed',
        title: 'The USB interface could not be claimed',
        summary: 'The device opened, but the browser could not claim its interface. Another program usually holds it.',
        failed: ['Claiming the USB interface failed.'],
        steps: [
          'Close every other tool that can access the eBike (including other browser tabs).',
          'Unplug and replug the eBike, then retry.',
          'On Windows, check the WinUSB binding with Zadig.',
          'On Linux, install the udev rule below so the interface is accessible.',
        ],
      };
    }

    if (name === 'NetworkError' || /open failed|failed to open|could not open|unable to open|device busy|resource busy/i.test(low)) {
      return {
        id: 'open-failed',
        title: 'The USB device could not be opened',
        summary: 'The browser found the interface but could not open it. Another program or driver may own it, or the cable may have dropped.',
        failed: ['Opening the USB interface failed.'],
        steps: [
          'Close other diagnostic tools, browser tabs and virtual-machine USB passthrough.',
          'Replug the USB data cable and retry.',
          'On Windows, bind the interface to WinUSB with Zadig.',
          'On Linux, install the udev rule below and replug the eBike.',
        ],
      };
    }

    if (/timeout|timed out|no answer|no response|first read/i.test(low)) {
      return {
        id: 'no-answer',
        title: 'The eBike did not answer',
        summary: 'The session opened but the first read did not complete. The eBike may be asleep, the cable may be charge-only, or the protocol did not answer.',
        failed: ['No answer arrived for the first read.'],
        steps: [
          'Switch the eBike on and keep it awake during the read.',
          'Use a USB data cable and replug it at both ends.',
          'Close other diagnostic tools and retry.',
          'If the connection drops again, export the debug log and report the last step shown.',
        ],
      };
    }

    if (lost) {
      return {
        id: 'connection-lost',
        title: 'The connection was lost',
        summary: 'An existing session stopped responding. The last readout stays visible and configuration stays locked.',
        failed: ['The eBike stopped responding during the session.'],
        steps: [
          'Switch the eBike on and reconnect.',
          'Check the cable and avoid moving the bike during a read.',
          'Retry the read-only session before any configuration change.',
        ],
      };
    }

    return Object.assign({}, GENERIC, { message });
  }

  function list(items) {
    return items.map((item) => `<li>${esc(item)}</li>`).join('');
  }

  function render(err, state) {
    const c = classify(err, state);
    const detail = c.message && c.message !== c.summary
      ? `<p class="field__hint">Reported: <span class="mono">${esc(c.message)}</span></p>`
      : '';
    return '<div class="notice notice--warn"><div><strong>' + esc(c.title) + '</strong><p style="margin:6px 0 0">' + esc(c.summary) + '</p>' + detail + '</div></div>'
      + '<h3>What failed</h3><ul>' + list(c.failed) + '</ul>'
      + '<h3>What to try</h3><ol>' + list(c.steps) + '</ol>'
      + '<h3>Linux udev rule (vendor id 108c)</h3>'
      + '<pre class="doctor-code" style="white-space:pre-wrap;user-select:all">' + esc(UDEV_RULE) + '</pre>'
      + '<h3>Windows: Zadig / WinUSB</h3>'
      + '<pre class="doctor-code" style="white-space:pre-wrap;user-select:all">' + esc(ZADIG_STEPS) + '</pre>';
  }

  window.Bes3ConnectionDoctor = { classify, render, UDEV_RULE, ZADIG_STEPS };
})();
