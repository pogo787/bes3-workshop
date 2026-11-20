#!/usr/bin/env bash
# BES3 Workshop — verified GitLab push with private review export.
#
# Run from anywhere; the repo root is resolved from this script. This is a
# host-side helper for the local GitLab origin. It never touches GitHub.
#
#   tools/gitlab-push.sh            # verify -> export -> push origin main
#   tools/gitlab-push.sh --no-push  # verify -> export only (local testing)
#
# The review Markdown is generated outside the repository and is never staged
# or committed. Its name is always bes3-workshop-{version}-{date}.md, e.g.
# bes3-workshop-0.59.0-2026-11-20.md. It contains docs/internal/ and is PRIVATE.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# The host runs this as root against a repo owned by uid 99. Scope the
# safe.directory override to this script's Git subprocesses only.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0='*'

NO_PUSH=0
if [[ "${1:-}" == "--no-push" ]]; then
  NO_PUSH=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: tools/gitlab-push.sh [--no-push]" >&2
  exit 2
fi

LOG="$(mktemp)"
cleanup() {
  rm -f "$LOG"
  # A root Git command on the host machine can leave files owned by root.
  # Harmless (and ignored) when run as the container's uid 99 user.
  chown -R 99:100 "$REPO" 2>/dev/null || true
}
trap cleanup EXIT

echo '==> Repository quality gate'
if ! node tools/check-all.mjs > "$LOG" 2>&1; then
  cat "$LOG"
  echo '-> Quality gate failed; nothing was exported or pushed.' >&2
  exit 1
fi
tail -n 4 "$LOG"

echo '==> Workshop light suite'
if ! node tools/check-workshop-light.mjs > "$LOG" 2>&1; then
  grep -v '^  ok ' "$LOG" || cat "$LOG"
  echo '-> Light suite failed; nothing was exported or pushed.' >&2
  exit 1
fi
grep -v '^  ok ' "$LOG" | tail -n 3

echo '==> Verifying a clean worktree'
if [[ -n "$(git status --porcelain)" ]]; then
  echo '-> Commit or stash all changes before pushing.' >&2
  git status --short >&2
  exit 1
fi

echo '==> Generating private review export'
node tools/export-for-review.mjs

if [[ "$NO_PUSH" == 1 ]]; then
  echo '==> --no-push: verification and export complete; no push performed'
  exit 0
fi

echo '==> Pushing to local GitLab origin'
git push origin main
