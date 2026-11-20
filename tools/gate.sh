#!/usr/bin/env bash
# BES3 Workshop — single local verification gate.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo '==> git diff --check'
git diff --check

echo '==> node tools/check-workshop-light.mjs'
node tools/check-workshop-light.mjs

echo '==> node tools/check-all.mjs'
node tools/check-all.mjs

echo '==> node tools/public-tree.mjs --out /tmp/bes3-public-check'
find /tmp/bes3-public-check -depth -delete 2>/dev/null || true
node tools/public-tree.mjs --out /tmp/bes3-public-check

echo 'ALL GATES PASSED'
