# Investigation: ride statistics for deactivated assist modes

**Status:** the protocol does not expose what the request needs. This document
records exactly what was checked, what the data shows, and what is missing.

**Request (user feedback 1.2):** the ride statistics table only shows the
*active* assist modes. The user wants the deactivated modes too, as ground
truth.

**Result:** the deactivated modes can be *listed* (their name and colour slot
exist on the bike), but their statistics **cannot be read**, because every
statistics call is keyed by a configuration id that the bike only reports for
*active* modes. No id is guessed.

## What the bike reports

From the user's own export (`logs/bes3-workshop-1792433778052.json`, 2026-10-19):

| Register | Address | Value |
| --- | --- | --- |
| `DriveUnit.ACTIVE_ASSIST_MODES` | 0x184E | `["A100M00040", "A100MAAAA0", "A100MSPIC7", ""]` — three real ids, the fourth slot is an **empty** id |
| `DriveUnit.ASSIST_MODE_SHORT_NAMES` | 0x180C | `["OFF", "ECO", "TOUR+", "eMTB+", ""]` — five name slots, the fifth is empty |
| `DriveUnit.ASSIST_MODE_COLORS` | 0x180D | five colours (`ArrayOf5Uint32`), the fifth `#e20015` is unmapped |

The configuration ids are opaque strings (`A100M00040`), not slot indices. The
only positional guess in the upstream project (`"1".."4"`) was disproved by a
real hardware test and is not used here either.

## The mechanism that exists (read-only)

1. Plain read of `ACTIVE_ASSIST_MODES` (0x184E) → the list of **active**
   configuration ids.
2. The synthetic id `"0"` (off/walk) is prepended; it is hardcoded from Bosch's
   own decompile.
3. Per id: RPC `GET_ASSIST_MODE_STATISTICS` (0x108C) for distance and energy,
   and RPC `READ_UDAM_VALUES` (0x1090) for the assistance parameters.

The Workshop does exactly this (`web/workshop/engine.js`, `readAssistModes()`).
The captured log of 2026-10-19 shows four `0x108C` calls and three `0x1090`
calls, always with `0`, `A100M00040`, `A100MAAAA0`, `A100MSPIC7`.

## What was checked for a way to enumerate the deactivated modes

| Candidate | Address | Readable | Carries config ids? | Read by any project? |
| --- | --- | --- | --- | --- |
| `ACTIVE_ASSIST_MODES` | 0x184E | yes | only the **active** ids (type `ArrayOf4ActiveAssistModeIdentifier`) | yes |
| `ASSIST_MODE_SHORT_NAMES` / `_LONG_NAMES` | 0x180C / 0x180D | yes | names only | yes (labels) |
| `ASSIST_MODE_COLORS` | 0x180E | yes | colours only | yes (labels) |
| `ASSIST_MODE_LIMITS` / `_V2` | 0x188B / 0x18A4 | yes | no (limits) | never read, no decoder, no capture |
| `RemoteControl.ASSIST_MODE_USAGE_TOTAL` / `_WITH_MOTOR_SUPPORT_ACTIVE` | 0x2252 / 0x2253 | yes | no (usage duration) | never read, no decoder, no capture |
| `AVAILABLE_ASSIST_MODES_UPPER/LOWER`, `REQUIRED_ASSIST_MODES_UPPER/LOWER`, `ADDING_ASSIST_MODES_LOCKED` | 0x180F, 0x1868, 0x183E, 0x1869, 0x183F | yes | no | never read, no decoder, no capture |
| `GET_ASSIST_MODE_INFORMATION` | 0x108B | RPC | id **is** the key — it cannot bootstrap an id | yes (for known ids) |
| `RESET_ACTIVE_ASSIST_MODES_TO_DEFAULT` | 0x109D | RPC | a **write**, and it would reset the configuration | not used (read-only project) |

There is no "list modes" RPC: the complete drive-unit RPC block 0x1081–0x10A5
was enumerated from the address registry, and it contains no such call. The
Bosch public BLE Live Data interface (`docs/ebike_live_data.proto` upstream)
contains no assist-mode fields at all.

## What is missing

A configuration id for a deactivated mode. The bike reports an **empty** id in
the unused slot of `ACTIVE_ASSIST_MODES` and an **empty** name in the unused
slot of `ASSIST_MODE_SHORT_NAMES`, so there is nothing to call the statistics
RPC with. The id space is opaque (`A100` + `M` + five characters) with no known
generator, and the upstream project proved the positional guess wrong on real
hardware. Whether the extra colour slot (`#e20015`) belongs to a deactivated
mode or is simply the palette cannot be decided from the data either.

Calling `0x108C` with an unknown id has **unknown** behaviour: no capture
anywhere calls it with a non-active id, and no code path can.

## What the Workshop does now

* Every mode the bike reports an id for is read as before.
* A mode slot with a name but no id is listed in the ride statistics card under
  "Deactivated modes", marked as such, with the note that its statistics
  cannot be read because the bike reports no id for it.
* No id is invented, and no extra read request is sent for such a slot.

## What would be needed

A capture of one of the never-read registers (`ASSIST_MODE_LIMITS`,
`RemoteControl.ASSIST_MODE_USAGE_TOTAL`) on a bike that has a deactivated mode,
or a dealer/Flow session that reports the mode list. Until then the honest
answer stays: the modes are visible, their numbers are not.
