// Browser Web Bluetooth transport for Bosch's official "eBike Live Data
// Interface" (smart system control unit v19+, published 2026-05-01,
// Apache-2.0 licensed spec — see docs/ebike_live_data.proto).
//
// Adapted from rweijnen/bosch-bes3-reader (MIT). This GATT service is distinct
// from the reverse-engineered MessageBus/MCSP protocol: a single characteristic
// notifies a compact protobuf message (~13 ride telemetry fields).
(function () {
  'use strict';

  const LIVE_DATA_SERVICE_UUID = '0000eb20-eaa2-11e9-81b4-2a2ae2dbcce4';
  const LIVE_DATA_CHARACTERISTIC_UUID = '0000eb21-eaa2-11e9-81b4-2a2ae2dbcce4';

  const LightState = { 0: 'INVALID', 1: 'OFF', 2: 'ON' };

  function sleep(ms) {
    if (typeof window !== 'undefined' && typeof window.__bes3Sleep === 'function') {
      return window.__bes3Sleep(ms);
    }
    return new Promise((r) => setTimeout(r, ms));
  }

  // Bounded protobuf varint reader (little-endian base-128, up to 64 bits).
  // Throws RangeError on truncated or overlong (>10-byte) varints.
  function readVarint(bytes, offset) {
    let result = 0n;
    let shift = 0n;
    let pos = offset;
    while (pos < bytes.length && shift < 64n) {
      const b = bytes[pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return [result, pos];
      shift += 7n;
    }
    throw new RangeError('Truncated or overlong varint in LiveData payload');
  }

  // Decodes a com.bosch.ebike.LiveData protobuf message (proto3). Unrecognized
  // fields are skipped per spec; truncated tails stop cleanly without throwing.
  function decodeLiveData(bytes) {
    const out = {};
    if (!bytes || typeof bytes.length !== 'number') return out;
    let pos = 0;
    try {
      while (pos < bytes.length) {
        const [tag, afterTag] = readVarint(bytes, pos);
        pos = afterTag;
        const fieldNumber = Number(tag >> 3n);
        const wireType = Number(tag & 0x7n);

        let raw;
        if (wireType === 0) {
          const [v, next] = readVarint(bytes, pos);
          raw = v;
          pos = next;
        } else if (wireType === 1) {
          if (pos + 8 > bytes.length) break;
          raw = 0n;
          pos += 8;
        } else if (wireType === 5) {
          if (pos + 4 > bytes.length) break;
          raw = 0n;
          pos += 4;
        } else if (wireType === 2) {
          const [len, next] = readVarint(bytes, pos);
          const skip = Number(len);
          if (!Number.isFinite(skip) || skip < 0 || next + skip > bytes.length) break;
          pos = next + skip;
          continue;
        } else {
          break;
        }

        switch (fieldNumber) {
          case 1: out.speedKmh = Number(raw) / 100; break;
          case 2: out.cadenceRpm = Number(BigInt.asIntN(32, raw)); break;
          case 5: out.riderPowerW = Number(raw); break;
          case 9: out.ambientBrightnessLux = Number(raw) / 1000; break;
          case 10: out.batterySocPercent = Number(raw); break;
          case 11: out.timeUnixSeconds = Number(raw); break;
          case 12: out.odometerMeters = Number(raw); break;
          case 17: out.bikeLight = LightState[Number(raw)] || ('UNKNOWN(' + String(raw) + ')'); break;
          case 21: out.systemLocked = raw !== 0n; break;
          case 22: out.chargerConnected = raw !== 0n; break;
          case 23: out.lightReserveState = raw !== 0n; break;
          case 24: out.diagnosisProgramActive = raw !== 0n; break;
          case 25: out.bikeNotDriving = raw !== 0n; break;
          default: break;
        }
      }
    } catch (_) {
      // Stop on truncated tail and return the fields decoded so far.
    }
    return out;
  }

  async function requestLiveDataDevice() {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      throw new Error('This browser does not support Web Bluetooth. Please use Chrome or Edge.');
    }
    // Use the Live Data service UUID as the filter so the browser grants access
    // to it directly. Listing it only in optionalServices while filtering on a
    // different UUID (0xfe02) causes Chrome to silently drop notifications on
    // some platforms.
    return navigator.bluetooth.requestDevice({
      filters: [{ services: [LIVE_DATA_SERVICE_UUID] }],
    });
  }

  class Bes3LiveDataBleTransport {
    constructor(device) {
      this.device = device;
      this.characteristic = null;
      this._onData = null;
      this._handleNotify = null;
      this._closed = false;
    }

    async connect() {
      this._closed = false;
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      log && log('ble-live', 'device: ' + (this.device.name || '(unnamed)') + ' id=' + (this.device.id || ''));
      const backoffsMs = [0, 400, 900, 1600];
      let lastErr;
      for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
        if (backoffsMs[attempt]) await sleep(backoffsMs[attempt]);
        try {
          log && log('ble-live', 'gatt.connect() attempt ' + (attempt + 1) + '/' + backoffsMs.length + '…');
          const server = await this.device.gatt.connect();
          log && log('ble-live', 'connected, discovering Live Data service', LIVE_DATA_SERVICE_UUID);
          const service = await server.getPrimaryService(LIVE_DATA_SERVICE_UUID);
          this.characteristic = await service.getCharacteristic(LIVE_DATA_CHARACTERISTIC_UUID);
          log && log('ble-live', 'connect() complete');
          return;
        } catch (err) {
          lastErr = err;
          log && log('ble-live', 'connect attempt ' + (attempt + 1) + '/' + backoffsMs.length + ' failed: ' + (err && err.message));
          try { this.device.gatt.disconnect(); } catch (_) { /* ignore */ }
          if (/not paired|encryption|not authori|authentication/i.test((err && err.message) || '')) break;
        }
      }
      const m = (lastErr && lastErr.message) || String(lastErr) || 'unknown error';
      if (/not paired|encryption|not authori|authentication/i.test(m)) {
        throw new Error('Bike not paired. Pair "smart system eBike" in OS Bluetooth settings (with the bike in pairing mode), then reconnect. [' + m + ']');
      }
      if (/connection attempt failed|unreachable|gatt operation failed|no longer|disconnected|not connected/i.test(m)) {
        throw new Error('Could not reach the bike over BLE. Make sure it is awake, in range, and paired, then try again. [' + m + ']');
      }
      throw new Error(m);
    }

    disconnect() {
      this._closed = true;
      try {
        if (this.characteristic && this._handleNotify && this.characteristic.removeEventListener) {
          this.characteristic.removeEventListener('characteristicvaluechanged', this._handleNotify);
        }
        if (this.device && this.device.gatt && this.device.gatt.disconnect) {
          this.device.gatt.disconnect();
        }
      } catch (_) { /* ignore */ }
      this.characteristic = null;
      this._handleNotify = null;
      this._onData = null;
    }

    async close() {
      this.disconnect();
    }

    async readOnce() {
      if (this._closed || !this.characteristic) throw new Error('Transport is not connected');
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      log && log('ble-live', 'readValue()…');
      const value = await this.characteristic.readValue();
      const bytes = new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength !== undefined ? value.byteLength : value.buffer.byteLength);
      log && log('ble-live', 'readValue() returned ' + bytes.length + ' bytes', bytes);
      const decoded = decodeLiveData(bytes);
      log && log('ble-live', 'decoded', JSON.stringify(decoded));
      return decoded;
    }

    async subscribe(callback) {
      if (this._closed || !this.characteristic) throw new Error('Transport is not connected');
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      this._onData = callback;
      this._handleNotify = (event) => {
        if (this._closed) return;
        const val = event && event.target && event.target.value;
        if (!val || !val.buffer) return;
        const bytes = new Uint8Array(val.buffer, val.byteOffset || 0, val.byteLength !== undefined ? val.byteLength : val.buffer.byteLength);
        log && log('ble-live', 'notification (' + bytes.length + ' bytes)', bytes);
        const decoded = decodeLiveData(bytes);
        log && log('ble-live', 'decoded', JSON.stringify(decoded));
        if (this._onData) this._onData(decoded);
      };
      this.characteristic.addEventListener('characteristicvaluechanged', this._handleNotify);
      log && log('ble-live', 'startNotifications()…');
      await this.characteristic.startNotifications();
      log && log('ble-live', 'subscribed');
    }
  }

  window.Bes3LiveDataBle = {
    Bes3LiveDataBleTransport,
    requestLiveDataDevice,
    decodeLiveData,
    LIVE_DATA_SERVICE_UUID,
    LIVE_DATA_CHARACTERISTIC_UUID,
  };
})();
