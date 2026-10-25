# BES3 Workshop for Bosch Smart System

A browser-based diagnostic reader, configuration workshop, and PDF report generator for **Bosch Smart System (BES3, 2022+)** eBikes over USB-C ([WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API)).

Everything runs **100% locally in your browser** (Chrome or Edge on Windows, macOS, or Linux) — no server, no account, no cloud upload, and no external network requests unless you explicitly opt in to loading component photos from `cdn.jsdelivr.net` for the current session. It works directly via `file://` or static hosting (such as GitHub Pages).

> **Important Legal & Safety Notice:** This is an independent, unofficial open-source project built for interoperability, right-to-repair diagnostics, and protocol research. It is **not affiliated with, authorized by, or endorsed by Robert Bosch GmbH**. Only use write functions if you understand what they do at the protocol level, have verified that your hardware (such as 12 V bike lamps) matches the configured ratings, and doing so complies with local laws.

---

## One Interface

1. **`index.html` — BES3 Workshop**
   - **Overview (Reader):** Reads all detected BES3 components (`DriveUnit`, `Battery`, `Battery2` / PowerMore / DualBattery, `RemoteControl`, wireless `MiniRemote` status only when the strict `BRC3300` marker is detected, `HeadUnit` display, `ConnectModule`, `AntiLockBrakeSystem`, and `eShift` status), battery State of Health (SoH), full charge cycles, lifetime energy delivered, ride statistics per assistance mode, fault memory (`Issue` entries with 6-digit hex codes and Help Center links), and full bike configuration.
   - **Configure (Writer):**
     - **Bike Light Unlock & Configuration:** Enable or disable the 12 V bike light output (`0x1820`), configure startup light behavior (`0x1821`), set rated light power (`0x1822`, `1.0–18.0 W` in `0.1 W` steps; marked **known issue / observed not working** on tested bikes), and toggle the light (`0x181c`). Includes an S-Pedelec safety guard.
     - **Service Interval Reminder:** Set the next service reminder by date (`+1 year`), distance (`+1,500 km`), custom date/km, or clear the stored reminder (`RemoteControl.SERVICE_DUE`, `0x2185`).
     - **ID Conflict & System ID Sync (Experimental):** Compares `DriveUnit.BIKE_ID` (`0x182c`) against `RemoteControl.BIKE_ID` (`0x2184`) and provides a verified write tool to synchronize the drive unit's 16-byte System ID UUID into the control unit.
   - **Diagnostic Report (A4 Vector PDF):** Generates a multi-page A4 PDF report (Overview, Ride Statistics with mode breakdowns, operating hours & cadence, Components & Battery Information, Configuration & Assistance Modes, Software Versions with component thumbnails when local photos are bundled or when remote photos are opted in for the session, and optional Fault Memory page), with live preview and optional identifier anonymization.
   - **Session Log & Reconnect Handling:** Active USB keepalive monitoring (`0x2106`) polls every 800 ms and detects cable drops or bike power-off after three unanswered polls (about 2.4 s in the typical case, up to about 3.5 s when each poll also waits for its response). Every page offers a **Reconnect** button. Every write operation is logged with raw hex bytes, before/after values, and read-back verification status.
   - **Connection doctor (read-only):** A failed USB connect shows a classified checklist with the Linux udev rule for vendor id `108c` and the Windows Zadig/WinUSB steps as copyable text. It classifies only the errors and states the Workshop already sees and sends no frame.
   - **Battery health (read-only heuristic):** Shows SoH, full cycles, lifetime energy, Wh per full cycle and min/max pack temperature with a conservative traffic light. Thresholds live in one documented object; the card says **Heuristic, not a Bosch rating.**
   - **Registry browser (read-only):** Search the existing address registry by component, register, address, kind, tier or evidence. `Read now` appears only for readable entries and calls the existing single-register read path on a live connection; there is no write control. The read-only remote probe is reachable from this view.
   - **Live Demo & Offline Viewer:** Built-in simulated eBike (**Try the simulated demo**) and offline `.json` readout viewer (compatible with BES3 Workshop exports).

---

## Hardware Compatibility Across Bosch BES3 eBikes

The protocol core and Workshop UI are designed to work across the entire Bosch Smart System (BES3) lineup:

