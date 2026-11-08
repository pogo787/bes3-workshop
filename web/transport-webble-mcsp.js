// Full-protocol MCSP/MessageBus Web Bluetooth transport for Bosch Smart System
// (BES3). Adapted from rweijnen/bosch-bes3-reader (MIT).
//
// Speaks the same MCSP/MessageBus framing used over USB (src/protocol.js),
// carried over GATT segmentation frames on channel 1, while acting as a
// MobileApp peer (0x40xx) during the bike's startup handshake and rewriting the
// outgoing/incoming host address between 0x0e10 (USB) and 0x4180 (BLE).
//
// The reassembly rules (a byte-stream buffer for split headers/payloads plus a
// per-channel accumulator for fragments) and the MobileApp responder behaviour
// were informed by the Bosch BES3 material in bg443/BikeBridge, which is a
// read-only research reference (GPL-3.0-or-later). No BikeBridge code is copied;
// the implementation below is this project's own. See docs/sources.md.
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
    SUBSCRIBE: 6,
    SUBSCRIBE_RESPONSE: 7,
    UNSUBSCRIBE: 8,
    UNSUBSCRIBE_RESPONSE: 9,
  };

  const MOBILE_APP_HIGH_BYTE = 0x40;
  const MOBILE_APP_LOW = {
    UI_PRIORITY: 0x81,
    STARTUP_STAGE: 0xa9,
    MOBILE_APP_STATIC_FEATURE_PROPERTIES: 0xaa,
  };
  const STARTUP_STAGE_DONE = 9;

  // The bike only sends these request types to the MobileApp object. Response
  // types (READ_RESPONSE etc.) and notifications must never be answered.
  const MOBILE_APP_REQUEST_TYPES = new Set([
    MessageType.READ,
    MessageType.WRITE,
    MessageType.RPC,
    MessageType.SUBSCRIBE,
  ]);

  // Datapoint names are protocol facts used for log labels only.
  const MOBILE_APP_NAMES = {
    0x81: 'UI_PRIORITY',
    0x82: 'FEATURE_STREAMING_ALERT',
    0x85: 'ALTITUDE',
    0x86: 'MAXIMUM_ALTITUDE',
    0x87: 'ASCENT',
    0x88: 'DESCENT',
    0x89: 'PHONE_SOC',
    0x94: 'HEART_RATE',
    0x96: 'NAVIGATION_CURRENT_STATUS',
    0x97: 'NAVIGATION_DISTANCE_TO_DESTINATION',
    0x98: 'NAVIGATION_ETA',
    0x99: 'NAVIGATION_TIME_TO_DESTINATION',
    0x9a: 'ALTITUDE_GRAPH_AVAILABLE_SAMPLES',
    0x9b: 'GET_ALTITUDE_GRAPH',
    0x9d: 'VISUALIZABLE_ISSUE_TYPES',
    0x9f: 'FEATURE_PROPERTIES_RELEASE4',
    0xa1: 'NAVIGATION_ADVICE',
    0xa2: 'SYSTEM_STATE_OF_CHARGE_AT_DESTINATION',
    0xa3: 'PHONE_CHARGING',
    0xa4: 'USER_INFO',
    0xa8: 'SPEED',
    0xa9: 'STARTUP_STAGE',
    0xaa: 'STATIC_FEATURE_PROPERTIES',
  };

  // Reads the bike accepts with an empty body (the phone has no value for them).
  const KNOWN_EMPTY_READS = new Set([
    0x82, 0x85, 0x86, 0x87, 0x88, 0x94, 0x96, 0x97, 0x98, 0x99, 0xa1, 0xa2, 0xa3, 0xa8,
  ]);

  const RESPONSE_STATUS = {
    SUCCESS: 0x00,
    UNSUPPORTED: 0x04,
    MALFORMED: 0x08,
  };

  const BLE_HOST_HIGH = 0x41;
  const BLE_HOST_LOW = 0x80;
  const USB_HOST_HIGH = 0x0e;
  const USB_HOST_LOW = 0x10;
  const STATIC_FEATURE_PROPERTIES_RESPONSE = Uint8Array.from([0x18, 0x01]);

  // A single segmentation frame carries at most 4095 payload bytes (12-bit
  // length). A standard BLE ATT MTU of 247 bytes leaves 244 bytes per write.
  const MAX_SEGMENT_BYTES = 4095;
  const DEFAULT_MAX_SEGMENTATION_PACKET = 244;
  // Safety caps: a broken or hostile peer must not grow a buffer without bound.
  const MAX_REASSEMBLED_BYTES = 16384;
  const MAX_CHANNEL_BYTES = 16384;
  const MAX_SEGMENTS_PER_MESSAGE = 4096;

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
    if (payload.length > MAX_SEGMENT_BYTES) throw new RangeError('payload too large for a single segmentation frame');
    const header0 = ((channel & 0x07) << 5) | (endOfChannel ? 0x10 : 0) | ((payload.length >> 8) & 0x0f);
    const header1 = payload.length & 0xff;
    const frame = new Uint8Array(2 + payload.length);
    frame[0] = header0;
    frame[1] = header1;
    frame.set(payload, 2);
    return frame;
  }

  // Parse every complete segmentation frame at the start of `buffer` and return
  // the bytes that belong to an incomplete trailing frame. Callers keep the tail
  // for the next notification instead of dropping it.
  function parseSegmentationStream(buffer) {
    const frames = [];
    if (!buffer || typeof buffer.length !== 'number') return { frames, rest: new Uint8Array(0) };
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
    const rest = offset >= buffer.length ? new Uint8Array(0) : buffer.slice(offset);
    return { frames, rest };
  }

  function decodeSegmentationFrames(buffer) {
    return parseSegmentationStream(buffer).frames;
  }

  function encodeCommand(type, args) {
    return Uint8Array.from([type, ...(args || [])]);
  }

  function typeName(type) {
    switch (type) {
      case MessageType.READ: return 'READ';
      case MessageType.READ_RESPONSE: return 'READ_RESPONSE';
      case MessageType.WRITE: return 'WRITE';
      case MessageType.WRITE_RESPONSE: return 'WRITE_RESPONSE';
      case MessageType.RPC: return 'RPC';
      case MessageType.RPC_RESPONSE: return 'RPC_RESPONSE';
      case MessageType.SUBSCRIBE: return 'SUBSCRIBE';
      case MessageType.SUBSCRIBE_RESPONSE: return 'SUBSCRIBE_RESPONSE';
      case MessageType.UNSUBSCRIBE: return 'UNSUBSCRIBE';
      case MessageType.UNSUBSCRIBE_RESPONSE: return 'UNSUBSCRIBE_RESPONSE';
      default: return 'type' + type;
    }
  }

  function statusName(status) {
    if (status === RESPONSE_STATUS.SUCCESS) return 'SUCCESS';
    if (status === RESPONSE_STATUS.UNSUPPORTED) return 'UNSUPPORTED';
    if (status === RESPONSE_STATUS.MALFORMED) return 'MALFORMED';
    return '0x' + status.toString(16);
  }

  // decodeStartupStage(payload) -> 0..9, or null when the body is not exactly
  // the documented `08 <stage>` field. An invalid body must be rejected before
  // it can change the stored stage.
  function decodeStartupStage(payload) {
    if (!payload || payload.length !== 2 || payload[0] !== 0x08) return null;
    const stage = payload[1];
    return stage <= STARTUP_STAGE_DONE ? stage : null;
  }

  // Registry lookups are cached per address: the registry is static for a page
  // load, and log labels are produced for every frame.
  const registryNameCache = new Map();
  function registryName(addr) {
    if (registryNameCache.has(addr)) return registryNameCache.get(addr);
    let name = null;
    try {
      const reg = typeof window !== 'undefined' && window.Bes3AddressRegistry;
      const list = reg && reg.ADDRESS_REGISTRY && reg.ADDRESS_REGISTRY.addresses;
      if (Array.isArray(list)) {
        const hit = list.find((e) => e && e.address === addr);
        if (hit && hit.component && hit.name) name = hit.component + '.' + hit.name;
      }
    } catch (_) { /* labels are best-effort */ }
    registryNameCache.set(addr, name);
    return name;
  }

  // describeMessageBusFrame(body) -> "DriveUnit.BIKE_LIGHT_POWER (0x1822) WRITE seq 3"
  function describeMessageBusFrame(body) {
    if (!body || body.length < 5) return '';
    const type = (body[4] >> 4) & 0x0f;
    const seq = body[4] & 0x0f;
    const src = ((body[0] & 0x7f) << 8) | body[1];
    const dest = ((body[2] & 0x7f) << 8) | body[3];
    const destName = registryName(dest);
    const srcName = registryName(src);
    const useDest = !!destName || dest !== 0;
    const addr = useDest ? dest : src;
    const name = useDest ? destName : srcName;
    return (name ? name + ' ' : '') + '(0x' + addr.toString(16) + ') ' + typeName(type) + ' seq ' + seq;
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
    constructor(device, options) {
      const opts = options || {};
      this.device = device;
      this.rxChar = null;
      this.txChar = null;
      this._readQueue = [];
      this._commandsSeen = [];
      this._rxStreamBuffer = new Uint8Array(0);
      this._channelAccumulators = new Map();
      this._channelSegments = new Map();
      this.startupStage = null;
      this._onNotify = null;
      // One session-scoped TX chain: the handshake, normal MCSP writes and the
      // automatic MobileApp peer responses all go through it, so two GATT
      // write operations can never be in flight at the same time. `_sessionId`
      // invalidates work queued by an earlier open/close cycle.
      this._txChain = Promise.resolve();
      this._sessionId = 0;
      this._closed = false;

      const requested = Number(opts.maxSegmentationPacket);
      this.maxSegmentationPacket = Number.isFinite(requested) && requested > 0
        ? Math.min(MAX_SEGMENT_BYTES, Math.max(20, Math.round(requested)))
        : DEFAULT_MAX_SEGMENTATION_PACKET;

      const soc = opts.phoneSoC == null ? NaN : Number(opts.phoneSoC);
      this.phoneSoC = Number.isFinite(soc) ? Math.min(100, Math.max(0, Math.round(soc))) : null;
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
          this._abortSession();
          try { this.device.gatt.disconnect(); } catch (_) { /* ignore */ }
          if (this.rxChar && this._onNotify && this.rxChar.removeEventListener) {
            try { this.rxChar.removeEventListener('characteristicvaluechanged', this._onNotify); } catch (_) { /* ignore */ }
          }
          if (/not paired|encryption|not authori|authentication/i.test((err && err.message) || '')) break;
        }
      }
      throw new Error(this._friendlyOpenError(lastErr));
    }

    // A reconnect must never inherit a partial message or a stale response.
    _resetStreamState() {
      this._sessionId++;
      this._closed = false;
      this._clearBuffers();
    }

    _clearBuffers() {
      this._rxStreamBuffer = new Uint8Array(0);
      this._channelAccumulators.clear();
      this._channelSegments.clear();
      this._readQueue.length = 0;
    }

    // Abandon the current session: queued writes from it are rejected by the
    // session check, buffers are dropped and late notifications are ignored.
    _abortSession() {
      this._closed = true;
      this._sessionId++;
      this._clearBuffers();
    }

    async _openOnce(log, attempt, total) {
      this._resetStreamState();
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
      if (this._closed) return;
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      log && log('ble-rx', 'raw notification (' + bytes.length + ' bytes)', bytes);
      if (!bytes || !bytes.length) return;

      // Layer 1: the byte-stream buffer carries split headers and payloads over
      // notification boundaries. Only complete frames are consumed.
      const joined = new Uint8Array(this._rxStreamBuffer.length + bytes.length);
      joined.set(this._rxStreamBuffer, 0);
      joined.set(bytes, this._rxStreamBuffer.length);
      const parsed = parseSegmentationStream(joined);
      this._rxStreamBuffer = parsed.rest;
      if (this._rxStreamBuffer.length > MAX_REASSEMBLED_BYTES) {
        log && log('ble-rx', 'reassembly buffer exceeded ' + MAX_REASSEMBLED_BYTES + ' bytes — dropping partial input');
        this._rxStreamBuffer = new Uint8Array(0);
        this._channelAccumulators.clear();
        this._channelSegments.clear();
        return;
      }

      for (const frame of parsed.frames) this._handleSegment(frame, log);
    }

    _handleSegment(frame, log) {
      if (frame.channel === Channel.COMMAND) {
        if (frame.endOfChannel) this._commandsSeen.push(frame.payload);
        return;
      }
      if (frame.channel !== Channel.MESSAGE_BUS) return;

      // Layer 2: channel 1 fragments are accumulated until endOfChannel.
      if (!frame.endOfChannel) {
        const previous = this._channelAccumulators.get(frame.channel) || new Uint8Array(0);
        const segments = (this._channelSegments.get(frame.channel) || 0) + 1;
        const next = new Uint8Array(previous.length + frame.payload.length);
        next.set(previous, 0);
        next.set(frame.payload, previous.length);
        if (next.length > MAX_CHANNEL_BYTES || segments > MAX_SEGMENTS_PER_MESSAGE) {
          log && log('ble-rx', 'channel ' + frame.channel + ' reassembly exceeded its limit — dropping ' + next.length + ' bytes');
          this._channelAccumulators.delete(frame.channel);
          this._channelSegments.delete(frame.channel);
          return;
        }
        this._channelAccumulators.set(frame.channel, next);
        this._channelSegments.set(frame.channel, segments);
        return;
      }

      const prefix = this._channelAccumulators.get(frame.channel) || new Uint8Array(0);
      this._channelAccumulators.delete(frame.channel);
      this._channelSegments.delete(frame.channel);
      let message = frame.payload;
      if (prefix.length) {
        message = new Uint8Array(prefix.length + frame.payload.length);
        message.set(prefix, 0);
        message.set(frame.payload, prefix.length);
      }
      if (message.length > MAX_SEGMENT_BYTES) {
        log && log('ble-rx', 'completed channel ' + frame.channel + ' message exceeds ' + MAX_SEGMENT_BYTES + ' bytes — dropped');
        return;
      }

      log && log('ble-rx', 'message: ' + describeMessageBusFrame(message), message);
      if (this._handleInboundMobileAppRequest(message)) return;

      // The shared parser (src/protocol.js) reads a single-octet length from
      // bytes[1]. Handing it a longer body would silently truncate the payload,
      // so an over-long message is reported and not queued. Reading the 12-bit
      // length in the shared parser is a gated protocol change (approval
      // required); the segmentation encoder below already writes it correctly.
      if (message.length > 255) {
        log && log('ble-rx', 'completed message is ' + message.length + ' bytes; the shared parser accepts at most 255 — not queued');
        return;
      }

      let wrapped;
      try {
        wrapped = encodeSegmentationFrame(Channel.MESSAGE_BUS, true, message);
      } catch (err) {
        log && log('ble-rx', 'could not wrap message: ' + (err && err.message));
        return;
      }
      if (wrapped.length >= 6 && (wrapped[4] & 0x7f) === BLE_HOST_HIGH) {
        const successFlag = wrapped[4] & 0x80;
        wrapped[4] = successFlag | USB_HOST_HIGH;
        wrapped[5] = USB_HOST_LOW;
      }
      this._readQueue.push(wrapped);
    }

    // Answer a bike -> phone MobileApp (0x40xx) request. Returns true when the
    // frame was a request and has been answered (or deliberately refused), so it
    // is not mistaken for a response to one of our own reads.
    _handleInboundMobileAppRequest(body) {
      if (!body || body.length < 5) return false;
      const reqSrcHigh = body[0];
      const reqSrcLow = body[1];
      const destHigh = body[2];
      const destLow = body[3];
      const typeSeq = body[4];
      const reqType = (typeSeq >> 4) & 0x0f;
      const seq = typeSeq & 0x0f;
      if ((destHigh & 0x7f) !== MOBILE_APP_HIGH_BYTE) return false;
      // A notify frame has the source MSB set and no destination semantics.
      if (reqSrcHigh & 0x80) return false;
      if (!MOBILE_APP_REQUEST_TYPES.has(reqType)) return false;

      const payload = body.slice(5);
      const name = MOBILE_APP_NAMES[destLow] || ('0x' + destLow.toString(16).toUpperCase());
      const address = '0x' + (0x4000 | destLow).toString(16).toUpperCase();
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;

      let responseType;
      let responsePayload = [];
      let status = RESPONSE_STATUS.SUCCESS;

      if (reqType === MessageType.READ) {
        responseType = MessageType.READ_RESPONSE;
        const answer = this._readMobileAppValue(destLow, payload);
        if (answer === null) status = RESPONSE_STATUS.UNSUPPORTED;
        else responsePayload = answer;
      } else if (reqType === MessageType.WRITE) {
        responseType = MessageType.WRITE_RESPONSE;
        if (destLow === MOBILE_APP_LOW.STARTUP_STAGE) {
          const stage = decodeStartupStage(payload);
          if (stage === null) status = RESPONSE_STATUS.MALFORMED;
          else this.startupStage = stage;
        } else {
          status = RESPONSE_STATUS.UNSUPPORTED;
        }
      } else if (reqType === MessageType.RPC) {
        responseType = MessageType.RPC_RESPONSE;
        // GET_ALTITUDE_GRAPH: an empty graph is enough for the bike to proceed.
        if (destLow === 0x9b) responsePayload = [0x22, 0x00];
        else status = RESPONSE_STATUS.UNSUPPORTED;
      } else {
        responseType = MessageType.SUBSCRIBE_RESPONSE;
      }

      const success = status === RESPONSE_STATUS.SUCCESS;
      // Captured wire format: the addressed MobileApp object answers from
      // 0x41xx; the requester is addressed with the success MSB, and a failed
      // response carries an explicit status byte instead.
      const responseBody = [
        BLE_HOST_HIGH,
        destLow,
        (success ? 0x80 : 0x00) | (reqSrcHigh & 0x7f),
        reqSrcLow,
        ((responseType & 0x0f) << 4) | (seq & 0x0f),
        ...(success ? responsePayload : [status]),
      ];

      if (success) {
        log && log('ble-mcsp', 'answered bike ' + typeName(reqType) + ' of MobileApp.' + name + ' (' + address + ') seq ' + seq);
      } else {
        log && log('ble-mcsp', 'answered bike ' + typeName(reqType) + ' of MobileApp.' + name + ' (' + address + ') seq ' + seq + ' with ' + statusName(status));
      }
      this._writeFrame(Channel.MESSAGE_BUS, Uint8Array.from(responseBody)).catch(() => {});
      return true;
    }

    _readMobileAppValue(destLow) {
      switch (destLow) {
        case 0x81: return [0x08, 0x00]; // UI_PRIORITY = 0
        case 0x89: return this.phoneSoC === null ? null : [0x08, this.phoneSoC]; // PHONE_SOC
        case 0x9a: return [0x08, 0x0a]; // ALTITUDE_GRAPH_AVAILABLE_SAMPLES = 10
        case 0x9d: return [0x0a, 0x04, 0x00, 0x01, 0x02, 0x03]; // VISUALIZABLE_ISSUE_TYPES
        case 0x9f: return [0x08, 0x01]; // FEATURE_PROPERTIES_RELEASE4
        case 0xa9: return this.startupStage === null ? null : [0x08, this.startupStage]; // STARTUP_STAGE
        case 0xaa: return Array.from(STATIC_FEATURE_PROPERTIES_RESPONSE); // stagedStartup = true
        default:
          return KNOWN_EMPTY_READS.has(destLow) ? [] : null;
      }
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

    // All GATT writes go through one session-scoped chain. The chain itself is
    // kept alive after a rejection, so one failed operation cannot block later
    // work; the caller still receives that rejection. The chain is released as
    // soon as the GATT write settles — protocol responses are awaited outside
    // it, so incoming peer requests stay answerable.
    async _writeFrame(channel, payload) {
      const frame = encodeSegmentationFrame(channel, true, payload);
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      const label = channel === Channel.MESSAGE_BUS ? ' — ' + describeMessageBusFrame(payload) : '';
      log && log('ble-tx', 'write: channel=' + channel + ' len=' + payload.length + label, frame);
      const session = this._sessionId;
      const run = this._txChain.then(() => {
        if (this._closed || session !== this._sessionId) {
          const e = new Error('Transport session changed before the write was sent');
          e.sessionChanged = true;
          throw e;
        }
        if (!this.txChar) throw new Error('Transport is not ready');
        return this.txChar.writeValueWithoutResponse
          ? this.txChar.writeValueWithoutResponse(frame)
          : this.txChar.writeValue(frame);
      });
      this._txChain = run.then(() => undefined, () => undefined);
      return run;
    }

    async _handshake() {
      const log = window.Bes3DebugLog && window.Bes3DebugLog.log;
      await this._writeFrame(Channel.COMMAND, encodeCommand(CommandType.VERSION, [3]));
      const mp = this.maxSegmentationPacket;
      await this._writeFrame(Channel.COMMAND, encodeCommand(CommandType.MAX_SEGMENTATION_PACKET, [(mp >> 8) & 0xff, mp & 0xff]));
      for (const ch of [1, 2, 3, 4, 5, 6, 7]) {
        await this._writeFrame(Channel.COMMAND, encodeCommand(CommandType.DISABLE_FLOW_CONTROL, [ch]));
      }
      log && log('ble-mcsp', 'handshake tx: VERSION 3, MAX_SEGMENTATION_PACKET ' + mp + ', flow control disabled on channels 1-7');
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
        if (this._closed) return null;
        if (this._readQueue.length) return this._readQueue.shift();
        await sleep(pollDelayMs);
      }
      return null;
    }

    async close() {
      // Invalidate queued work and ignore late notifications before tearing the
      // GATT link down.
      this._abortSession();
      try {
        if (this.rxChar && this._onNotify && this.rxChar.removeEventListener) {
          this.rxChar.removeEventListener('characteristicvaluechanged', this._onNotify);
        }
      } catch (_) { /* ignore */ }
      this._onNotify = null;
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
    parseSegmentationStream,
    describeMessageBusFrame,
    decodeStartupStage,
    MOBILE_APP_NAMES,
    MOBILE_APP_LOW,
    RESPONSE_STATUS,
    ADVERTISED_SERVICE_UUID,
    MCSP_SERVICE_UUID,
    RX_CHARACTERISTIC_UUID,
    TX_CHARACTERISTIC_UUID,
    STARTUP_STAGE_DONE,
    DEFAULT_MAX_SEGMENTATION_PACKET,
    MAX_SEGMENT_BYTES,
  };
})();
