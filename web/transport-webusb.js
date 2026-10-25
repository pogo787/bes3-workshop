// Browser WebUSB transport — same MCSP framing as ../node/transport-node-usb.js,
// implemented against navigator.usb instead of the `usb` npm package. Exposes
// the same doMcspWrite()/readNextFrame() shape so app.js can stay transport-agnostic.

const VENDOR_ID = 0x108c; // Bosch
const PRODUCT_IDS = [448, 452, 454, 462]; // Smart System "system controller" PIDs
const EP_IN = 3;   // bulk IN endpoint number
const EP_OUT = 4;  // bulk OUT endpoint number

const REQ_GET_IN_STATE = 0x44;
const REQ_SET_IN_DONE = 0x45;
const REQ_GET_OUT_STATE = 0x47;
const REQ_SET_OUT_SIZE = 0x48;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDevice() {
  const filters = PRODUCT_IDS.map((productId) => ({ vendorId: VENDOR_ID, productId }));
  const device = await navigator.usb.requestDevice({ filters });
  return device;
}

class Bes3WebUsbTransport {
  constructor(device) {
    this.device = device;
  }

  async open() {
    await this.device.open();
    await this.device.claimInterface(0);
    await this.init();
  }

  // Initialize the USB<->MCSP bridge. WITHOUT this the bridge never forwards our
  // bulk writes to the drive unit's serial bus: writes still ACK at the USB layer
  // (0x47 -> 02 00 00) but the inbound register (0x44) stays 0 forever, so every
  // read times out. Captured verbatim from the stock tool's connect sequence:
  //   1) one vendor IN  request 0x01 (reads a 1-byte bridge status)
  //   2) five vendor OUT control transfers (0x00, 0x43, 0x23, 0x41, 0x21) that
  //      configure the bridge; 0x43/0x23 carry a fixed 9-byte config blob.
  //   3) the MCSP session handshake: 0x10-opcode frames that arm the drive unit
  //      to answer 0x30 block reads. We drain their responses so they don't leak
  //      into later read matching.
  async init() {
    const cfg = Uint8Array.from([0x00, 0x80, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    const vout = (request, data) =>
      this.device.controlTransferOut(
        { requestType: 'vendor', recipient: 'interface', request, value: 0, index: 0 },
        data || new Uint8Array(0)
      );

    await this.device.controlTransferIn(
      { requestType: 'vendor', recipient: 'interface', request: 0x01, value: 0, index: 0 },
      1
    );
    await vout(0x00);
    await vout(0x43, cfg);
    await vout(0x23, cfg);
    await vout(0x41);
    await vout(0x21);

    const handshake = [
      [0x10, 0x02, 0x01, 0x03],
      [0x10, 0x03, 0x04, 0x04, 0x00],
      [0x10, 0x06, 0x02, 0x01, 0x00, 0x10, 0x00, 0x00],
      [0x10, 0x06, 0x02, 0x02, 0x00, 0x10, 0x00, 0x00],
      [0x10, 0x06, 0x02, 0x03, 0x00, 0x10, 0x00, 0x00],
      [0x10, 0x06, 0x02, 0x04, 0x00, 0x00, 0x00, 0x00],
      [0x10, 0x06, 0x02, 0x05, 0x00, 0x00, 0x00, 0x00],
      [0x10, 0x06, 0x02, 0x06, 0x00, 0x00, 0x00, 0x00],
      [0x10, 0x06, 0x02, 0x07, 0x00, 0x00, 0x00, 0x00],
    ];
    for (const frame of handshake) {
      await this.doMcspWrite(Uint8Array.from(frame));
      for (let i = 0; i < 4; i++) {
        if (!(await this.readNextFrame(2, 3))) break;
      }
    }
  }

  async close() {
    try {
      if (this.device && typeof this.device.releaseInterface === 'function') {
        await this.device.releaseInterface(0);
      }
    } catch (_) {}
    try {
      await this.device.close();
    } catch (_) {}
  }

  async doMcspWrite(payload) {
    const lengthBuf = new Uint8Array(4);
    new DataView(lengthBuf.buffer).setUint32(0, payload.length, true);
    await this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'interface', request: REQ_SET_OUT_SIZE, value: 0, index: 0 },
      lengthBuf
    );

    const padded = window.Bes3UsbAck.padPayload(payload);
    let transferred = false;
    // The frame is put on the wire exactly once.
    await this.device.transferOut(EP_OUT, padded);
    // From here on a later failure means "sent, not acknowledged", not "never
    // sent". The engine uses this to tell the user that the bike may have
    // applied the write and the read-back decides.
    transferred = true;

    try {
      for (let tries = 0; tries < 10; tries++) {
        const res = await this.device.controlTransferIn(
          { requestType: 'vendor', recipient: 'interface', request: REQ_GET_OUT_STATE, value: 0, index: 0 },
          3
        );
        if (res.status !== 'ok' || !res.data || res.data.byteLength < 3) {
          await sleep(20);
          continue;
        }
        const ack = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
        const state = window.Bes3UsbAck.ackState(ack);
        if (state.state === 'busy' || state.state === 'short') {
          await sleep(20);
          continue;
        }
        if (state.state === 'error') {
          throw new Error(`Write error, status byte = ${state.status}`);
        }
        return;
      }
      throw new Error('Write not acknowledged');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (transferred) err.transferred = true;
      throw err;
    }
  }

  async readNextFrame(maxPolls = 50, pollDelayMs = 5) {
    for (let i = 0; i < maxPolls; i++) {
      const res = await this.device.controlTransferIn(
        { requestType: 'vendor', recipient: 'interface', request: REQ_GET_IN_STATE, value: 0, index: 0 },
        7
      );
      if (res.status !== 'ok' || !res.data || res.data.byteLength < 4) {
        await sleep(pollDelayMs);
        continue;
      }
      const length = res.data.getUint32(0, true);
      if (length === 0 || window.Bes3UsbAck.exceedsMaxFrame(length)) {
        await sleep(pollDelayMs);
        continue;
      }
      const inRes = await this.device.transferIn(EP_IN, length);
      if (inRes.status !== 'ok') {
        if (inRes.status === 'stall' && typeof this.device.clearHalt === 'function') {
          try { await this.device.clearHalt('in', EP_IN); } catch (_) {}
        }
        await sleep(pollDelayMs);
        continue;
      }
      await this.device.controlTransferOut(
        { requestType: 'vendor', recipient: 'interface', request: REQ_SET_IN_DONE, value: 0, index: 0 },
        new Uint8Array(0)
      );
      if (!inRes.data || inRes.data.byteLength < length) {
        await sleep(pollDelayMs);
        continue;
      }
      return new Uint8Array(inRes.data.buffer, inRes.data.byteOffset, inRes.data.byteLength);
    }
    return null;
  }
}

window.Bes3WebUsb = { Bes3WebUsbTransport, requestDevice, VENDOR_ID, PRODUCT_IDS };
