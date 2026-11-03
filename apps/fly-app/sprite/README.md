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

**Rotating the secret** is a re-run: put the new value in `SPRITE_BROWSER_SECRET`, run `setup.sh` again (it is idempotent), and set the same value as the Fly secret. The script rewrites the secret file, restarts the service (the proxy reads the secret only at start-up), warms up, takes a new checkpoint and re-checks from outside that the URL refuses strangers. The previous secret stops working at once. **After restoring any checkpoint** (`sprite restore`), run `setup.sh` again with the current secret: a checkpoint holds the secret file as it was when taken, so restoring one from before a rotation brings the superseded secret back until you do. Delete superseded checkpoints with `sprite checkpoint delete`.

## What was measured (live Sprite, 2026-11-03)

| Check                                                                         | Result                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wake from `warm`/`cold` to `/healthz` 200 (5 trials)                          | 0.23-0.50 s, median 0.27 s (target ≤ 3 s)                                                                                                                                                                           |
| Public edge, unauthenticated or wrong-secret HTTP and WebSocket upgrade       | 401; right secret 101; Playwright's own port 3000 unreachable                                                                                                                                                       |
| Real Playwright 1.63 client over the public URL (connect, render, screenshot) | works; the client's loopback Storybook is reachable from the remote browser (`reach: "loopback"`)                                                                                                                   |
| Fixture 9, 16 stories x 3 passes, one session, same harness                   | inside the Sprite: own Chromium 30.4 s (p50 595 ms, p95 612 ms), through proxy and Playwright server 31.7 s (p50 620 ms, p95 654 ms); a 4-CPU sandbox's local Chromium (same build) 28.4 s (p50 542 ms, p95 573 ms) |
| Screenshots, Sprite vs sandbox Chromium                                       | 13 of 16 differ in at most 0.086% of pixels (font/anti-aliasing), 3 identical                                                                                                                                       |
| Checkpoint restore                                                            | filesystem restored; the service is started fresh (not frozen memory); `/healthz` 200 again in 1.5 s                                                                                                                |
| Processes across hibernation                                                  | the service was not restarted across 8 warm/cold cycles                                                                                                                                                             |

Caveats: the Fly VM itself was not measured (no access); remote use pays the network round trip on every protocol call (about 285 ms from the measuring sandbox, so 1.3 s per story there against about 0.6 s in-Sprite); idle billing follows the Sprites documentation ("free when idle", `warm`/`cold` seen within seconds of the last connection closing) and was not checked against an invoice. Open TCP connections keep a Sprite awake, so a connection left open by a crashed run costs until it times out.

## Test

`nubx vitest run sprite/proxy.test.ts` (hermetic). Wake time, render parity and idle cost are measured against a live Sprite and are not covered by tests.
