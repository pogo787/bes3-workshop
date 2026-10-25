# Investigation: writing the bike-light power register (0x1822)

This note records what is actually known about `DriveUnit.BIKE_LIGHT_POWER`
(0x1822) and how the Workshop bounds writing it. It separates observed payloads
from assumptions.

**Conclusion up front:** the power writer is **enabled, bounded and marked
`known-issue` (observed not working)**. The register accepts a write and reads
back the written value, but the actual lamp power/output does not change on
tested bikes. The accepted range is still 1.0–18.0 W in 0.1 W steps, every write
still passes the approval gate and a read-back, and nothing is retried or rolled
back. The lamp effect and behaviour on other bikes/firmware remain unverified.

## Evidence

| When | Source | Observation |
| --- | --- | --- |
| 2026-10-18 | `logs/bes3-workshop-1792316972666.json` | saved readout shows `BIKE_LIGHT_POWER` = 15.0 W, raw `08 96 01` |
| 2026-10-19 | task-provided debug log `bes3-debug-log-1792433779726.txt` | a 12.0 W write (`08 78`) followed by a 15.0 W write (`08 96 01`), each read back successfully |

The 2026-10-19 log exists **next to the repository**, outside the git tree
(`bes3-workshop/logs/bes3-debug-log-1792433779726.txt`); it is not checked in,
because it contains bike-specific data. It contains the two writes that the
table above describes:

```
[ 232997] write-BIKE_LIGHT_POWER -> WRITE 0x1822 seq 6  | 30 07 0e 10 98 22 26 08 78
[  233799] workshop   Set bike light power to 12.0 W: acked=true applied=true  | 08 78
```

The 2026-10-18 debug log and JSON export are the only artifacts inside the
repository working tree. No synthetic log was created to stand in for anything.

What this evidence proves:

- the register accepts a USB write and retains the written value at least until
  the immediate read-back;
- the `/10` decoding (`08 96 01` = 150 tenths = 15.0 W) matches the value that
  was written.

What it does **not** prove:

- that lamp brightness or output behaviour changes;
- that the value persists across a power cycle;
- that the same value is accepted on other bikes, drive units or firmware;
- that values outside the 1.0–18.0 W range are safe.

## Registers and encodings

The address registry stores decimal addresses. `6178` is `0x1822`.

| Datapoint | Component | Address | Registry | Notes |
| --- | --- | --- | --- | --- |
| `BIKE_LIGHT_POWER` | DriveUnit | `0x1822` (6178) | readable, **writable:true, confirmed:false**, kind unknown, no source | the register under investigation |
| `BIKE_LIGHT_CONFIGURATION` | DriveUnit | `0x1821` (6177) | readable, writable:true, kind unknown | local startup-mode write, `untested` |
| `BIKE_LIGHT_CONFIGURATION_OEM` | DriveUnit | `0x181F` (6175) | readable, **writable:false** | a *different* register; do not compare values with 0x1822 |

Source: `src/address-registry.generated.js` (entries at 6175, 6177, 6178).
The registry marks 0x1822 `writable:true` but `confirmed:false` and records no
`source` or `notes` for it.

### Decoding

`web/workshop/engine.js` (`interpret()`) treats `BIKE_LIGHT_POWER` as a protobuf
`field 1` varint whose value is scaled by ten:

```
value_in_watts = field1_varint / 10
```

For example:

| Raw payload | Field 1 varint | Watts | Where |
| --- | --- | --- | --- |
| `08 0a` | 10 | 1.0 W | demo seed, `web/workshop/demo-data.js` (key `6178`) |
| `08 78` | 120 | 12.0 W | written on the reference bike (2026-10-19) |
| `08 96 01` | 150 | 15.0 W | written on the reference bike (2026-10-19); also the value in the 2026-10-18 export |

`08` is the tag for field 1 (varint); the bytes after it are the varint value.

