#!/usr/bin/env bash
# App smoke test: boot the dev server once from TS source, assert the
# liveness + API + HTML + asset endpoints, then shut down.
#
# No fixtures, no Playwright, no seed, no auth — an empty DB is the
# assertion (`GET /api/v1/projects` -> `[]`). Run from the repo root
# (CI) or anywhere (the script cds to the repo root itself).
#
# Env overrides: PORT (default 4311), DATA_DIR (default .tmp/smoke-<run>).
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p .tmp
PORT="${PORT:-4311}"
RUN_ID="${GITHUB_RUN_ID:-local}"
DATA_DIR="${DATA_DIR:-.tmp/smoke-${RUN_ID}}"
LOG=".tmp/smoke-${RUN_ID}.log"

# Auth must stay off: with AUTH_PASSWORD set but SECRET unset (or vice
# versa) `/` redirects to login and the HTML assertion false-fails.
unset SECRET AUTH_PASSWORD AUTH_VIEWER_PASSWORD STORYSHELF_ADMIN_TOKEN ADMIN_TOKEN PUBLIC_BASE_URL

export PORT DATA_DIR
export PATH="$HOME/.nub/bin:$PATH"

nub ./apps/dev-server/src/server.ts >"$LOG" 2>&1 &
pid=$!
cleanup() {
  code=$?
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [ "$code" -ne 0 ]; then
    echo "--- server log ($LOG) ---"
    cat "$LOG"
  fi
  rm -rf "$DATA_DIR" "$LOG"
  exit "$code"
}
trap cleanup EXIT

BASE="http://127.0.0.1:$PORT"

# Poll liveness: the setup gate can 503 the first requests during setup().
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$BASE/api/v1/health" >/dev/null; then
    break
  fi
  sleep 2
done

curl -fsS --max-time 10 "$BASE/api/v1/health" >/dev/null
curl -fsS --max-time 10 "$BASE/api/v1/projects" | grep -q '\[\]'
curl -fsS --max-time 10 "$BASE/" | grep -qi 'html'
curl -fsS --max-time 10 "$BASE/assets/htmx.js" | grep -q 'htmx'

echo "Smoke OK: health + projects + root + htmx.js on :$PORT"
