# Mini Remote detection (BRC3300)

This note records how the Mini Remote card is derived, what the upstream reader
actually does, and what the reference bike returned over USB.

**Conclusion up front:** the upstream reader does **not** detect a Mini Remote.
It reads the same `RemoteControl` registers and never infers a paired accessory.
The Workshop keeps the decoder (for saved exports that may one day contain a
record) but no longer claims "None detected": it states that the remote was not
listed over USB and shows the raw register values instead.

## What the upstream reader does

Checked in `github/bosch-bes3-reader-main/bosch-bes3-reader-main/`:

- There is no `decodeBlePeers` function and no `hasMiniRemote` flag.
- `BRC3300` and `Mini Remote` appear only in the part-image catalog and in the
  control-unit help text; neither is used to detect a component.
- `web/app.js` renders a Remote card from `RemoteControl.PRODUCT_NAME` and
  `PRODUCT_CODE`. The sweep reads every readable registry address, including
  `BLE_CENTRAL_DATABASE` (0x2210), `DEVICE_DATABASE` (0x2332),
  `DEVICE_AVAILABILITY` (0x2331) and `AVAILABLE_BUTTONS` (0x2041), but shows
  them as raw table rows only.

There was therefore no upstream detection logic to port.

## What the Workshop does

`web/workshop/engine.js` keeps a `decodeBlePeers()` helper for the two BLE
database registers:

- An empty payload is `no entries`.
- `0a 00` (an empty length-delimited field) is `empty slot (0a 00)`.
- An entry is counted only when a length-delimited field has a non-zero length
  or a varint field has a non-zero value.
- `hasMiniRemote` is true only when the decoded ASCII contains `BRC3300` /
  `Mini Remote`. A non-empty record alone is not a Mini Remote.
- `hasBleRecord` is true when the database contains any non-empty record. The
  UI uses it to say that peers exist without claiming they are a BRC3300.

The UI card (`web/workshop/ui.js`) now shows:

- name: **Not visible over USB** unless the marker is present;
- hint: the bike did not list a Mini Remote over USB, or the BLE database has
  peers but no BRC3300 / Mini Remote marker;
- a collapsible **Raw register values** area with the four registers above.

## The remote probe (Workshop 0.18.0)

The Remote card in the Overview now has a **"Probe remote registers"** button.
It sends **read requests only** — one per register, no retries, nothing is
written, and it needs no approval because it sends no mutation.

**Which registers are probed.** Every *readable* registry entry whose name or
label contains one of these keywords, in any component:

`REMOTE`, `BLE`, `BUTTON`, `MINI`, `PERIPHERAL`, `PAIR`, `BOND`,
`DEVICE_DATABASE`, `DEVICE_AVAILABILITY`, `CONNECTED`, `ESHIFT`

With the current address registry that is **127 registers**. The most relevant
ones for a wireless remote:

| Register | Address | Label |
| --- | --- | --- |
| `RemoteControl.BLE_CENTRAL_DATABASE` | 0x2210 | Ble Central Database |
| `RemoteControl.BLE_CENTRAL_GET_AVAILABLE_DATABASE_SLOTS` | 0x220f | Ble Central Get Available Database Slots |
| `RemoteControl.BLE_CENTRAL_SCANNING_ENABLED` | 0x2203 | Ble Central Scanning Enabled |
| `RemoteControl.BLE_CENTRAL_SCAN_FILTER` | 0x2216 | Ble Central Scan Filter |
| `RemoteControl.BLE_CENTRAL_RSSI_POLLING_ENABLED` | 0x2222 | Ble Central Rssi Polling Enabled |
| `RemoteControl.BLE_CENTRAL_VISUALIZABLE_ISSUE_TYPES` | 0x2226 | Issue severities visualizable on BLE-central peripheral |
| `RemoteControl.BLE_CENTRAL_UPDATE_ISSUE_VISUALIZATION` | 0x2227 | Ble Central Update Issue Visualization |
| `RemoteControl.BLE_DEVICE_ADDRESS` | 0x2206 | Ble Device Address |
| `RemoteControl.BLE_ENABLED` | 0x2202 | Ble Enabled |
| `RemoteControl.BLE_PERIPHERAL_CONNECTION_PARAMETERS` | 0x2207 | Ble Peripheral Connection Parameters |
| `RemoteControl.BLE_PERIPHERAL_GET_AVAILABLE_DATABASE_SLOTS` | 0x2212 | Ble Peripheral Get Available Database Slots |
| `RemoteControl.BLE_PERIPHERAL_PAIRING_ENABLED` | 0x2205 | Ble Peripheral Pairing Enabled |
| `RemoteControl.BLE_PERIPHERAL_RSSI_POLLING_ENABLED` | 0x2215 | Ble Peripheral Rssi Polling Enabled |
| `RemoteControl.BLE_BUTTON_EVENT` | 0x220d | Ble Button Event |
| `RemoteControl.BLE_AVAILABLE_BUTTONS` | 0x220e | Ble Available Buttons |
| `RemoteControl.BLE_HEART_RATE` / `_STATUS` | 0x2228 / 0x2229 | heart rate of a paired BLE strap |
| `RemoteControl.BLE_SHIFTER_READY` | 0x222a | readiness of a paired BLE electronic shifter |
| `RemoteControl.DEVICE_DATABASE` | 0x2332 | Device Database |
| `RemoteControl.DEVICE_AVAILABILITY` | 0x2331 | Device Availability |
| `RemoteControl.AVAILABLE_BUTTONS` / `_DESCRIPTORS` / `PRESSED_BUTTONS` | 0x2041 / 0x2045 / 0x2046 | the buttons of the control unit |
| `RemoteControl.BUTTON_EVENTS_ENABLED` | 0x2044 | Button Events Enabled |
| `RemoteControl.REMOTE_CONTROL_FEATURE_PROPERTIES_RELEASE1..4` | 0x2101 / 0x2108 / 0x2109 / 0x210a | properties of the remote control feature |
| `RemoteControl.REMOTE_CONTROL_STATIC_FEATURE_PROPERTIES` | 0x210b | static remote-control properties |
| `RemoteControl.E_SHIFT_AVAILABLE` / `_CAN_AVAILABLE` / `_BLE_AVAILABLE` | 0x216a / 0x216c / 0x216d | the eShift device |
| `DriveUnit.REMOTE_CONTROL_AVAILABLE` | 0x1021 | Remote control component present |
| `ConnectModule.REMOTE_CONFIGURATION_DATA` / `_SETTINGS` / `FETCH_REMOTE_CONFIGURATION` | 0xb3c / 0xb39 / 0xb38 | the ConnectModule remote configuration |

