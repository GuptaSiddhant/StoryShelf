#!/usr/bin/env bash
# Build (or rebuild) the browser Sprite and its `ready` checkpoint. Idempotent: running it again
# reuses the Sprite, re-installs what is missing, refreshes the service and takes a new checkpoint.
#
# Needs the `sprite` CLI, already authenticated (`sprite auth setup --token "$FLY_SPRITES_TOKEN"`),
# and the shared secret the proxy checks, from the environment (never as an argument):
#
#   SPRITE_BROWSER_SECRET=...  apps/fly-app/sprite/setup.sh
#
# The secret is sent to the Sprite over stdin and kept in a 0600 file there; nothing here prints it.
set -euo pipefail
set +x # the token and the secret must never reach a trace
: "${SPRITE_BROWSER_SECRET:?set SPRITE_BROWSER_SECRET (at least 16 characters)}"
[ "${#SPRITE_BROWSER_SECRET}" -ge 16 ] || { echo "SPRITE_BROWSER_SECRET must be at least 16 characters" >&2; exit 1; }

NAME="${SPRITE_NAME:-storyshelf-browser}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DIR=/opt/storyshelf-browser
NODE_DIR=/opt/node
# The client (the demo's runner) and this server must be the same Playwright: read it from the lockfile.
PLAYWRIGHT_VERSION="$(sed -n 's/^  playwright-core@\([0-9][0-9.]*\):.*/\1/p' "$ROOT/nub.lock" | head -1)"
[ -n "$PLAYWRIGHT_VERSION" ] || { echo "no playwright-core version in nub.lock" >&2; exit 1; }

on() { sprite exec -s "$NAME" "$@"; }

echo "1/7 sprite $NAME"
if sprite list --prefix "$NAME" 2>/dev/null | grep -qx "$NAME"; then
  echo "    exists, reusing it"
else
  sprite create --skip-console "$NAME"
fi
# The URL stays private (org members only, the default) while the Sprite is built; step 7 makes
# it public only once the authenticating proxy is installed, healthy, and seen to refuse strangers.
sprite url update -s "$NAME" --auth sprite

echo "2/7 node 24 in $NODE_DIR"
on -- sudo bash -c "
  set -euo pipefail
  if [ -x $NODE_DIR/bin/node ] && $NODE_DIR/bin/node --version | grep -q '^v24\\.'; then exit 0; fi
  cd /tmp
  curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
  FILE=\$(grep -o 'node-v24[0-9.]*-linux-x64\\.tar\\.xz' SHASUMS256.txt | head -1)
  curl -fsSLO https://nodejs.org/dist/latest-v24.x/\$FILE
  grep \" \$FILE\\\$\" SHASUMS256.txt | sha256sum -c -
  rm -rf $NODE_DIR && mkdir -p $NODE_DIR && tar -xJf \$FILE -C $NODE_DIR --strip-components=1
  rm -f \$FILE SHASUMS256.txt
"

echo "3/7 playwright-core@$PLAYWRIGHT_VERSION and its Chromium (with system dependencies)"
on -- sudo bash -c "mkdir -p $DIR && chown -R \$(id -u sprite):\$(id -g sprite) $DIR"
sprite exec -s "$NAME" \
  --file "$HERE/proxy.mjs:$DIR/proxy.mjs" --file "$HERE/start.sh:$DIR/start.sh" \
  --file "$HERE/warm.mjs:$DIR/warm.mjs" -- chmod +x "$DIR/start.sh"
on --dir "$DIR" -- bash -c "
  set -euo pipefail
  export PATH=$NODE_DIR/bin:\$PATH PLAYWRIGHT_BROWSERS_PATH=$DIR/browsers
  [ -f package.json ] || npm init -y >/dev/null
  npm install --save-exact playwright-core@$PLAYWRIGHT_VERSION
  sudo env PATH=\$PATH PLAYWRIGHT_BROWSERS_PATH=\$PLAYWRIGHT_BROWSERS_PATH \
    node node_modules/playwright-core/cli.js install --with-deps chromium
"

echo "4/7 shared secret (0600, from stdin) and the service"
printf '%s' "$SPRITE_BROWSER_SECRET" | on -- bash -c "umask 077 && cat > $DIR/secret"
# The service the Sprite starts on every wake. `http_port` routes the Sprite's URL to the proxy.
on -- sprite-env services create storyshelf-browser --cmd "$DIR/start.sh" --http-port 8080 || \
  on -- sprite-env services restart storyshelf-browser

echo "5/7 warm up: wait for the proxy, then open and close one browser"
HEALTHY=0
for _ in $(seq 1 30); do
  if on -- bash -c "curl -fsS -o /dev/null -H \"x-storyshelf-secret: \$(cat $DIR/secret)\" http://127.0.0.1:8080/healthz"; then
    HEALTHY=1
    break
  fi
  sleep 1
done
# Never checkpoint a service that does not answer: warm.mjs launches Chromium on its own and would pass.
[ "$HEALTHY" = 1 ] || { echo "the proxy did not become healthy; no checkpoint taken" >&2; exit 1; }
on --dir "$DIR" -- bash -c "export PATH=$NODE_DIR/bin:\$PATH PLAYWRIGHT_BROWSERS_PATH=$DIR/browsers; node warm.mjs"

echo "6/7 checkpoint"
sprite checkpoint create -s "$NAME" --comment "ready: playwright-core $PLAYWRIGHT_VERSION, chromium, service storyshelf-browser"
sprite checkpoint list -s "$NAME"

echo "7/7 publish: make the URL public, then check from outside that strangers are refused"
# A Playwright client cannot log in with a Fly account and the Playwright server itself has no
# authentication: the proxy (proxy.mjs) and its shared secret are the only boundary. Publishing is
# therefore the last step, and is undone if the proxy is not seen refusing an unauthenticated request.
sprite url update -s "$NAME" --auth public
URL="$(sprite url -s "$NAME" | grep -Eo 'https://[^[:space:]]+' | head -1 || true)"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 90 "${URL%/}/healthz" || true)"
if [ -z "$URL" ] || [ "$CODE" != 401 ]; then
  sprite url update -s "$NAME" --auth sprite
  echo "the public URL did not refuse an unauthenticated request (got '${CODE:-none}'); reverted to private" >&2
  exit 1
fi
echo "    $URL refuses requests without the secret (401)"
echo "done. Verify the endpoint refuses a connection without the secret (README) before relying on it."
