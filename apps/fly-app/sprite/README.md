# Browser Sprite

A Playwright server on a Fly Sprite, behind an authenticating proxy, used by the demo as `chromium@sprite` (`../sprite.ts`).

| File        | Purpose                                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy.mjs` | Reverse proxy on :8080 in front of `playwright run-server` (127.0.0.1:3000). Refuses any HTTP request or WebSocket upgrade without the right `x-storyshelf-secret` (401, before the upstream sees it); `/healthz` (authenticated) is 200 once the server answers. |
| `start.sh`  | The Sprite service command: starts both processes, exits if either dies.                                                                                                                                                                                          |
| `warm.mjs`  | Launches Chromium once and renders a sample, so fonts and caches exist before the checkpoint.                                                                                                                                                                     |
| `setup.sh`  | Idempotent build with the `sprite` CLI: creates the Sprite, installs Node and `playwright-core` (same version as the app), Chromium, the service and a checkpoint.                                                                                                |

The Sprite URL is public by design only because the proxy rejects every request without the secret. Never expose Playwright's own port.

## Build it (owner, once)

```sh
sprite auth setup --token "$FLY_SPRITES_TOKEN"   # never echo the token
export SPRITE_BROWSER_SECRET="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
bash apps/fly-app/sprite/setup.sh                # reads the secret from the environment
fly secrets set FLY_SPRITES_TOKEN="$FLY_SPRITES_TOKEN" SPRITE_BROWSER_SECRET="$SPRITE_BROWSER_SECRET" -a storyshelf
```

Rebuild after a Playwright upgrade: client and server versions must match.

## Test

`nubx vitest run sprite/proxy.test.ts` (hermetic). Wake time, render parity and idle cost are measured against a live Sprite and are not covered by tests.