The OEM register is **not** a power value. Its demo seed is `18 01`
(`web/workshop/demo-data.js`, key `6175`): `18` is the tag for field **3**,
value `1`. It shares neither the field nor the meaning of 0x1822 and must not be
read as a wattage.

## What the code does today

- `engine.js` — `Writers.lightPower(watt, owner)` calls
  `POLICY.validateLightPower(watt)` and `POLICY.assertWritable('LIGHT_POWER')`
  **before any transport I/O**, then encodes `round(watt * 10)` as a `field 1`
  varint and verifies it with a read-back. An invalid value throws
  `WRITE_BLOCKED` and produces zero mutation frames
  (`web/workshop/engine.js`, `Writers.lightPower`).
- `write-policy.js` — `LIGHT_POWER` is `writable:true`,
  `evidence:'known-issue'`, with a note stating that the register acknowledges
  the 12.0 W and 15.0 W writes and reads them back but the actual lamp output was
  observed not to change. `validateLightPower` accepts only a finite number in
  1.0–18.0 W with at most one decimal place (`web/workshop/write-policy.js`).
- Workshop UI — the power row offers a bounded range/number input (1–18, step
  0.1) with presets, is disabled until the current value has been read, and the
  hint states that the write is observed not working and keeps the lamp-load
  limit.
- Classic Reader (removed in 0.5.0) — its `web/app.js:1587` documented the
  register as deliberately never written ("wrong power could damage
  lamp/output"), and listed it read-only (`web/app.js:1743`). Those files remain
  in git history; the citations are kept as historical evidence.

## Why the writer stays bounded

1. **Safety.** Wrong power can damage the lamp/output; the (removed) Classic
   Reader treated this as a hard stop. The writer therefore accepts only the
   documented 1.0–18.0 W range in 0.1 W steps.
2. **Scope of the evidence.** Two write/read-back pairs on one bike/firmware
   show that the stored value changes. They do not show that the lamp responds
   or that other hardware behaves the same way, so the operation stays
   experimental and the UI states the limit.
3. **Per-write approval.** Every write is individually approved (in a live
   session) and immediately re-read; nothing is retried and nothing is rolled
   back.

## What would raise confidence further (proposal — not executed)

- **Lamp-side measurement:** on a bench lamp and current-limited supply, measure
  brightness/current at 1.0 W, 6.0 W, 12.0 W and 15.0 W with an independent
  read-back after each write.
- **Persistence:** power-cycle the bike after a write and re-read 0x1822.
- **Cross-hardware:** repeat on a second drive unit/firmware and compare with
  0x181F.
- **Range confirmation:** cross-check the `/10` scaling and the safe range
  against CAN-bus analysis (`revlat/bes3-analyzer`) or the BLE research notes
  (`docs/sources.md`).

None of these steps has been performed in this repository. The label is therefore
`known-issue` (observed not working in practice), despite the register accepting
the write and reading it back.

## Open questions

- Does lamp brightness/output change with the stored value, and when?
- Does the written value persist across a power cycle?
- Does 0x181F constrain or override 0x1822?
- Is the accepted range wider or narrower on other hardware, and does the drive
  unit clamp it?

## References

- `web/workshop/engine.js` — `interpret()` (decode) and `Writers.lightPower`.
- `web/workshop/write-policy.js` — `OP.LIGHT_POWER`, `assertWritable`.
- `web/app.js:1587`, `web/app.js:1743` — Classic Reader read-only stance
  (removed in 0.5.0; retained in git history).
- `src/address-registry.generated.js` — entries 6175, 6177, 6178.
- `web/workshop/demo-data.js` — demo seeds `6175 = "18 01"`, `6178 = "08 0a"`.
- `logs/bes3-workshop-1792316972666.json`, `logs/bes3-debug-log-1792316975393.txt`
  — 2026-10-18 reference-bike readout.
- `docs/workshop-write-safety.md`, `docs/sources.md`.
