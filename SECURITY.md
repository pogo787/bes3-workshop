# Security Policy

## Scope and Safety Architecture

BES3 Workshop runs locally in the browser and communicates with Bosch Smart
System (BES3) eBikes over WebUSB. Because hardware writes can alter bike
configuration, the application enforces layered safety gates documented in
[`docs/workshop-write-safety.md`](docs/workshop-write-safety.md) and
[`docs/write-path-map.md`](docs/write-path-map.md):

- Reading is passive and uses only `READ` and read-only diagnostic RPC frames.
- Writes are disabled by default until the user accepts the session risk warning
  and enables experimental writes for the current session.
- All configuration changes are staged in a visible batch, require explicit
  approval (including typed `Component.NAME` confirmation once per batch for
  `high-impact` and `registry-readonly` tiers), and are verified by an
  independent re-read after transmission.
- All device- and file-derived strings rendered into HTML pass through escaping
  helpers enforced by `tools/check-all.mjs`.

## Reporting a Vulnerability or Safety Issue

If you discover a security vulnerability (such as DOM XSS via a crafted readout
file), a write-gate bypass, or an unsafe protocol behavior:

1. **Do not include real eBike serial numbers, private diagnostic exports, or
   customer data** in public reports. Use synthetic fixtures or anonymised
   exports.
2. Open a security advisory or issue on the repository describing:
   - Affected file(s) and version (`POLICY.VERSION` in
     `web/workshop/write-policy.js`).
   - Minimal reproduction steps using Demo mode or a synthetic JSON fixture.
   - Expected vs. actual behavior and whether any write frame can be emitted
     without approval.