The keyword rule also catches a few registers that have nothing to do with a
remote (`Battery.MINIMUM_PACK_TEMPERATURE` matches `MINI`, `Battery.CHARGER_CONNECTED`
matches `CONNECTED`). That is deliberate: the rule is a keyword filter, not a
hand-picked list, and a wrong extra read is harmless (it is read-only).

**What the probe shows.** A table with the address, the register name, the raw
hex and the decoded value; a register that the bike declines is marked. The
results also travel with the JSON readout export (`remoteProbe`).

**What it cannot show.** The Mini Remote pairs over Bluetooth. The bike does
not have to list it in the wired registers, so the probe may well stay empty
on a bike where the remote works perfectly — as it does on the reference bike,
where `BLE_CENTRAL_DATABASE` is `0a 00` (an empty slot) and the device
database is empty. The card says exactly that.

## Observed values (reference bike, 2026-10-18)

From `logs/bes3-workshop-1792316972666.json` (exported readout) and
`logs/bes3-debug-log-1792316975393.txt`:

| Register | Address | Raw | Display |
| --- | --- | --- | --- |
| `RemoteControl.BLE_CENTRAL_DATABASE` | 0x2210 (8720) | `0a 00` | `empty slot (0a 00)` |
| `RemoteControl.DEVICE_DATABASE` | 0x2332 (9010) | empty | `no entries` |
| `RemoteControl.DEVICE_AVAILABILITY` | 0x2331 (9009) | empty | `(empty)` |
| `RemoteControl.AVAILABLE_BUTTONS` | 0x2041 (8257) | not read | `declined` |

The task also cites `bes3-debug-log-1792433779726.txt` (2026-10-19). That file
is **not** inside the git tree, but it exists next to the repository
(`bes3-workshop/logs/bes3-debug-log-1792433779726.txt`, outside version
control). It contains the light-power writes of 2026-10-19
(`write-BIKE_LIGHT_POWER -> WRITE 0x1822 seq 6 | 30 07 0e 10 98 22 26 08 78`
and `Set bike light power to 12.0 W: acked=true applied=true | 08 78`); the
values in the table above come from the 2026-10-18 files and are corroborated
by the user's description of the 2026-10-19 run.

## Tests

`tools/check-workshop-light.mjs`:

- source check: the card states the USB limitation, uses a collapsible raw-value
  area, and no longer contains `None detected`;
- engine check: the real `0a 00` value and the empty device database decode with
  `hasMiniRemote: false` and `hasBleRecord: false`, including after
  `importWorkshop()`;
- engine check: a synthetic BLE record containing `BRC3300` is still detected,
  so the decoder remains functional if a future read returns an entry;
- engine check: a non-empty peer record without the marker sets
  `hasBleRecord: true` but keeps `hasMiniRemote: false`.

No write-path behaviour changed. This is read-only presentation and decoding.
