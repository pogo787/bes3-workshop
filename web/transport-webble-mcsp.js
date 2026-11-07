// Full-protocol MCSP/MessageBus Web Bluetooth transport for Bosch Smart System
// (BES3). Adapted from rweijnen/bosch-bes3-reader (MIT).
//
// Speaks the same MCSP/MessageBus framing used over USB (src/protocol.js),
// carried over GATT segmentation frames on channel 1, while acting as a
// MobileApp peer (0x40xx) during the bike's startup handshake and rewriting the
// outgoing/incoming host address between 0x0e10 (USB) and 0x4180 (BLE).
(function () {
  'use strict';

  const ADVERTISED_SERVICE_UUID = '0000fe02-0000-1000-8000-00805f9b34fb';
  const MCSP_SERVICE_UUID = '00000010-eaa2-11e9-81b4-2a2ae2dbcce4';
  const RX_CHARACTERISTIC_UUID = '00000011-eaa2-11e9-81b4-2a2ae2dbcce4'; // notify, bike -> host
  const TX_CHARACTERISTIC_UUID = '00000012-eaa2-11e9-81b4-2a2ae2dbcce4'; // write, host -> bike

  const CommandType = {
    VERSION: 0x01,
    ADVANCE_TRANSMIT_WINDOW: 0x02,
    DISABLE_FLOW_CONTROL: 0x03,
    MAX_SEGMENTATION_PACKET: 0x04,
  };

  const Channel = {
    COMMAND: 0,
    MESSAGE_BUS: 1,
    LBTP_PULL: 2,
    LBTP_PUSH: 3,
  };

  const MessageType = {
    READ: 0,
    READ_RESPONSE: 1,
    WRITE: 2,
    WRITE_RESPONSE: 3,
    RPC: 4,
    RPC_RESPONSE: 5,
  };

  const MOBILE_APP_HIGH_BYTE = 0x40;
  const MOBILE_APP_LOW = {
    UI_PRIORITY: 0x81,
    STARTUP_STAGE: 0xa9,
    MOBILE_APP_STATIC_FEATURE_PROPERTIES: 0xaa,
  };
  const STARTUP_STAGE_DONE = 9;

  const BLE_HOST_HIGH = 0x41;
  const BLE_HOST_LOW = 0x80;
  const USB_HOST_HIGH = 0x0e;
  const USB_HOST_LOW = 0x10;
  const STATIC_FEATURE_PROPERTIES_RESPONSE = Uint8Array.from([0x18, 0x01]);

  function now() {
    if (typeof window !== 'undefined' && typeof window.__bes3Now === 'function') {
      return window.__bes3Now();
    }
    return Date.now();
  }

  function sleep(ms) {
    if (typeof window !== 'undefined' && typeof window.__bes3Sleep === 'function') {
      return window.__bes3Sleep(ms);
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function encodeSegmentationFrame(channel, endOfChannel, payload) {
    if (payload.length > 4095) throw new RangeError('payload too large for a single segmentation frame');
    const header0 = ((channel & 0x07) << 5) | (endOfChannel ? 0x10 : 0) | ((payload.length >> 8) & 0x0f);
    const header1 = payload.length & 0xff;
    const frame = new Uint8Array(2 + payload.length);
    frame[0] = header0;
    frame[1] = header1;
    frame.set(payload, 2);
    return frame;
  }

  function decodeSegmentationFrames(buffer) {
    const frames = [];
    if (!buffer || typeof buffer.length !== 'number') return frames;
    let offset = 0;
    while (offset + 2 <= buffer.length) {
      const header0 = buffer[offset];
      const header1 = buffer[offset + 1];
      const channel = (header0 >> 5) & 0x07;
      const endOfChannel = !!(header0 & 0x10);
      const length = ((header0 & 0x0f) << 8) | header1;
      const payloadStart = offset + 2;
      const payloadEnd = payloadStart + length;
      if (payloadEnd > buffer.length) break;
      frames.push({ channel, endOfChannel, payload: buffer.slice(payloadStart, payloadEnd) });
      offset = payloadEnd;
    }
    return frames;
  }

  function encodeCommand(type, args) {
    return Uint8Array.from([type, ...(args || [])]);
  }

  async function requestMcspDevice() {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      throw new Error('This browser does not support Web Bluetooth. Please use Chrome or Edge.');
    }
    return navigator.bluetooth.requestDevice({
      filters: [{ services: [ADVERTISED_SERVICE_UUID] }],
      optionalServices: [MCSP_SERVICE_UUID],
    });
  }

  class Bes3BleMcspTransport {
    constructor(device) {
      this.device = device;
      this.rxChar = null;
      this.txChar = null;
      this._readQueue = [];
      this._commandsSeen = [];
      this.startupStage = null;
      this._onNotify = null;
    }

    async open() {
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      log && log('ble-mcsp', 'device: ' + (this.device.name || '(unnamed)') + ' id=' + (this.device.id || ''));
      const backoffsMs = [0, 400, 900, 1600];
      let lastErr;
      for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
        if (backoffsMs[attempt]) await sleep(backoffsMs[attempt]);
        try {
          await this._openOnce(log, attempt + 1, backoffsMs.length);
          log && log('ble-mcsp', 'open() complete');
          return;
        } catch (err) {
          lastErr = err;
          log && log('ble-mcsp', 'open attempt ' + (attempt + 1) + '/' + backoffsMs.length + ' failed: ' + (err && err.message));
          try { this.device.gatt.disconnect(); } catch (_) { /* ignore */ }
          if (this.rxChar && this._onNotify && this.rxChar.removeEventListener) {
            try { this.rxChar.removeEventListener('characteristicvaluechanged', this._onNotify); } catch (_) { /* ignore */ }
          }
          if (/not paired|encryption|not authori|authentication/i.test((err && err.message) || '')) break;
        }
      }
      throw new Error(this._friendlyOpenError(lastErr));
    }

    async _openOnce(log, attempt, total) {
      log && log('ble-mcsp', 'gatt.connect() attempt ' + attempt + '/' + total + '…');
      const server = await this.device.gatt.connect();
      log && log('ble-mcsp', 'connected, discovering MCSP service', MCSP_SERVICE_UUID);
      const service = await server.getPrimaryService(MCSP_SERVICE_UUID);
      this.rxChar = await service.getCharacteristic(RX_CHARACTERISTIC_UUID);
      this.txChar = await service.getCharacteristic(TX_CHARACTERISTIC_UUID);
      log && log('ble-mcsp', 'found rx/tx characteristics, starting notifications');

      this._onNotify = (event) => {
        const val = event && event.target && event.target.value;
        if (!val || !val.buffer) return;
        const bytes = new Uint8Array(val.buffer, val.byteOffset || 0, val.byteLength !== undefined ? val.byteLength : val.buffer.byteLength);
        this._handleNotification(bytes);
      };
      this.rxChar.addEventListener('characteristicvaluechanged', this._onNotify);
      await this.rxChar.startNotifications();

      await this._handshake();
    }

    _friendlyOpenError(err) {
      const m = (err && err.message) || String(err) || 'unknown error';
      if (/not paired|encryption|not authori|authentication/i.test(m)) {
        return 'Bike not paired. Pair "smart system eBike" in OS Bluetooth settings (with the bike in pairing mode), then reconnect. [' + m + ']';
      }
      if (/connection attempt failed|unreachable|gatt operation failed|no longer|disconnected|not connected/i.test(m)) {
        return 'Could not reach the bike over BLE. Make sure it is awake, in range, and paired, then try again. [' + m + ']';
      }
      return m;
    }

    _handleNotification(bytes) {
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      log && log('ble-rx', 'raw notification (' + bytes.length + ' bytes)', bytes);
      for (const frame of decodeSegmentationFrames(bytes)) {
        log && log('ble-rx', 'frame: channel=' + frame.channel + ' endOfChannel=' + frame.endOfChannel + ' len=' + frame.payload.length, frame.payload);
        if (frame.channel === Channel.MESSAGE_BUS && frame.endOfChannel) {
          if (this._handleInboundMobileAppRequest(frame.payload)) continue;
          if (frame.payload.length < 256) {
            const wrapped = new Uint8Array(2 + frame.payload.length);
            wrapped[0] = 0x30;
            wrapped[1] = frame.payload.length;
            wrapped.set(frame.payload, 2);
            if (wrapped.length >= 6 && (wrapped[4] & 0x7f) === BLE_HOST_HIGH) {
              const successFlag = wrapped[4] & 0x80;
              wrapped[4] = successFlag | USB_HOST_HIGH;
              wrapped[5] = USB_HOST_LOW;
            }
            this._readQueue.push(wrapped);
          }
        } else if (frame.channel === Channel.COMMAND) {
          this._commandsSeen.push(frame.payload);
        }
      }
    }

    _handleInboundMobileAppRequest(body) {
      if (body.length < 5) return false;
      const reqSrcHigh = body[0];
      const reqSrcLow = body[1];
      const destHigh = body[2];
      const destLow = body[3];
      const typeSeq = body[4];
      const reqType = (typeSeq >> 4) & 0x0f;
      const seq = typeSeq & 0x0f;
      if ((destHigh & 0x7f) !== MOBILE_APP_HIGH_BYTE) return false;
      if (reqType !== MessageType.READ && reqType !== MessageType.WRITE) return false;

      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      let responseType;
      let payload = [];

      if (reqType === MessageType.READ) {
        responseType = MessageType.READ_RESPONSE;
        if (destLow === MOBILE_APP_LOW.MOBILE_APP_STATIC_FEATURE_PROPERTIES) {
          payload = Array.from(STATIC_FEATURE_PROPERTIES_RESPONSE);
          log && log('ble-mcsp', 'answered bike READ of MobileApp.MOBILE_APP_STATIC_FEATURE_PROPERTIES (stagedStartup=true)');
        } else {
          log && log('ble-mcsp', 'answered bike READ of MobileApp field 0x' + destLow.toString(16));
        }
      } else {
        responseType = MessageType.WRITE_RESPONSE;
        if (destLow === MOBILE_APP_LOW.STARTUP_STAGE) {
          const stagePayload = body.slice(5);
          const stage = stagePayload.length >= 2 ? stagePayload[1] : null;
          this.startupStage = stage;
          log && log('ble-mcsp', 'bike WROTE MobileApp.STARTUP_STAGE = ' + stage);
        } else {
          log && log('ble-mcsp', 'acked bike WRITE to MobileApp field 0x' + destLow.toString(16));
        }
      }

      const responseBody = [
        MOBILE_APP_HIGH_BYTE,
        destLow,
        0x80 | (reqSrcHigh & 0x7f),
        reqSrcLow,
        ((responseType & 0x0f) << 4) | (seq & 0x0f),
        ...payload,
      ];
      this._writeFrame(Channel.MESSAGE_BUS, Uint8Array.from(responseBody)).catch(() => {});
      return true;
    }

    async waitForBikeReady(timeoutMs = 8000) {
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        if (this.startupStage === STARTUP_STAGE_DONE) {
          log && log('ble-mcsp', 'bike reached STARTUP_STAGE=9 — proceeding');
          return true;
        }
        await sleep(100);
      }
      log && log('ble-mcsp', 'STARTUP_STAGE did not reach 9 within ' + timeoutMs + 'ms — proceeding anyway');
      return false;
    }

    async _writeFrame(channel, payload) {
      const frame = encodeSegmentationFrame(channel, true, payload);
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      log && log('ble-tx', 'write: channel=' + channel + ' len=' + payload.length, frame);
      if (this.txChar.writeValueWithoutResponse) {
        await this.txChar.writeValueWithoutResponse(frame);
      } else {
        await this.txChar.writeValue(frame);
      }
    }

    async _handshake() {
      await this._writeFrame(Channel.COMMAND, encodeCommand(CommandType.VERSION, [3]));
      await this._writeFrame(Channel.COMMAND, encodeCommand(CommandType.MAX_SEGMENTATION_PACKET, [0x02, 0x00]));
      for (const ch of [1, 2, 3, 4, 5, 6, 7]) {
        await this._writeFrame(Channel.COMMAND, encodeCommand(CommandType.DISABLE_FLOW_CONTROL, [ch]));
      }
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      const deadline = now() + 3000;
      while (now() < deadline) {
        const sawVersion = this._commandsSeen.some((p) => p[0] === CommandType.VERSION);
        const sawMaxPacket = this._commandsSeen.some((p) => p[0] === CommandType.MAX_SEGMENTATION_PACKET);
        if (sawVersion && sawMaxPacket) {
          log && log('ble-mcsp', 'handshake ack observed (VERSION + MAX_SEGMENTATION_PACKET)');
          return;
        }
        await sleep(50);
      }
      log && log('ble-mcsp', 'handshake ack not observed within 3s — proceeding best-effort');
    }

    async doMcspWrite(payload) {
      const body = Uint8Array.from(payload.slice(2));
      if (body.length >= 2 && body[0] === USB_HOST_HIGH && body[1] === USB_HOST_LOW) {
        body[0] = BLE_HOST_HIGH;
        body[1] = BLE_HOST_LOW;
      }
      await this._writeFrame(Channel.MESSAGE_BUS, body);
      return { ok: true, transferred: true, statusName: 'ok' };
    }

    async readNextFrame(maxPolls = 50, pollDelayMs = 5) {
      for (let i = 0; i < maxPolls; i++) {
        if (this._readQueue.length) return this._readQueue.shift();
        await sleep(pollDelayMs);
      }
      return null;
    }

    async close() {
      try {
        if (this.rxChar && this._onNotify && this.rxChar.removeEventListener) {
          this.rxChar.removeEventListener('characteristicvaluechanged', this._onNotify);
        }
      } catch (_) { /* ignore */ }
      try {
        if (this.device && this.device.gatt && this.device.gatt.disconnect) {
          this.device.gatt.disconnect();
        }
      } catch (_) { /* ignore */ }
    }
  }

  window.Bes3BleMcsp = {
    Bes3BleMcspTransport,
    requestMcspDevice,
    encodeSegmentationFrame,
    decodeSegmentationFrames,
    ADVERTISED_SERVICE_UUID,
    MCSP_SERVICE_UUID,
    RX_CHARACTERISTIC_UUID,
    TX_CHARACTERISTIC_UUID,
    STARTUP_STAGE_DONE,
  };
})();
