// Generated from web/data/part-images.json + prefix fallbacks for full BES3 hardware coverage.
// Also owns component photo source resolution (local web/parts/ first; optional
// session-only remote opt-in from the pinned upstream commit; otherwise generic SVG icon)
// and optional canvas conversion for PDF reports when embedded PDF images are absent.
(function () {
  'use strict';

  const UPSTREAM_COMMIT = 'cd9a5510ae1091c467d8d5a586a23723c17a9249';
  const UPSTREAM_IMAGE_BASE = 'https://cdn.jsdelivr.net/gh/rweijnen/bosch-bes3-reader@cd9a5510ae1091c467d8d5a586a23723c17a9249/web/parts/';
  const MISSING_UPSTREAM_FILES = Object.freeze([]);

  const MAP = {
    AntiLockBrakeSystem: {
      BAS3311: 'ic_bas3311_abs.webp',
      BAS35: 'ic_bas35_abs_pro.webp',
    },
    Battery: {
      BBP324: 'ic_bbp324_compact_tube_400.webp',
      BBP334: 'ic_bbp334_power_pack_400_rack.webp',
      BBP335: 'ic_bbp335_power_pack_500_rack.webp',
      BBP354: 'ic_bbp354_power_pack_400.webp',
      BBP355: 'ic_bbp355_power_pack_545.webp',
      BBP356: 'ic_bbp356_power_pack_600.webp',
      BBP357: 'ic_bbp357_power_pack_725.webp',
      BBP358: 'ic_bbp358_power_pack_800.webp',
      BBP362: 'ic_bbp362_power_more_250.webp',
      BBP375: 'ic_bbp375_power_tube500.webp',
      BBP376: 'ic_bbp376_power_tube625.webp',
      BBP377: 'ic_bbp377_power_tube750.webp',
      BBP383: 'ic_bbp383_power_tube360.webp',
      BBP385: 'ic_bbp385_power_tube_540.webp',
      BBP386: 'ic_bbp386_power_tube600.webp',
      BBP387: 'ic_bbp387_power_tube720.webp',
      BBP388: 'ic_bbp388_power_tube800.webp',
    },
    Battery2: {
      BBP324: 'ic_bbp324_compact_tube_400.webp',
      BBP334: 'ic_bbp334_power_pack_400_rack.webp',
      BBP335: 'ic_bbp335_power_pack_500_rack.webp',
      BBP354: 'ic_bbp354_power_pack_400.webp',
      BBP355: 'ic_bbp355_power_pack_545.webp',
      BBP356: 'ic_bbp356_power_pack_600.webp',
      BBP357: 'ic_bbp357_power_pack_725.webp',
      BBP358: 'ic_bbp358_power_pack_800.webp',
      BBP362: 'ic_bbp362_power_more_250.webp',
      BBP375: 'ic_bbp375_power_tube500.webp',
      BBP376: 'ic_bbp376_power_tube625.webp',
      BBP377: 'ic_bbp377_power_tube750.webp',
      BBP383: 'ic_bbp383_power_tube360.webp',
      BBP385: 'ic_bbp385_power_tube_540.webp',
      BBP386: 'ic_bbp386_power_tube600.webp',
      BBP387: 'ic_bbp387_power_tube720.webp',
      BBP388: 'ic_bbp388_power_tube800.webp',
    },
    ConnectModule: {
      BCM3100: 'ic_bcm3100_connect_module.webp',
      BCM3101: 'ic_bcm3101_connect_module.webp',
    },
    DriveUnit: {
      BDU306: 'ic_bdu306_hub_line_motor.webp',
      BDU314: 'ic_bdu314_performance_line_sx.webp',
      BDU332: 'ic_bdu332_active_line.webp',
      BDU334: 'ic_bdu334_active_line_plus.webp',
      BDU336: 'ic_bdu336_performance_line.webp',
      BDU338: 'ic_bdu338_performance_line_sport.webp',
      BDU344: 'ic_bdu344_active_line_plus.webp',
      BDU346: 'ic_bdu346_performance_line.webp',
      BDU347: 'ic_bdu347_performance_line_px.webp',
      BDU348: 'ic_bdu348_performance_line_sport.webp',
      BDU374: 'ic_bdu374_performance_line_cx.webp',
      BDU3741: 'ic_bdu374_performance_line_cx.webp',
      BDU376: 'ic_bdu376_performance_line_cx_race.webp',
      BDU378: 'ic_bdu378_performance_line_speed.webp',
      BDU384: 'ic_bdu384_performance_line_cx.webp',
      BDU386: 'ic_bdu386_performance_line_cxr.webp',
      BDU388: 'ic_bdu388_performance_line_speed.webp',
    },
    HeadUnit: {
      BHU32: 'ic_bhu32000_intuvia_100.webp',
      BHU32000: 'ic_bhu32000_intuvia_100.webp',
      BHU3210: 'ic_bhu3210_intuvia_200.webp',
      BHU35: 'ic_bhu3500_purion_400.webp',
      BHU3500: 'ic_bhu3500_purion_400.webp',
      BHU36: 'ic_bhu3600_kiox_300.webp',
      BHU3600: 'ic_bhu3600_kiox_300.webp',
      BHU3700: 'ic_bhu_kiox_300_500.webp',
    },
    MiniRemote: {
      BRC33: 'ic_brc3300_mini_remote.webp',
      BRC3300: 'ic_brc3300_mini_remote.webp',
    },
    RemoteControl: {
      BRC3100: 'ic_brc3100_system_controller.webp',
      BRC3200: 'ic_brc3200_kiox_400.webp',
      BRC3300: 'ic_brc3300_mini_remote.webp',
      BRC3600: 'ic_brc3600_led_remote.webp',
      BRC3610: 'ic_brc3610_led_controller_frame.webp',
      BRC3800: 'ic_brc3800_purion_200.webp',
    },
  };

  // Session-only opt-in state (never persisted in web storage).
  let remoteOptIn = false;
  let localOverride = null;
  let missingSet = new Set(MISSING_UPSTREAM_FILES);
  const remotePdfCache = Object.create(null);

  function fileFor(comp, code) {
    const t = MAP[comp];
    if (!t || !code) return null;
    const c = String(code);
    if (Object.prototype.hasOwnProperty.call(t, c)) return t[c];
    const k = Object.keys(t)
      .sort((a, b) => b.length - a.length)
      .find((p) => c.startsWith(p));
    return k ? t[k] : null;
  }

  function hasLocalPhotos() {
    if (typeof window.Bes3LocalPartPhotos !== 'undefined' && window.Bes3LocalPartPhotos === false) return false;
    if (localOverride !== null) return Boolean(localOverride);
    return Boolean(window.Bes3PartImagesPdf && typeof window.Bes3PartImagesPdf === 'object');
  }

  function setLocalAvailable(val) {
    localOverride = val === null || val === undefined ? null : Boolean(val);
  }

  function isRemoteOptIn() {
    return remoteOptIn;
  }

  function setRemoteOptIn(val) {
    remoteOptIn = Boolean(val);
  }

  function setMissingUpstreamFiles(list) {
    missingSet = new Set(Array.isArray(list) ? list.map(String) : MISSING_UPSTREAM_FILES);
  }

  function isMissingUpstream(file) {
    return missingSet.has(String(file || ''));
  }

  function resolve(comp, code) {
    const file = fileFor(comp, code);
    if (!file) return null;
    if (hasLocalPhotos()) return 'web/parts/' + file;
    if (remoteOptIn && !missingSet.has(file)) return UPSTREAM_IMAGE_BASE + file;
    return null;
  }

  function getPdfImage(comp, code) {
    const file = fileFor(comp, code);
    if (!file) return null;
    const tbl = window.Bes3PartImagesPdf;
    if (tbl && tbl[file] && Array.isArray(tbl[file + '#size'])) {
      return { data: tbl[file], size: tbl[file + '#size'] };
    }
    if (remoteOptIn && !missingSet.has(file) && remotePdfCache[file]) {
      return remotePdfCache[file];
    }
    return null;
  }

  async function convertImageUrlToPdfEntry(url) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    if (typeof window.Image !== 'function') return null;
    return new Promise((resolvePromise) => {
      try {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const w = Number(img.naturalWidth || img.width) || 0;
            const h = Number(img.naturalHeight || img.height) || 0;
            if (w <= 0 || h <= 0) { resolvePromise(null); return; }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext && canvas.getContext('2d');
            if (!ctx) { resolvePromise(null); return; }
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const data = canvas.toDataURL('image/jpeg', 0.85);
            if (typeof data === 'string' && data.startsWith('data:image/jpeg')) {
              resolvePromise({ data, size: [w, h] });
            } else {
              resolvePromise(null);
            }
          } catch (_) {
            resolvePromise(null);
          }
        };
        img.onerror = () => resolvePromise(null);
        img.src = url;
      } catch (_) {
        resolvePromise(null);
      }
    });
  }

  async function preloadPdfImages(comps) {
    if (!remoteOptIn || (window.Bes3PartImagesPdf && typeof window.Bes3PartImagesPdf === 'object')) {
      return { loaded: 0 };
    }
    if (!Array.isArray(comps)) return { loaded: 0 };
    let loaded = 0;
    for (const c of comps) {
      if (!c || !c.present) continue;
      const file = fileFor(c.key, c.code);
      if (!file || missingSet.has(file) || remotePdfCache[file]) continue;
      const entry = await convertImageUrlToPdfEntry(UPSTREAM_IMAGE_BASE + file);
      if (entry) {
        remotePdfCache[file] = entry;
        loaded++;
      }
    }
    return { loaded };
  }

  function clearPdfCache() {
    for (const k of Object.keys(remotePdfCache)) delete remotePdfCache[k];
  }

  // The embedded base64 map lives in web/workshop/part-images-pdf.js, which the
  // public tree excludes. index.html therefore must not reference it directly;
  // this loads it lazily when it is available and fails quietly when it is not.
  let embeddedPdfPromise = null;
  function loadEmbeddedPdfImages() {
    if (window.Bes3LocalPartPhotos === false) return Promise.resolve(false);
    if (window.Bes3PartImagesPdf && typeof window.Bes3PartImagesPdf === 'object') return Promise.resolve(true);
    if (embeddedPdfPromise) return embeddedPdfPromise;
    embeddedPdfPromise = new Promise((resolve) => {
      try {
        if (typeof document === 'undefined' || !document.createElement) { resolve(false); return; }
        const script = document.createElement('script');
        script.src = 'web/workshop/part-images-pdf.js';
        script.async = true;
        script.onload = () => resolve(Boolean(window.Bes3PartImagesPdf));
        script.onerror = () => resolve(false);
        const parent = document.head || document.body || document.documentElement;
        if (!parent || !parent.appendChild) { resolve(false); return; }
        parent.appendChild(script);
      } catch (_) {
        resolve(false);
      }
    });
    return embeddedPdfPromise;
  }

  Object.defineProperties(MAP, {
    UPSTREAM_COMMIT: { value: UPSTREAM_COMMIT, enumerable: false },
    UPSTREAM_IMAGE_BASE: { value: UPSTREAM_IMAGE_BASE, enumerable: false },
    MISSING_UPSTREAM_FILES: { value: MISSING_UPSTREAM_FILES, enumerable: false },
    fileFor: { value: fileFor, enumerable: false, writable: true },
    hasLocalPhotos: { value: hasLocalPhotos, enumerable: false, writable: true },
    setLocalAvailable: { value: setLocalAvailable, enumerable: false, writable: true },
    isRemoteOptIn: { value: isRemoteOptIn, enumerable: false, writable: true },
    setRemoteOptIn: { value: setRemoteOptIn, enumerable: false, writable: true },
    setMissingUpstreamFiles: { value: setMissingUpstreamFiles, enumerable: false, writable: true },
    isMissingUpstream: { value: isMissingUpstream, enumerable: false, writable: true },
    resolve: { value: resolve, enumerable: false, writable: true },
    getPdfImage: { value: getPdfImage, enumerable: false, writable: true },
    preloadPdfImages: { value: preloadPdfImages, enumerable: false, writable: true },
    clearPdfCache: { value: clearPdfCache, enumerable: false, writable: true },
    loadEmbeddedPdfImages: { value: loadEmbeddedPdfImages, enumerable: false, writable: true },
  });

  window.Bes3PartImages = MAP;
})();
