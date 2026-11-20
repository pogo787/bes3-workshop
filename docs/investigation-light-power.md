# Investigation: the bike-light power register (0x1822)

This note records what is known about `DriveUnit.BIKE_LIGHT_POWER` (`0x1822`),
why the Workshop writes it as a `Uint8NormFactor10Message`, and why a successful
write does **not** dim a constant-voltage lamp such as a Lupine Piko. It
separates confirmed schema and electrical architecture from observations on a
single bike.

**Conclusion up front:** the power writer is **enabled, bounded and marked
`observed-working`**. The register is a `Uint8NormFactor10Message`: field 1 is a
varint holding `round(watts × 10)`, so the Workshop accepts only 1.0–18.0 W in
0.1 W steps (for example `16.9 W` → `169` → `08 a9 01`). Writes and matching
read-backs were verified for 1.0 W, 1.6 W, 2.4 W, 8.3 W and 16.9 W on one
Performance Line CX / System Controller setup. The value configures the nominal
power budget of the regulated 12 V light port and the StVZO two-hour battery
reserve; it is **not** a PWM dimmer and does not change the brightness of a
constant-voltage DC lamp with its own DC-DC converter. A full bike power cycle
may be needed before a changed overcurrent budget is re-latched.

## Confirmed schema

| Datapoint | Component | Address | Registry | Meaning |
| --- | --- | --- | --- | --- |
| `BIKE_LIGHT_POWER` | DriveUnit | `0x1822` (6178) | readable, writable, `confirmed:true` | `Uint8NormFactor10Message`; 0.1 W steps, 12 V port budget and StVZO reserve |
| `BIKE_LIGHT_CONFIGURATION` | DriveUnit | `0x1821` (6177) | readable, writable | startup mode (`untested`) |
| `BIKE_LIGHT_CONFIGURATION_OEM` | DriveUnit | `0x181F` (6175) | readable, read-only | a different register: field-3 OEM mode, **not** a wattage |

The address registry marks `0x1822` `confirmed:true` and records the
`Uint8NormFactor10Message` schema in its notes. The schema is researched upstream
data (CC BY 4.0); see `docs/sources.md`. The Workshop encoding is the same as the
wire schema, not a local guess:

```
display_value = field1_varint / 10
payload_varint = round(input × 10)
```

| Raw payload | Field 1 varint | Displayed value |
| --- | --- | --- |
| `08 0a` | 10 | 1.0 W (demo seed) |
| `08 78` | 120 | 12.0 W (early reference log) |
| `08 96 01` | 150 | 15.0 W (early reference log) |
| `08 a9 01` | 169 | 16.9 W (verified write + read-back) |

## Electrical behaviour

Bosch BES3 light ports are regulated 12 V DC outputs. On a BDU3741 Performance
Line CX the high-power port can supply up to about 1.5 A / 18 W. The port does
not vary voltage or PWM duty cycle to dim a connected lamp.

`BIKE_LIGHT_POWER` therefore controls two things:

1. **StVZO two-hour reserve.** The Drive Unit reserves
   `BIKE_LIGHT_POWER × 2 h` of battery energy so the light can stay powered for
   two hours after assist cuts off at 0 % state of charge.
2. **Port budget / overcurrent threshold.** The value informs range estimation
   and, depending on firmware, the port's overcurrent budget. This is latched on
   a full bike power cycle (power off, wait about ten seconds, power on), not
   hot-reloaded while riding.

A Lupine Piko with a DC-DC converter draws whatever its own LED mode requests
(for example 5 W, 12 W or 18 W). Setting `0x1822` to `18.0 W` allocates the full
port budget and reserve so the lamp does not trip overcurrent protection at high
beam; it does not select the lamp's brightness. This explains the earlier
"write succeeded but the lamp did not dim" observation: the expectation was
wrong, not the wire protocol.

## Evidence

| Source | Observation |
| --- | --- |
| `logs/bes3-workshop-1792316972666.json` (2026-10-18) | saved readout: `BIKE_LIGHT_POWER` = 15.0 W, raw `08 96 01` |
| task-provided debug log `bes3-debug-log-1792433779726.txt` (2026-10-19) | 12.0 W (`08 78`) and 15.0 W (`08 96 01`) writes read back successfully |
| task-provided debug log `bes3-debug-log-1795196860592.txt` | verified writes and matching read-backs at 1.0 W, 1.6 W, 2.4 W, 8.3 W and 16.9 W with `WRITE_RESPONSE ok=true status=SUCCESS` |

The task-provided debug logs live next to the repository, outside the git tree,
because they contain bike-specific data. No synthetic log was created to stand
in for them. What the evidence proves:

- the register accepts a USB write from the Workshop;
- an immediate read-back returns the same raw bytes that were sent;
- the field-1 varint / 10 scaling is confirmed by the upstream schema and by
  the multi-value write/read-back series;
- the value is a port budget and reserve setting, not a lamp dimmer.

What it does **not** prove:

- identical behaviour on every drive unit or firmware version;
- that every value in 1.0–18.0 W is safe for every lamp;
- that the overcurrent budget is re-latched without a power cycle on all bikes.

## What the code does today

- `engine.js` — `Writers.lightPower(watt, owner)` calls
  `POLICY.validateLightPower(watt)` and `POLICY.assertWritable('LIGHT_POWER')`
  **before any transport I/O**, encodes `round(watt * 10)` as a field-1 varint,
  and verifies it with a fresh read-back. Invalid values throw `WRITE_BLOCKED`
  and produce zero mutation frames.
- `write-policy.js` — `LIGHT_POWER` is `writable:true`,
  `evidence:'observed-working'`, with a note that explains the 12 V port budget,
  the StVZO reserve, the lack of lamp dimming, and the power-cycle requirement.
- Workshop UI — the input is labelled **Light Port Power Budget (W)** and carries
  the concise constant-voltage / StVZO / power-cycle hint. The Dev bench has a
  `live.light.power-cycle` scenario that writes a ±0.5 W offset and restores the
  baseline.
- Classic Reader (removed in 0.5.0) — its `web/app.js:1587` listed the register
  as deliberately never written ("wrong power could damage lamp/output"). That
  was cautious historical context, not a description of the confirmed schema;
  the citations are kept in git history.

## Safety boundaries

1. **Bounded input.** Only finite numbers from 1.0 to 18.0 W in exact 0.1 W
   steps are accepted. The upper bound matches the documented high-power port
   capability; it is not a recommendation to choose 18 W.
2. **Per-write approval.** Every write is individually approved in a live
   session and immediately re-read. Nothing is retried or rolled back.
3. **No lamp claim.** The Workshop never presents the value as measured lamp
   power or as a brightness control. A matching read-back confirms the register,
   not the electrical output.

## Open questions

- Is the accepted range wider or narrower on other hardware, and does the
  drive unit clamp out-of-range values?
- Which firmware versions re-latch the overcurrent budget immediately versus
  only after a full power cycle?
- Does `0x181F` constrain or override `0x1822` on any firmware?

## References

- `web/workshop/engine.js` — `interpret()` (decode) and `Writers.lightPower`.
- `web/workshop/write-policy.js` — `OP.LIGHT_POWER`, `assertWritable`.
- `web/dev/live/live-suite-light.js` — `live.light.power-cycle`.
- `docs/workshop-write-safety.md`, `docs/sources.md`.
- `src/address-registry.generated.js` — entries 6175, 6177, 6178.
- `web/workshop/demo-data.js` — demo seeds `6175 = "18 01"`, `6178 = "08 0a"`.