- **Control Units (`RemoteControl`):** System Controller (`BRC3100`), LED Remote (`BRC3600`), Frame Controller (`BRC3610`), Purion 200 (`BRC3800`), Kiox 400C (`BRC3200`), plus separate detection of paired wireless accessories such as the **Mini Remote (`BRC3300`)**. The Remote card is shown only when the BLE peer database carries the `BRC3300` marker.
- **Drive Units (`DriveUnit`):** Performance Line CX (`BDU374x`, `BDU384x`), Performance Line CX Race (`BDU376x`, `BDU386x`), Performance Line SX (`BDU314x`), Performance Line Speed (`BDU378x`, `BDU388x`), Performance Line / PX / Sport (`BDU336x`, `BDU338x`, `BDU346x`, `BDU347x`, `BDU348x`), Active Line / Active Line Plus (`BDU332x`, `BDU334x`, `BDU344x`), Cargo Line, and Hub Line (`BDU306x`).
- **Batteries (`Battery` & `Battery2`):** PowerTube 360 / 500 / 540 / 600 / 625 / 720 / 750 / 800, CompactTube 400, PowerPack 400 / 500 / 545 / 600 / 725 / 800 (Frame & Rack), and PowerMore 250 range extender (`BBP362`).
- **Displays & Optional Modules:** Kiox 300 (`BHU3600`), Kiox 500 (`BHU3700`), Purion 400 (`BHU3500`), Intuvia 100 (`BHU32000`), ConnectModule (`BCM3100` / `BCM3101`), Bosch eBike ABS / ABS Pro (`BAS3311` / `BAS35`), and eShift electronic shifting.

Optional bus nodes (`HeadUnit`, `Battery2`, `ConnectModule`, `AntiLockBrakeSystem`) are probed non-intrusively via `PRODUCT_NAME` first; if absent on a given bike, their remaining registers are skipped cleanly so readouts stay fast and error-free on any hardware configuration.

---

## Quick Start

### 1. Run in the Browser (No Installation Required)
1. Clone or download this repository.
2. Open **`index.html`** in **Google Chrome** or **Microsoft Edge** on Windows, macOS, or Linux.
3. Switch on your eBike and connect a **USB-C data cable** to the diagnostic/charging USB port on your control unit.
4. Click **Connect eBike via USB** and select your Bosch device in the browser prompt.

