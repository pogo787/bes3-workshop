# BES3 Workshop — Technical Guide & Architecture

**BES3 Workshop** (`index.html`) is a browser application for reading, configuring and documenting **Bosch Smart System (BES3)** eBikes via WebUSB and Web Bluetooth (`web/transport-webusb.js`, `web/transport-webble-mcsp.js`, `web/transport-webble.js`).

Open `index.html` in **Chrome** or **Edge** on Windows, macOS or Linux (`file://` works without a local server).

---

## Sections Overview

| Section | Purpose |
|---|---|
| **Overview** | Displays eBike model & speed class, odometer, Battery 1 & Battery 2 (DualBattery / PowerMore) state of charge, battery health (SoH), charge cycles, service interval status, bike light status, fault memory entries, detected hardware components, ride statistics per assistance mode, full system configuration, and active assistance mode parameters (`UDAM`). |
| **Configuration** | **Bike Light** (enable/disable light output, write the `BIKE_LIGHT_POWER` register with Workshop input bounds `1.0–18.0` in `0.1` steps — the scaling and electrical meaning are unverified and the operation is marked `known-issue`, configure startup behavior, and a direct **Turn light off / Turn light on** button for the current `BIKE_LIGHT` state), **Power Ports** (experimental and untested: enable/disable `LOW_POWER_PORT_ACTIVE` / `HIGH_POWER_PORT_ACTIVE` with a read-only state refresh, unchanged ports are never written), **Service Interval** (set reminder in 1 year, after +1,500 km, custom date/km, or clear reminder), and **ID Conflict & System ID Sync** (compare and synchronize `BIKE_ID` between drive unit and control unit), and the **Write Lab**: a registry-bound generic writer that writes one raw payload to one registry register at a time (component filter, live search, a value editor matched to the register kind, an optional raw hex payload). Configuration actions stage their rows in a `Pending changes` panel; one `Apply N changes` action sends the visible batch in order, and each write is re-read when the register is readable. The light on/off button is the one deliberate exception: it writes immediately, but keeps the same gates, audit log and independent read-back (see the write-safety doc). High-impact and read-only tiers require typing every full register name once per Apply batch. The gates are described in [`docs/workshop-write-safety.md`](docs/workshop-write-safety.md) and mapped in [`docs/write-path-map.md`](docs/write-path-map.md). |
| **Diagnostic Report** | Generates a multi-page A4 vector PDF report modeled after workshop diagnostic reports (Overview, Ride Statistics with mode breakdowns, operating hours & cadence, Components & Battery Information, Configuration & Assistance Modes, Software Versions with component photos when bundled locally or when opted in from `cdn.jsdelivr.net`, and optional Diagnostic Results), with customer reference, notes, optional identifier anonymization, and live preview. |
| **Connection doctor** | Read-only checklist shown after a failed USB connect. It classifies the error the browser returned, offers the Linux `108c` udev rule and Windows Zadig/WinUSB steps as copyable text, and never opens a device or sends a frame. |
| **Session Log** | Chronological audit log of every write operation performed during the session, showing exact hex bytes sent, before/after values, and read-back verification status. Also provides JSON readout export and raw protocol debug log download. The full JSON contains serial numbers, the System ID, the key-lock number, raw register payload bytes, Mini Remote probe bytes/addresses, BLE peer-database records and write-log payload bytes; the full debug log contains write/RPC payload bytes. Both offer an "Anonymise identifiers" switch (off by default): it masks identifiers, clears the bytes of identifier and BLE peer registers, reduces probe rows to component/name/status, and removes payload/read-back bytes from the log. An anonymised JSON export can still be opened again. |

**Try the simulated demo** runs against a simulated eBike (anonymised dataset in `web/workshop/demo-data.js`); **open a saved readout (.json)** loads exports.

The Configuration cards stack vertically. All five are dropdowns, closed by default; click a header to open it. The open state is kept while a control re-renders the view and cleared on a session change. Each card has its own line glyph in one shared neutral colour.

**Reconnect** uses one picker for USB, Bluetooth (MCSP) and Bluetooth (Live Data, read-only). The last used mode is preselected, an unavailable mode is disabled with its reason, and only one attempt runs at a time. Switching transport clears staged changes; nothing is replayed. The Live Data card shows *waiting for first value*, *live*, *stale* (with the last reception time) and *not available* per field; zero is a valid value.

