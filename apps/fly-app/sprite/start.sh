#!/usr/bin/env bash
# The Sprite's service: a Playwright server on loopback, and the authenticating proxy that is the
# only thing the Sprite's URL reaches (see proxy.mjs). Registered by setup.sh as a service, so
# the Sprite starts it again whenever it wakes (memory and processes do not survive hibernation).
# Either process dying ends the service, which the Sprite then restarts as a whole.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="${NODE_HOME:-/opt/node}/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HERE/browsers}"
export SPRITE_BROWSER_SECRET_FILE="${SPRITE_BROWSER_SECRET_FILE:-$HERE/secret}"
PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-3000}"
export PLAYWRIGHT_PORT

# `--host 127.0.0.1`: the Playwright server has no authentication of its own, so it must never
# listen on anything the Sprite's URL can reach.
node "$HERE/node_modules/playwright-core/cli.js" run-server \
  --port "$PLAYWRIGHT_PORT" --host 127.0.0.1 &
playwright=$!
node "$HERE/proxy.mjs" &
proxy=$!
trap 'kill "$playwright" "$proxy" 2>/dev/null || true' EXIT
wait -n "$playwright" "$proxy"
exit 1
