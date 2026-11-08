# BES3 Workshop for Bosch Smart System

Browser-based diagnostic reader, configuration tool and PDF report generator for
Bosch Smart System (BES3, 2022+) eBikes over USB-C (WebUSB) and Bluetooth (Web
Bluetooth). Unofficial; not affiliated with, authorized by, or endorsed by
Robert Bosch GmbH.

**Project repository:** <https://github.com/pogo787/bes3-workshop>

## Facts

| | |
| --- | --- |
| Entry point | `index.html`, a single page with no build step |
| Transports | `web/transport-webusb.js` (USB-C), `web/transport-webble-mcsp.js` (MCSP/MessageBus over Web Bluetooth), `web/transport-webble.js` (read-only BLE Live Data Interface) |
| Browser | Chrome or Edge on Windows, macOS or Linux. WebUSB requires a secure context; reads work from `file://`. |
| Data flow | Reading, decoding, writing and report generation run in the browser. Exports are local files. A same-origin `deploy-info.txt` request checks the deployed version. |
| External requests | None by default. Component photos load from `cdn.jsdelivr.net` only after the per-session opt-in button in the header. |
| Optional CLI | `cd node && npm install && node cli.js` |
| Version | `POLICY.VERSION` in `web/workshop/write-policy.js` is the single source of truth. The top entry of [`docs/CHANGELOG.md`](docs/CHANGELOG.md) and the `data-version` stamp in `index.html` must match it; a source check enforces this. |
| Licenses | MIT for application code, CC BY 4.0 for researched data. See [License](#license). |

Legal: independent interoperability project. Use writes only if you understand the
register, have checked the connected hardware, and are permitted under local law.

## Features

- **Overview.** Reads detected components (`DriveUnit`, `Battery`, `Battery2`,
  `RemoteControl`, `HeadUnit`, `ConnectModule`, `AntiLockBrakeSystem`, `eShift`,
  and wireless `MiniRemote` only when the `BRC3300` marker is present), battery
  State of Health, charge cycles, lifetime energy, per-mode ride statistics,
  fault memory with 6-digit hex codes, and the system configuration.
- **Configuration.** Staged writes to the bike light registers, the service interval,
  the two accessory power-port registers, the System ID, and a registry-bound
  Write Lab. The power-port card is experimental and untested. Actions are staged in a
  `Pending changes` panel and applied as one visible batch; each write is re-read
  where the register is readable. The light on/off button is the one exception: it
  writes immediately, still with the same gates, audit log and read-back. High-impact
  and read-only tiers require typing the full register name once per batch. The gates
  are documented in [`docs/workshop-write-safety.md`](docs/workshop-write-safety.md)
  and [`docs/write-path-map.md`](docs/write-path-map.md).
- **Reconnect and Bluetooth Live Data.** One reconnect picker offers USB,
  Bluetooth (MCSP) and read-only Bluetooth (Live Data), preselecting the last mode
  and disabling unavailable ones with the reason. The Live Data card shows waiting,
  live, stale and per-field not-available states; zero is a valid value. MCSP is a
  snapshot read protocol; continuous telemetry is the separate Live Data mode.
- **Diagnostic Report.** Multi-page A4 vector PDF with live preview and optional
  identifier anonymisation. Component photos appear only when bundled locally or
  opted in for the session.
- **Session Log.** Chronological write log with raw hex bytes, before/after
  values and read-back status; JSON readout export and raw protocol log download.
- **Connection doctor.** Read-only classified checklist after a failed USB or
  Bluetooth connect; sends no frames.
- **Demo and offline viewer.** Built-in simulated bike and a `.json` readout
  viewer.

## Recognized component identifiers

Registry identifiers; not a hardware compatibility claim.

- **Control units (`RemoteControl`):** `BRC3100`, `BRC3600`, `BRC3610`,
  `BRC3800`, `BRC3200`; wireless `BRC3300` Mini Remote detected via the BLE peer
  database.
- **Drive units (`DriveUnit`):** `BDU374x`, `BDU384x`, `BDU376x`, `BDU386x`,
  `BDU314x`, `BDU378x`, `BDU388x`, `BDU336x`, `BDU338x`, `BDU346x`, `BDU347x`,
  `BDU348x`, `BDU332x`, `BDU334x`, `BDU344x`, `BDU306x`.
- **Batteries (`Battery`, `Battery2`):** PowerTube 360/500/540/600/625/720/750/800,
  CompactTube 400, PowerPack 400/500/545/600/725/800, PowerMore 250 (`BBP362`).
- **Displays and modules:** `BHU3600`, `BHU3700`, `BHU3500`, `BHU32000`,
  `BCM3100`, `BCM3101`, `BAS3311`, `BAS35`, eShift.

Optional bus nodes (`HeadUnit`, `Battery2`, `ConnectModule`,
`AntiLockBrakeSystem`) are probed with `PRODUCT_NAME` first; when absent, their
remaining registers are skipped.

## Quick start

1. Clone or download this repository.
2. Open `index.html` in Chrome or Edge.
3. Switch on the eBike and connect a USB-C data cable to the diagnostic port on
   the control unit.
4. Click **Connect eBike via USB** and select the Bosch device in the browser
   prompt.

On Windows, if the device appears in the picker but fails to open, the interface
may need the `WinUSB` driver assigned with [Zadig](https://zadig.akeo.ie/). The
connection doctor shows the Linux udev rule for vendor id `108c` and the Windows
steps as copyable text.

## Write verification

Over USB, a `WRITE` frame (`0x02`) is commonly answered with a `WRITE_RESPONSE`
(`0x03`, `SUCCESS = 0x00`) carrying an empty payload — both when a change is
accepted and when firmware ignores it. An acknowledgement is therefore not
treated as proof that a value was applied.

1. Configuration actions stage changes in a visible `Pending changes` panel. Each row
   shows the register, decoded old → new value, exact hexadecimal payload, tier
   and evidence. One `Apply N changes` action sends the batch in order.
2. After the write frame, the engine issues an independent `READ` on the target
   address.
3. A step is reported as **verified** only when the fresh read-back matches the
   requested value. A failed step stops the remaining batch. Nothing is retried
   or rolled back.

### Write datapoints

| Feature | Component & datapoint | Address | Payload written by the Workshop |
| --- | --- | --- | --- |
| Bike light installed | `DriveUnit.BIKE_LIGHT_AVAILABLE` | `0x1820` | `08 01` = enabled, empty = disabled |
| Light startup config | `DriveUnit.BIKE_LIGHT_CONFIGURATION` | `0x1821` | `08 02` = remember last state on power-up, empty = `0` |
| Light power register | `DriveUnit.BIKE_LIGHT_POWER` | `0x1822` | Field 1 varint = `round(input × 10)`. The Workshop bounds input to 1.0–18.0 in 0.1 steps. **The ×10 scaling and the register's electrical meaning are not independently verified.** The operation is marked `known-issue`: writes were acknowledged and read back on tested bikes without an observed change in lamp output. |
| Light switch | `DriveUnit.BIKE_LIGHT` | `0x181c` | `08 01` = on, empty = off |
| Service interval | `RemoteControl.SERVICE_DUE` | `0x2185` | `{1: Timestamp{1: sint64 seconds}, 2: uint32 meters}`, empty = cleared |
| System ID sync | `RemoteControl.BIKE_ID` | `0x2184` | `0a 12 0a 10 <16-byte UUID>` (matched against `DriveUnit.BIKE_ID` `0x182c`) |
| Low Power Port | `DriveUnit.LOW_POWER_PORT_ACTIVE` | `0x1831` | `08 01` = enable, `08 00` = disable (**experimental, untested**) |
| High Power Port | `DriveUnit.HIGH_POWER_PORT_ACTIVE` | `0x1832` | `08 01` = enable, `08 00` = disable (**experimental, untested**) |

The power-port rows are the Workshop's own unverified payload assumption. The
address registry lists both registers with kind `unknown` and no confirmed
encoding; a matching read-back does not establish a physical effect, correct
wiring or persistence after a restart. No hardware validation has been
performed. Unchanged ports and ports whose stored payload already matches are
never written; unknown values are never treated as off. Both port registers are
normal-tier, so the staged batch needs no typed-name confirmation, but it still
uses the one-shot grant, one write and a read-back.

The 1.0–18.0 / 0.1-step bounds in the light-power row are input-validation
limits of this application, not a verified register specification. See
[`docs/investigation-light-power.md`](docs/investigation-light-power.md) for the
evidence boundary.

See [`WORKSHOP.md`](WORKSHOP.md) for the technical guide.

## Repository hygiene & privacy guard

Keep bike-specific and personal data (real serial numbers, device certificates,
raw PCAP captures) out of public commits. The optional pre-commit hook
(`githooks/pre-commit`) blocks staged changes containing Bosch serial number
patterns (`NNNNN-NNNN-NN-XXX-NN-NNNN`). Enable it with
`git config core.hooksPath githooks`.

The PDF report, the JSON readout export ("Save readout (.json)") and the debug
log can contain personal data: component serial numbers, the Bosch System ID
(`BIKE_ID`), the battery key-lock number, raw payload bytes of read registers,
Mini Remote probe rows, BLE peer-database records and write-log payload bytes.

The PDF report and log view offer an **"Anonymise identifiers"** switch (off by
default). In the PDF it masks identifiers. In the JSON export it masks
identifier displays, clears raw bytes of identifier and BLE peer registers,
reduces probe rows to `component`, `name` and `status`, and removes payload and
read-back bytes from the write log. In the debug log it removes payload bytes.
An anonymised JSON export can still be opened, but the removed bytes cannot be
recovered.

CI runs `node tools/check-all.mjs` and `node tools/check-workshop-light.mjs` on
every push and pull request via `.github/workflows/check.yml`.

## Foundations & Acknowledgments

Contribution descriptions below are the maintainer-provided summaries; see
[`docs/sources.md`](docs/sources.md) for provenance, upstream file references,
verified commit refs and license detail.

- **[`rweijnen/bosch-bes3-reader`](https://github.com/rweijnen/bosch-bes3-reader)** by **Remko Weijnen** — Protocol core, WebUSB transport, address registry, fault-memory RPCs and part images.
- **[`radiohound/bosch-smart-system-ble`](https://github.com/radiohound/bosch-smart-system-ble)** by **radiohound** — Smart System BLE/MCSP research, write-behavior and response-handling insights, and research informing verify-by-reread.
- **[`revlat/bes3-analyzer`](https://github.com/revlat/bes3-analyzer/tree/main)** by **revlat** — CAN-bus datapoint analysis and cross-verification of light and service-interval addresses.
- **[`bg443/BikeBridge`](https://codeberg.org/bg443/BikeBridge)** by **bg443** — Read-only research reference for Bosch BES3 BLE/MCSP segmentation, `MobileApp` peer request handling, registration ordering and assist-mode schemas. **GPL-3.0-or-later; no code copied.**

## License

Two license files with different scopes:

- [`LICENSE`](LICENSE) — **MIT**, covering this project's application code (Workshop UI, engines, transports, tooling).
- [`LICENSE-DATA`](LICENSE-DATA) — **CC BY 4.0**, covering the researched data (the address registry, generated reference documentation and other reverse-engineered datasets). Reproduced verbatim from `rweijnen/bosch-bes3-reader`; it does not extend to bundled component images, third-party libraries or other assets.

Licenses differ per upstream source:

- Code from [`rweijnen/bosch-bes3-reader`](https://github.com/rweijnen/bosch-bes3-reader) — MIT.
- Researched data from the same project — **CC BY 4.0**, attribution required; see [`LICENSE-DATA`](LICENSE-DATA).
- [`radiohound/bosch-smart-system-ble`](https://github.com/radiohound/bosch-smart-system-ble) documentation/data — **CC BY 4.0** (by redundo.app); source code — MIT.
- [`revlat/bes3-analyzer`](https://github.com/revlat/bes3-analyzer/tree/main) — MIT.
- [`bg443/BikeBridge`](https://codeberg.org/bg443/BikeBridge) — **GPL-3.0-or-later**, research reference only. No BikeBridge code, schema files or tables are copied into this repository, so its copyleft does not extend to this project. Nothing from it is relicensed as MIT or CC BY 4.0.
- `jsPDF` (`web/vendor/jspdf.umd.min.js`) — MIT (`(c) 2010-2021 James Hall, (c) 2015-2021 yWorks GmbH`).

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for third-party notices,
[`docs/public-release.md`](docs/public-release.md) for public release
packaging, [`SECURITY.md`](SECURITY.md) for security and safety reporting, and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution rules.