Ride statistics can include an amber **Other** segment as the last entry in the distance and energy charts. It is calculated separately for each quantity as the bike's own total (`DriveUnit.ODOMETER` in metres or `Battery.TOTAL_ENERGY` in Wh) minus the sum of the tracked assistance modes, clamped to zero and hidden when it would round to `0.0 km` or `0.00 kWh`. If a total is missing or not numeric, Other is skipped for that quantity rather than guessed.

---

## Component detection

1. **Optional component probing:**
   - Core nodes (`DriveUnit`, `Battery`, `RemoteControl`) are always read.
   - Optional nodes (`HeadUnit`, `Battery2`, `ConnectModule`, `AntiLockBrakeSystem`) are probed with a single `PRODUCT_NAME` read first; if the node is not installed on the bike, its remaining addresses are skipped immediately.
2. **Control Unit vs. Wireless Mini Remote (`BRC3300`):**
   - The wired MCSP node `RemoteControl` (`0x2000`) represents the primary control unit (`System Controller BRC3100`, `LED Remote BRC3600`, `Frame Controller BRC3610`, `Purion 200 BRC3800`, or `Kiox 400C BRC3200`).
   - A **Mini Remote (`BRC3300`)** can be paired via Bluetooth in parallel to a System Controller or Purion 200. BES3 Workshop inspects `RemoteControl.BLE_CENTRAL_DATABASE` (`0x2210`) and `RemoteControl.DEVICE_DATABASE` (`0x2332`) when accessible, but shows the dedicated **Remote** card only when the strict `BRC3300` / `hasMiniRemote` marker is present. Without it there is no Remote card, probe block or PDF note.
3. **DualBattery / PowerMore & eShift Support:**
   - Automatically surfaces `Battery2` metrics (SoC, SoH, charge cycles) in the KPI grid, Configuration panel, and PDF report whenever a second battery is detected, and indicates `eShift` electronic shifting via `RemoteControl.E_SHIFT_AVAILABLE` (`0x216a`).
4. **S-Pedelec (45 km/h) Guard:**
   - Detects speed pedelecs (`MAXIMUM_LEGAL_BIKE_SPEED > 30 km/h`) and displays a safety warning if the user attempts to disable the light output.

---

## Fault Memory & Error Codes

The bike's fault memory RPC (`EXECUTE_INFORMATION_MANAGER_COMMAND_BOSCH`) returns a 32-bit integer `issueId`, timestamp, and occurrence count for each entry (indexed 0-based from `0` to `entryCount - 1`).

Bosch displays `issueId` as a 6-digit hexadecimal code: for example, decimal `1122304` = `0x112000` → **`112000`**.
- `web/workshop/issues.js` converts every `issueId` to its 6-digit hex code, provides built-in English summaries for common codes, and links directly to `https://help.bosch-ebike.com/en/help-center/error/<code>`.
- Clicking **Load error catalog** lets you load a full Bosch catalog JSON (`issues_<lang>_Rider.json`, see `docs/diagnostics.md` for extraction details), which is stored locally in `localStorage`.

---

## Connection Supervision & Reconnect
Bosch control units require a periodic keepalive RPC (`0x2106`) over USB.
- `web/workshop/engine.js` sends `0x2106` every 800 ms while idle and monitors both USB `transferOut` errors and consecutive missed keepalive responses.
- If a USB write fails or 3 consecutive keepalives go unanswered (about 2.4 s typically, up to about 3.5 s while a poll waits for its response), the app immediately transitions to **Connection lost**, locks write controls, preserves the last readout on screen, and displays a **Reconnect** button in the top bar and on every tab.

---

## Credits & License

**Project repository:** <https://github.com/pogo787/bes3-workshop>

**Protocol background (clean-room):** [`docs/protocol-notes.md`](docs/protocol-notes.md) — MCSP segmentation, message-bus framing, status codes, the `MobileApp` peer and the startup stage.

See **[Foundations & Acknowledgments](README.md#foundations--acknowledgments)** in `README.md` for the upstream sources and maintainer-provided contribution descriptions, and [`docs/sources.md`](docs/sources.md) for full provenance and license detail.

- **Project code:** MIT License (`LICENSE`).
- **Upstream licenses differ** — including CC BY 4.0 for researched data. This section intentionally does not duplicate the source list; see the links above.
- **`bg443/BikeBridge`** is a read-only research reference under **GPL-3.0-or-later**. No BikeBridge code or tables are part of this repository; only factual BLE/MCSP protocol observations were re-implemented independently.
