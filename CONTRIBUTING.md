# Contributing to BES3 Workshop

Thank you for your interest in contributing to BES3 Workshop. Please read these
guidelines and [`AGENTS.md`](AGENTS.md) before submitting changes.

## Core Principles

1. **English only:** Write all documentation, code comments, UI labels, test
   descriptions, and commit messages in English.
2. **Hardware-free verification by default:** Develop and test using the
   built-in simulated demo and synthetic fixtures. Never commit real Bosch
   serial numbers (`NNNNN-NNNN-NN-XXX-NN-NNNN`), customer references, or
   private diagnostic captures.
3. **Preserve write-safety gates:** Changes to `src/protocol.js`,
   `src/messageTypes.js`, `web/transport-*.js`, `node/*`, write-policy logic,
   tiers, grants, `writeVerified`, writer locks, keepalive behavior, or
   protocol addresses require explicit maintainer approval and regression
   coverage.
4. **Preserve upstream licensing:** Keep MIT code licensing (`LICENSE`) and
   CC BY 4.0 data licensing (`LICENSE-DATA`, [`docs/sources.md`](docs/sources.md))
   distinct.
5. **Zero external runtime requests by default:** Do not add external scripts,
   stylesheets, fonts, or unapproved runtime `fetch`/`Image` URLs.

## Required Checks

Enable the repository pre-commit hook after cloning:

```bash
git config core.hooksPath githooks
```

Before opening a pull request, run all three checks on Node 20 or Node 24:

```bash
node tools/check-all.mjs
node tools/check-workshop-light.mjs
node tools/public-tree.mjs --out /tmp/pub
```

Every behavioral change must update `POLICY.VERSION` in
`web/workshop/write-policy.js` (minor bump for features, patch bump for fixes),
add a matching top entry in [`docs/CHANGELOG.md`](docs/CHANGELOG.md), and keep
the documented suite count in [`docs/workshop-write-safety.md`](docs/workshop-write-safety.md)
in sync with `node tools/check-workshop-light.mjs`.
