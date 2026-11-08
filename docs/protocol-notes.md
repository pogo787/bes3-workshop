# BES3 protocol notes (clean-room)

This page records the protocol facts BES3 Workshop relies on. It is written
from this project's own observations and from factual wire-format descriptions
in the projects listed in [`docs/sources.md`](sources.md). No code, schema file,
test, or verbatim table from another project is reproduced here.

> **Scope:** Bosch Smart System (BES3) only. The same physical bus also carries
> manufacturer-specific protocols for other drive systems; they are out of
> scope.

## 1. Two layers

A diagnostic message travels in two wrappers:

1. **MCSP / GATT segmentation** — a short header and a payload, carried over
   USB bulk transfers or a BLE GATT characteristic.
2. **Message bus** — the payload of a channel-1 segmentation frame. It carries
   the source and destination node, a request type and a sequence number.

A single message-bus body may be split into several segmentation frames. A
segmentation frame may itself be split across BLE notifications; the receiver
must buffer partial headers and payloads.

## 2. Segmentation header

| Field | Bits | Meaning |
| --- | --- | --- |
| channel | `h0 >> 5` (3 bits) | `0` command, `1` message bus, `2`/`3` LBTP |
| end of channel | `h0 & 0x10` | `1` = last fragment of this message |
| length | `((h0 & 0x0f) << 8) \| h1` | payload length, 0–4095 |

Channel 0 carries transport commands. Channel 1 carries message-bus bodies.
Fragments on the same channel are concatenated until `end of channel` is set.

## 3. Command channel

| Command | Meaning |
| --- | --- |
| `0x01` | protocol version (BES3 uses version 3) |
| `0x02` | advance the transmit window |
| `0x03` | disable flow control for a channel |
| `0x04` | maximum segmentation packet size |

The Workshop sends version 3, a maximum segmentation packet of **244 bytes**
(247-byte ATT MTU minus 3) and disables flow control on channels 1–7. It then
waits briefly for the bike to acknowledge the version and packet-size commands
and proceeds best-effort if no acknowledgement arrives.

## 4. Message-bus header

Five bytes, followed by the body:

| Offset | Field |
| --- | --- |
| 0 | source high byte |
| 1 | source low byte |
| 2 | destination high byte (request: MSB set; response: MSB = success) |
| 3 | destination low byte |
| 4 | `(type << 4) \| sequence` |

A **request** sets the destination MSB. A **response** sets it only when the
response succeeded; a failed response clears it and puts an explicit status
byte first in the body. A **notification** sets the *source* MSB and has no
destination.

The Workshop's USB node address is `0x0e10`. Over BLE it appears as `0x4180`;
the transport rewrites the address in both directions and preserves the
success bit.

## 5. Message types

| Value | Type |
| --- | --- |
| `0` | READ |
| `1` | READ_RESPONSE |
| `2` | WRITE |
| `3` | WRITE_RESPONSE |
| `4` | RPC |
| `5` | RPC_RESPONSE |
| `6` | SUBSCRIBE |
| `7` | SUBSCRIBE_RESPONSE |
| `8` | UNSUBSCRIBE |
| `9` | UNSUBSCRIBE_RESPONSE |

The sequence nibble is chosen by the sender and echoed by the responder. The
Workshop matches a response on address **and** type **and** sequence; it never
reuses a pending sequence for a different target.

## 6. Response status

When a response is not successful, the first body byte is a status code:

| Code | Name |
| --- | --- |
| `0x00` | SUCCESS (normally implicit) |
| `0x01` | OVERLOADED |
| `0x02` | NO_ROUTE_FOUND |
| `0x03` | NOT_READY |
| `0x04` | UNSUPPORTED |
| `0x06` | DENIED |
| `0x07` | INVALID_VALUE |
| `0x08` | MALFORMED |
| `0x09` | TIMEOUT |
| `0x0a` | TOO_LARGE |

An acknowledgement is not proof that a value was applied. The Workshop judges
a write only by re-reading the register afterwards.

## 7. MobileApp peer (`0x40xx`)

During startup the bike treats the phone as a set of `MobileApp` objects and
sends them requests. The Workshop answers them so the bike can finish its
startup sequence. The answered datapoints are:

| Datapoint | Read answer |
| --- | --- |
| `0x81` UI_PRIORITY | `08 00` |
| `0x89` PHONE_SOC | the configured phone charge, or `UNSUPPORTED` |
| `0x9a` ALTITUDE_GRAPH_AVAILABLE_SAMPLES | `08 0a` |
| `0x9d` VISUALIZABLE_ISSUE_TYPES | `0a 04 00 01 02 03` |
| `0x9f` FEATURE_PROPERTIES_RELEASE4 | `08 01` |
| `0xa9` STARTUP_STAGE | the current stage, or `UNSUPPORTED` |
| `0xaa` STATIC_FEATURE_PROPERTIES | `18 01` (staged startup) |
| `0x82 0x85 0x86 0x87 0x88 0x94 0x96 0x97 0x98 0x99 0xa1 0xa2 0xa3 0xa8` | empty success |
| any other read | `UNSUPPORTED` |

Other request types:

- **WRITE** `0x40a9` accepts exactly `08 <stage>` with a stage of 0–9; any
  other body is `MALFORMED` and does not change the stored stage. Other writes
  are `UNSUPPORTED`.
- **RPC** `0x409b` (altitude graph) answers `22 00`; other RPCs are
  `UNSUPPORTED`.
- **SUBSCRIBE** always answers with an empty success.

Responses come from `0x41xx` (the addressed `MobileApp` object) and address the
requester with the success bit set. Failed responses clear that bit and carry a
status byte. The Workshop never answers response types or notifications.

## 8. Startup stage

The bike advances `STARTUP_STAGE` from 0 to 9 by writing `08 <stage>` to
`0x40a9`. Stage 9 means startup is complete. The Workshop waits up to a few
seconds for stage 9 and then proceeds best-effort; it never writes the stage
itself.

## 9. Known limitation

The shared USB parser in `src/protocol.js` reads a **single-octet** block
length. The BLE transport can reassemble a longer message, but it does not hand
anything above 255 bytes to that parser, because doing so would silently
truncate the payload. Reading the full 12-bit length in the shared parser is a
protocol change that needs explicit approval and a hardware test.

## 10. Provenance

The protocol facts above were cross-checked against the upstream projects
listed in [`docs/sources.md`](sources.md), including the Bosch BES3 material in
`bg443/BikeBridge` (GPL-3.0-or-later), which is used as a **read-only research
reference**. No BikeBridge code, schema file, test, or table is copied into
this repository. See [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) for
the licence boundary.
