# Third-Party Notices

BES3 Workshop incorporates or builds upon the following third-party open-source
software and researched datasets.

---

## 1. Vendored Runtime Library

### jsPDF (`web/vendor/jspdf.umd.min.js`)
- **License:** MIT License
- **Copyright:** `(c) 2010-2021 James Hall, https://github.com/MrRio/jsPDF` and
  `(c) 2015-2021 yWorks GmbH, https://www.yworks.com/` (plus contributors listed
  in `web/vendor/jspdf.umd.min.js`).
- **Scope:** Client-side PDF generation in `web/workshop/report-pdf.js`.

---

## 2. Upstream Open-Source Projects & Datasets

See [`docs/sources.md`](docs/sources.md) for full provenance, verified commit
hashes, and file-level categorization.

### `rweijnen/bosch-bes3-reader`
- **Author:** Remko Weijnen (`https://github.com/rweijnen/bosch-bes3-reader`)
- **Inspected commit:** `cd9a5510ae1091c467d8d5a586a23723c17a9249`
- **Code License:** MIT License (`Copyright (c) 2026 rweijnen`) — covers adapted
  protocol framing (`src/protocol.js`, `src/messageTypes.js`), USB transports
  (`web/transport-webusb.js`, `node/transport-node-usb.js`), and build scripts.
- **Data License:** Creative Commons Attribution 4.0 International
  (**CC BY 4.0**, see [`LICENSE-DATA`](LICENSE-DATA)) — covers
  `src/address-registry.json`, `src/address-registry.generated.js`, and
  generated reference documentation (`docs/address-registry.md`,
  `docs/write-lab-tier-list.md`).

### `radiohound/bosch-smart-system-ble`
- **Author:** radiohound / redundo.app
  (`https://github.com/radiohound/bosch-smart-system-ble`)
- **Inspected commit:** `97def2bbbfae0d373e67d9cd3911c1dae35f4323`
- **License:** Documentation and data under **CC BY 4.0** (attributed to
  `redundo.app`); source code under the **MIT License**.
- **Scope:** Research reference for Smart System MCSP/BLE write-response
  semantics and verify-by-reread architecture (no code files copied).

### `revlat/bes3-analyzer`
- **Author:** revlat (`https://github.com/revlat/bes3-analyzer`)
- **Inspected commit:** `46fd5c374934ab3f6bf4825c464f57afdda80746`
- **License:** MIT License (`Copyright (c) 2025 revlat`).
- **Scope:** Research reference for CAN-FD datapoint analysis (no code files
  copied).

### `bg443/BikeBridge`
- **Author:** bg443 (`https://codeberg.org/bg443/BikeBridge`)
- **Inspected revision:** maintainer-supplied source archive, reviewed
  2026-11-07 (the archive carries no commit metadata).
- **License:** GNU General Public License v3.0 or later
  (**GPL-3.0-or-later**).
- **Scope:** Read-only research reference for the Bosch BES3 (Smart System)
  BLE/MCSP protocol only: segmentation framing and reassembly, `MobileApp`
  (`0x40xx`) peer request handling, registration ordering, and assist-mode
  message schemas.
- **No code copied.** Because BikeBridge is GPL-3.0-or-later and this project
  is MIT (code) plus CC BY 4.0 (researched data), no BikeBridge source file,
  Kotlin class, generated protobuf module, test, or verbatim table is
  redistributed here. Only factual wire-protocol observations were studied and
  independently re-implemented. BikeBridge is credited by name and URL; nothing
  from it is relicensed under this project's licenses.

---

## 3. Trademarks

All product names, logos, brands, and trademarks mentioned in this repository
(including Bosch, Smart System, Kiox, Purion, Intuvia, System Controller, Mini
Remote, Performance Line, Active Line, Cargo Line, PowerTube, PowerPack,
PowerMore, ConnectModule, eBike Lock, and eShift) are the property of Robert
Bosch GmbH or their respective owners. Their use is strictly nominative for
identification, diagnostics, and interoperability research. This project is
independent and is not affiliated with, authorized by, or endorsed by Robert
Bosch GmbH.
