# Diagnostics / active issues

The DIAGNOSTICS card reads each component's active issue list straight from
the bike (`EXECUTE_INFORMATION_MANAGER_COMMAND_BOSCH` — a real, non-dealer-
gated RPC; Bosch's own eBike Flow app uses this exact same access tier to
read issues). That gives you the raw data for every active issue: a numeric
code, when it last occurred, and how many times.

What it can't give you on its own is the human-readable text for a code —
that text lives in a catalog Bosch ships *inside their own apps*, not on the
bike itself.

## Using your own catalog (optional)

If you'd like codes resolved to real descriptions instead of just numbers,
you can supply your own catalog, extracted from an app you already have
legitimate access to. This project never bundles, ships, or commits that
data — see the `.gitignore` entry for `web/data/issues/` — you provide it
locally, for your own use.

**From eBike Flow** (an APK is just a zip file):

```bash
unzip -p com.bosch.ebike.onebikeapp.apk assets/issues_en_Rider.json \
  > web/data/issues/issues_en_Rider.json
```

Swap `en` for another supported locale if you'd prefer (`de`, `fr`, `nl`,
`es`, `it`, `pt`, `pl`, `cs`, `da`, `sv`, `nb`, `is` are all bundled in the
same APK, each as its own `issues_<lang>_Rider.json`).

**From Bosch DiagnosticTool 3**, if you have a legitimate dealer install —
its jars contain the same kind of catalog, at three richer tiers (`IBD`,
`OEM`, `SP`) that generally cover more codes than Flow's consumer-facing
`Rider` tier:

```bash
cd "<DiagnosticTool 3 install>/lib"
unzip -p eds-issues-json-17.1.jar issues/json/issues_en_IBD.json \
  > "<this repo>/web/data/issues/issues_en_IBD.json"
```

(Substitute `OEM`/`SP` the same way if you'd rather use those tiers, or want
more than one on hand.)

## How the catalog is loaded

There is **no auto-discovery**: the app never scans a directory for catalog
files. The catalog is a single file that the user selects:

1. "Load error catalog" in the fault-memory card opens a file picker.
2. The selected file is parsed and kept in the browser's local storage
   (`localStorage`, key `bes3-workshop-issue-catalog`); it survives a reload.
3. "Remove" clears it again.

The unzip instructions above produce a file you can then select by hand; the
app does not read `web/data/issues/` itself. Only one catalog is active at a
time.

With none present, the DIAGNOSTICS card still works — it just shows each
issue as a raw code (`Issue 0x...`) instead of a description.
