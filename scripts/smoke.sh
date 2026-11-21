#!/usr/bin/env bash
# App smoke test: boot the dev server once from TS source, assert the
# liveness + API + HTML + asset endpoints, then shut down.
#
# No fixtures, no Playwright, no seed, no auth — an empty DB is the
# assertion (`GET /api/v1/projects` -> `[]`). Run from the repo root
# (CI) or anywhere (the script cds to the repo root itself).
#
# Without SMOKE_BASE_URL it also checks the product image refuses to start with a short SECRET.
#
# Env overrides: PORT (default 4311; the refusal check uses PORT+1), DATA_DIR (default .tmp/smoke-<run>), SMOKE_BASE_URL (assert
# an already-running server, e.g. the container image, instead of booting the dev server).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${SMOKE_BASE_URL:-}" ]; then
  BASE="${SMOKE_BASE_URL%/}"
  PORT="${BASE##*:}"
else
  mkdir -p .tmp
  PORT="${PORT:-4311}"
  RUN_ID="${GITHUB_RUN_ID:-local}"
  DATA_DIR="${DATA_DIR:-.tmp/smoke-${RUN_ID}}"
  LOG=".tmp/smoke-${RUN_ID}.log"

  # Auth must stay off: with AUTH_PASSWORD set `/` redirects to login and the
  # HTML assertion false-fails (and without a valid SECRET the server refuses to start).
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
fi

# Poll liveness: the setup gate can 503 the first requests during setup().
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$BASE/api/v1/health" >/dev/null; then
    break
  fi
  sleep 2
done

# Never `grep -q` on the right of a pipe here: it exits at the first match, curl's
# next write then fails (exit 23) and `pipefail` fails the pipeline, at random,
# on any response larger than one write. Plain grep reads it all.
curl -fsS --max-time 10 "$BASE/api/v1/health" >/dev/null
curl -fsS --max-time 10 "$BASE/api/v1/projects" | grep '\[\]' >/dev/null
curl -fsS --max-time 10 "$BASE/" | grep -i 'html' >/dev/null
curl -fsS --max-time 10 "$BASE/assets/htmx.js" | grep 'htmx' >/dev/null

echo "Smoke OK: health + projects + root + htmx.js on :$PORT"

# Must refuse (#1139): the product image with sign-in configured and a SECRET shorter than 32
# characters exits non-zero before it listens, and its first line names SECRET, never the value.
refuse_short_secret() {
  local port=$((PORT + 1)) dir="${DATA_DIR}-refuse" log=".tmp/smoke-${RUN_ID}-refuse.log"
  local short="smoke-short-secret-value" refused code=0 first
  env -u SHELF_AUTH AUTH_PASSWORD="smoke-admin-password" SECRET="$short" PORT="$port" \
    DATA_DIR="$dir" nub ./apps/server-image/server.ts >"$log" 2>&1 &
  refused=$!
  fail() {
    echo "Smoke FAILED (short SECRET): $1"
    kill "$refused" 2>/dev/null || true
    echo "--- image log ($log) ---"
    cat "$log"
    rm -rf "$dir" "$log"
    exit 1
  }
  for _ in $(seq 1 60); do
    kill -0 "$refused" 2>/dev/null || break
    if curl -s --max-time 1 "http://127.0.0.1:$port/api/v1/health" >/dev/null; then
      fail "the image started and listened on :$port"
    fi
    sleep 1
  done
  kill -0 "$refused" 2>/dev/null && fail "the image was still running after 60 s"
  wait "$refused" || code=$?
  [ "$code" -ne 0 ] || fail "the image exited 0"
  # nub's own notices come first; the image's first line follows them.
  first="$(awk '!/^nub: /{ print; exit }' "$log")"
  case "$first" in
    "storyshelf: SECRET "*) ;;
    *) fail "the first line does not name SECRET: $first" ;;
  esac
  # A refusal is one line: a stack frame (`    at fn (file:line)`) would be a leaked crash report.
  if grep -qE '^[[:space:]]+at ' "$log"; then
    fail "the refusal printed a stack trace"
  fi
  if grep -qF "$short" "$log"; then
    fail "the output contains the SECRET value"
  fi
  if curl -s --max-time 2 "http://127.0.0.1:$port/" >/dev/null; then
    fail "something answers on :$port"
  fi
  rm -rf "$dir" "$log"
  echo "Smoke OK: the image refuses a short SECRET (exit $code, first line names SECRET, no stack trace)"
}

if [ -z "${SMOKE_BASE_URL:-}" ]; then
  refuse_short_secret
fi
