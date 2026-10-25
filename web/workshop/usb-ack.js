// BES3 Workshop - USB write acknowledgement state machine (pure)
// -----------------------------------------------------------------------------
// After a write frame has been transferred to the drive unit, the USB bridge
// reports the state of its OUT endpoint with a three-byte answer:
//
//   byte 0  - the endpoint state (3 = still busy)
//   byte 1  - the acknowledgement kind (3 = busy, otherwise the result)
//   byte 2  - the ResponseMessageStatusCode (0 = SUCCESS)
//
// The state machine is pure and DOM-free so it can be unit tested with a fake
// USBDevice: the busy retry, the error status, the ACK timeout, the 64-byte
// padding and the size guard are all decided here, not inside the transport.
//
// Loaded as a plain <script> in index.html (into window.Bes3UsbAck) and as a
// CommonJS module by the Node regression runner.
// -----------------------------------------------------------------------------
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Bes3UsbAck = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const BLOCK_SIZE = 64;
  const MAX_FRAME = 65536;

  // ackState(bytes) -> { state, status }
  //   state: 'busy'   - the bridge is still busy, try again
  //          'error'  - the bike refused the write (status byte is set)
  //          'ok'     - the write was accepted
  //          'short'  - the answer was too short to decide, try again
  function ackState(bytes) {
    if (!bytes || bytes.length < 3) return { state: 'short', status: null };
    if (bytes[1] === 3) return { state: 'busy', status: null };
    if (bytes[2] !== 0) return { state: 'error', status: bytes[2] };
    return { state: 'ok', status: 0 };
  }

  // padPayload(payload) -> the payload padded to the 64-byte block size the USB
  // endpoint expects.
  function padPayload(payload) {
    const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload || []);
    const padding = bytes.length % BLOCK_SIZE;
    const out = new Uint8Array(padding > 0 ? bytes.length + (BLOCK_SIZE - padding) : bytes.length);
    out.set(bytes);
    return out;
  }

  // exceedsMaxFrame(length) -> true when the frame is larger than the maximum
  // the transport may send.
  function exceedsMaxFrame(length) {
    return Number(length) > MAX_FRAME;
  }

  return { ackState, padPayload, exceedsMaxFrame, BLOCK_SIZE, MAX_FRAME };
});