> **Windows Driver Note:** If the device appears in the browser picker but fails to open on Windows, Windows may have bound a generic driver instead of `WinUSB`. You can assign the `WinUSB` driver to the Bosch USB interface using [Zadig](https://zadig.akeo.ie/).

### 2. Node CLI (Optional)
```bash
cd node
npm install
node cli.js
```

---

## How Verified Writing Works

Over USB, Bosch Smart System components often acknowledge a `WRITE` frame (`0x02`) with `WRITE_RESPONSE` (`0x03`, status `SUCCESS = 0x00`) and an empty payload — both when a change is accepted and when it is silently ignored by firmware policy.

Therefore, **BES3 Workshop never trusts `WRITE_RESPONSE` alone**:
1. Configure actions stage changes in a visible `Pending changes` panel. Each row shows the affected register, decoded old → new value, exact hexadecimal payload, tier and evidence. One `Apply N changes` action sends the visible batch in order; high-impact and read-only rows ask for the full register name once per batch.
2. After sending the `WRITE` frame and waiting for the controller to settle, the engine performs an independent **`READ` request** on the target address.
3. A step is marked **verified** only if the re-read payload decodes to the expected target value. If any step in a multi-step sequence is not verified, execution stops immediately.

### Documented Write Datapoints in BES3 Workshop

| Feature | Component & Datapoint | Address | Wire Encoding (Protobuf) |
|---|---|---|---|
| Bike light installed | `DriveUnit.BIKE_LIGHT_AVAILABLE` | `0x1820` | `08 01` = enabled, empty (`""`) = disabled |
| Light startup config | `DriveUnit.BIKE_LIGHT_CONFIGURATION` | `0x1821` | `08 02` = remember last light state on power-up, empty = `0` |
| Light power rating | `DriveUnit.BIKE_LIGHT_POWER` | `0x1822` | Field 1 varint in `0.1 W` units (`1.0–18.0 W`, e.g. `6.0 W` → `08 3c`, `12.0 W` → `08 78`) |
| Light switch | `DriveUnit.BIKE_LIGHT` | `0x181c` | `08 01` = on, empty (`""`) = off |
| Service interval | `RemoteControl.SERVICE_DUE` | `0x2185` | `{1: Timestamp{1: sint64 seconds}, 2: uint32 meters}`, empty = cleared |
| System ID sync | `RemoteControl.BIKE_ID` | `0x2184` | `0a 12 0a 10 <16-byte UUID>` (matched against `DriveUnit.BIKE_ID` `0x182c`) |

See [`WORKSHOP.md`](WORKSHOP.md) for detailed technical documentation of BES3 Workshop.

---

## Repository Hygiene & Privacy Guard

Keep bike-specific and personal data (real serial numbers, device certificates, raw PCAP captures) out of public commits. The optional pre-commit hook (`githooks/pre-commit`) scans staged changes and blocks commits containing real Bosch serial number patterns (`NNNNN-NNNN-NN-XXX-NN-NNNN`).

**What the exports contain.** The PDF report, the JSON readout export
("Save readout (.json)") and the debug log can contain personal data of the
bike. The full JSON export contains the serial numbers of every component, the
Bosch System ID (`BIKE_ID`), the battery key-lock number, the raw payload bytes
(`hex`) of every read register, the Mini Remote probe rows (when a probe is run from the Registry browser) with their raw bytes
and address-like values, the BLE peer-database records, and the payload bytes in
the write log. The full debug log contains the write and RPC payload bytes.

The PDF report and the log view both offer an **"Anonymise identifiers"** switch
(off by default). In the PDF it masks the identifiers. In the JSON export it
masks the identifier displays, clears the raw bytes of identifier registers and
BLE peer registers, reduces every probe row to `component`, `name` and `status`,
and removes payload and read-back bytes from the write log. In the debug log it
removes the payload bytes of every entry. An anonymised JSON export can still be
opened again, but the removed bytes cannot be recovered from it.

Enable the hook once after cloning:
```bash
git config core.hooksPath githooks
```

The hook is local and opt-in. CI runs both `node tools/check-all.mjs` and
`node tools/check-workshop-light.mjs` on every push and pull request via
`.github/workflows/check.yml`; a fresh clone cannot skip that job.

---

## Foundations & Acknowledgments

BES3 Workshop builds on the protocol research and open-source work of three upstream projects. The descriptions below are the maintainer-provided contribution summaries; see [`docs/sources.md`](docs/sources.md) for provenance, upstream file references, verified commit refs, and license detail.

- **[`rweijnen/bosch-bes3-reader`](https://github.com/rweijnen/bosch-bes3-reader)** by **Remko Weijnen** — Protocol core, WebUSB transport, address registry, fault-memory RPCs, and part images.
- **[`radiohound/bosch-smart-system-ble`](https://github.com/radiohound/bosch-smart-system-ble)** by **radiohound** — Smart System BLE/MCSP research, write-behavior and response-handling insights, and research informing verify-by-reread.
- **[`revlat/bes3-analyzer`](https://github.com/revlat/bes3-analyzer/tree/main)** by **revlat** — CAN-bus datapoint analysis and cross-verification of light and service-interval addresses.

---

## License

This repository ships two license files with different scopes:

- [`LICENSE`](LICENSE) — **MIT**, covering this project's application code (Workshop UI, engines, transports, tooling).
- [`LICENSE-DATA`](LICENSE-DATA) — **CC BY 4.0**, covering the researched data (the address registry, generated reference documentation, and other reverse-engineered datasets). This file is reproduced verbatim from `rweijnen/bosch-bes3-reader`; it does not extend to bundled component images, third-party libraries, or other assets, whose own provenance governs their terms.

Licenses differ per upstream source and are **not** all MIT:

- **Code** from [`rweijnen/bosch-bes3-reader`](https://github.com/rweijnen/bosch-bes3-reader) (protocol core, transports, build tooling, part images) — MIT.
- **Researched data** from the same project (the address registry and derived datasets) — **CC BY 4.0**, attribution required; see [`LICENSE-DATA`](LICENSE-DATA).
- [`radiohound/bosch-smart-system-ble`](https://github.com/radiohound/bosch-smart-system-ble) documentation/data — **CC BY 4.0** (by redundo.app); any source code — MIT.
- [`revlat/bes3-analyzer`](https://github.com/revlat/bes3-analyzer/tree/main) — MIT.
- **`jsPDF`** (`web/vendor/jspdf.umd.min.js`) — MIT License (`(c) 2010-2021 James Hall, (c) 2015-2021 yWorks GmbH`).

Attribution is also reproduced in the Workshop UI and PDF footers. See [`docs/sources.md`](docs/sources.md) for full provenance, [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for third-party notices, [`docs/public-release.md`](docs/public-release.md) for public release packaging, [`SECURITY.md`](SECURITY.md) for security and safety reporting, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution rules.
