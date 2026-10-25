# Upstream sources and provenance

This repository builds on three upstream open-source projects. This file
records their repository URLs, the maintainer-provided contribution
descriptions, the license terms verified during review, and how each
source relates to this codebase.

It deliberately separates three things that are easy to conflate:

1. **Maintainer-provided attribution** — the contribution descriptions
   supplied by this project's maintainer. These are the project's own
   statements and are not, by themselves, independent evidence.
2. **Independently verified upstream evidence** — README/LICENSE text,
   directory listings, and commit metadata retrieved read-only from the
   upstream repositories during this review (2026-10-18).
3. **Upstream changes** — ongoing work in those repositories. Upstream
   changes are research input, not authorization to change this project's
   protocol addresses, write behavior, keepalive, or safety checks.

No repositories were cloned and no upstream code was executed. Commit
hashes below identify the revision inspected on `main` at review time;
they are not pinned dependencies and may have advanced since.

## Sources at a glance

| Source | Contribution (maintainer-provided) | License (verified) | Inspected `main` head |
|---|---|---|---|
| [`rweijnen/bosch-bes3-reader`](https://github.com/rweijnen/bosch-bes3-reader) | Protocol core, WebUSB transport, address registry, fault-memory RPCs, part images, and the Classic Reader | Code MIT; data CC BY 4.0 (`LICENSE-DATA`) | `cd9a5510ae1091c467d8d5a586a23723c17a9249` |
| [`radiohound/bosch-smart-system-ble`](https://github.com/radiohound/bosch-smart-system-ble) | Smart System BLE/MCSP research, write-behavior and response-handling insights, and research informing verify-by-reread | Docs/data CC BY 4.0 (redundo.app); code MIT | `97def2bbbfae0d373e67d9cd3911c1dae35f4323` |
| [`revlat/bes3-analyzer`](https://github.com/revlat/bes3-analyzer/tree/main) | CAN-bus datapoint analysis and cross-verification of light and service-interval addresses | MIT (Copyright 2025 revlat) | `46fd5c374934ab3f6bf4825c464f57afdda80746` |

## How each source relates to this repository

### Copied or adapted code

Only one upstream source contributes code or generated artifacts that are
present in this repository:

- **`rweijnen/bosch-bes3-reader`** — the protocol core
  (`src/protocol.js`, `src/messageTypes.js`), the address registry
  (`src/address-registry.json`), the transports
  (`node/transport-node-usb.js`, `web/transport-webusb.js`), the component
  photographs (`web/parts/`), and (historically) the Classic Reader page
  (`index.html`; removed from this repository in 0.5.0, retained in git
  history). These are adapted from upstream's `src/`, `node/`, `web/`, and
  `index.html`.
  Upstream `README.md` (verified) describes the same layout and states that
  `src/address-registry.json` is the single authoritative source for every
  address.

### Research references (no code copied)

- **`radiohound/bosch-smart-system-ble`** — used as research input. The
  local `README.md` cites its write-behavior and response-handling insights;
  the upstream accessibility matrix (`data/ble_accessibility.csv`) is research
  input but is not cited by the local README. No files from this source are
  copied into this repository; the BLE transports and demo fixtures are local
  work.
- **`revlat/bes3-analyzer`** — used as research input for cross-checking
  datapoints. No files are copied.
- **Bosch eBike Help Center error pages** — the short English error summaries
  in `web/workshop/issues.js` are paraphrased from
  `https://help.bosch-ebike.com/en/help-center/error/<code>` (for example
  `https://help.bosch-ebike.com/en/help-center/error/112000`). The URL and the
  paraphrasing relationship were recorded on 2026-10-23; the pages were not
  re-fetched during Batch 6. The summaries are not copied wholesale, and no
  open-source license is asserted for Bosch's help-center content. The
  official page remains authoritative; the Workshop also links to it and can
  import a user-supplied official catalog.

### Local additions (not upstream)

- The BES3 Workshop application: `web/workshop/*` (engine, UI, demo mode,
  PDF report, and the error-summary table that paraphrases Bosch help-center
  pages), the Workshop page `index.html`, and
  `tools/build-workshop-demo.js`.
- `docs/` content authored for this repository (this file, `diagnostics.md`,
  `README.md`), and the write-verification / keepalive behavior in
  `web/workshop/engine.js`.

## Independently verified upstream evidence

The following was confirmed by read-only retrieval of upstream pages and
files. It supports the maintainer-provided descriptions but does not extend
beyond what was actually retrieved.

### rweijnen/bosch-bes3-reader

- License files (verified):
  - `LICENSE` — MIT License, "Copyright (c) 2026 rweijnen".
  - `LICENSE-DATA` — Creative Commons Attribution 4.0 International
    (CC BY 4.0) for "the address registry, generated reference
    documentation, and other researched/reverse-engineered datasets".
- Repository layout (verified from the repository tree): `docs/`, `githooks/`,
  `node/`, `src/`, `tools/`, `web/`, `LICENSE`, `LICENSE-DATA`, `README.md`,
  `index.html`.
- Supporting commit evidence:
  - `14dc3b39ab156ea61ed280013c15a55b29d25d79` — adds
    `tools/build-address-docs.mjs`.
  - `3eadb693078a48c77450d0e6a17108830e1f0d0f` — fixes diagnostic issue
    timestamp decoding (fault-memory RPC area).
- Not independently verified: the exact contents of upstream `src/protocol.js`
  or `src/messageTypes.js` beyond the README's description; this review did
  not diff local files against upstream.

### radiohound/bosch-smart-system-ble

- License (verified): documentation and data (`.md`, `.csv`, `.json`) are
  CC BY 4.0, attributed to "redundo.app"; any source code is MIT.
- Files referenced by upstream README (verified in the listing):
  `data/ble_accessibility.csv`, `data/fields.json`, `docs/FINDINGS.md`,
  `docs/DECODER-CARD.md`, `docs/BLE-ACCESS.md`, `docs/TRANSPORT.md`,
  `docs/ISSUE-LOG.md`, plus `CITATION.cff` and `CREDITS.md`.
- Direct support for the "verify-by-reread" description (verified commit
  text, `ba112f1bb93a8970dbfa68b88679a94783d30276`): "A refusal is silent.
  Applied and refused writes BOTH reply with the C0 success prefix; only the
  payload differs (08 01 = applied, empty = declined). Judge by re-reading,
  never by the acknowledgement." This is the same rationale documented in
  `README.md` ("How Verified Writing Works") and implemented in
  `web/workshop/engine.js`.
- Related commits seen: `c174530c2e8b4f46dacea4df15e719c16cac1f95`
  (subscribe vs. read refusals) and `822324b76950e9852539c74ff3ad6388e54c5b74`
  (issue-log reading pitfalls).

### revlat/bes3-analyzer

- License (verified): `LICENSE` — MIT License, "Copyright (c) 2025 revlat".
- README (verified, written in German) documents CAN-FD analysis: frame
  layout, protobuf varint encoding, and a decoded-signal table (speed,
  current, state of charge, remaining/lifetime energy, odometer, ride mode,
  torque, power, cadence, temperatures, voltage, range, activity statistics,
  ambient light). Repository tree includes `bes3-canfd-logger/`,
  `bes3-decoder/`, `bes3-decoder-kotlin/`, and `bes3-log-plotter/`.
- **Not independently verified:** the maintainer-provided phrase
  "cross-verification of light and service-interval addresses". The retrieved
  README and commit list do not name light or service-interval addresses.
  Treat that specific claim as maintainer-provided until a file-level
  reference is confirmed.

## Licensing

Licenses differ per source and must not be collapsed into a single MIT
statement:

- **This project's code** — MIT (`LICENSE`).
- **rweijnen/bosch-bes3-reader** — MIT for code; CC BY 4.0 for researched
  data (address registry, generated docs, datasets). The local
  `src/address-registry.json` records `_meta.license = "CC-BY-4.0"`, matching
  upstream.
- **radiohound/bosch-smart-system-ble** — CC BY 4.0 for docs/data, MIT for
  code.
- **revlat/bes3-analyzer** — MIT.

`LICENSE-DATA` applies only to the researched datasets described in it.
Bundled component images, third-party libraries, and other assets are not
asserted to be covered by it; see "Restored local `LICENSE-DATA`" above.

### Restored local `LICENSE-DATA` (CC BY 4.0)

- The repository root contains `LICENSE-DATA`, copied verbatim from upstream
  at a pinned commit:
  - Rendered source:
    `https://github.com/rweijnen/bosch-bes3-reader/blob/cd9a5510ae1091c467d8d5a586a23723c17a9249/LICENSE-DATA`
  - Raw retrieval:
    `https://raw.githubusercontent.com/rweijnen/bosch-bes3-reader/cd9a5510ae1091c467d8d5a586a23723c17a9249/LICENSE-DATA`
  - Full upstream commit hash:
    `cd9a5510ae1091c467d8d5a586a23723c17a9249` — the same revision recorded
    for this source above. The copy is pinned to that commit and was not
    taken from a newer `main`.
  - Local modifications: none. The file is reproduced verbatim, including
    upstream's attribution to `rweijnen/bosch-bes3-reader`. No
    local-versus-upstream change history is asserted.
- Locally evidenced scope of the researched data covered by `LICENSE-DATA`:
  - `src/address-registry.json` — its `_meta` block sets
    `"license": "CC-BY-4.0"` and `"sourceUrl":
    "https://github.com/rweijnen/bosch-bes3-reader"`.
  - `docs/address-registry.md` (generated) states:
    "License: **CC-BY-4.0** — attribution required (Bosch BES3 address
    registry — github.com/rweijnen/bosch-bes3-reader). See `LICENSE-DATA`."
  - That is the extent of the locally evidenced coverage. No file-level
    provenance establishes that bundled component images (`web/parts/`),
    `jsPDF`, or any other third-party/vendored asset is covered by
    `LICENSE-DATA`; those remain governed by their own terms (see the
    license list above).
- `LICENSE` (MIT), including its existing upstream attribution credits, is
  unchanged by this restoration.

## Component photographs and trademarks in the public release tree

- Component photographs (`web/parts/*.webp`), the embedded PDF thumbnail
  bundle (`web/workshop/part-images-pdf.js`), and the map source
  (`web/data/part-images.json`, extracted from Bosch's Flow app resources) are
  **not** redistributed in the public release tree (see
  [`public-release.md`](public-release.md) and `tools/public-exclude.txt`).
- When local component photographs are absent, the Workshop renders built-in
  generic SVG icons by default and makes **zero** external network requests.
  If the user explicitly ticks the session-only opt-in control, component
  photographs are loaded on demand from the pinned upstream repository
  [`rweijnen/bosch-bes3-reader`](https://github.com/rweijnen/bosch-bes3-reader)
  at commit `cd9a5510ae1091c467d8d5a586a23723c17a9249` via `cdn.jsdelivr.net`.
- All product names, logos, brands, and trademarks (including Bosch, Smart
  System, Performance Line, Active Line, Cargo Line, Kiox, Purion, Intuvia,
  System Controller, Mini Remote, PowerTube, PowerPack, PowerMore,
  ConnectModule, eBike Lock, and eShift) belong to their respective owners and
  are used solely for identification and interoperability purposes. This
  project is not affiliated with, authorized by, or endorsed by Robert Bosch
  GmbH.

## Retrieval limitations

- Evidence was gathered read-only via repository web pages, raw license
  files, and commit Atom feeds. No repository was cloned and no upstream
  code was run.
- Commit hashes are the head of `main` at review time and identify the
  revision inspected; they are not asserted to be permanent.
- Full upstream source files were not retrieved or diffed, so the
  categorization of "copied/adapted" versus "research reference" follows the
  maintainer-provided descriptions and the visible repository structure.
- `LICENSE-DATA` was retrieved from the pinned commit above and compared
  line-for-line against the local copy; the contents match.
