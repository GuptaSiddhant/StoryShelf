# @storyshelf/app

The StoryShelf HTTP app: `createShelfApp()` composes database, storage, capture, auth, and notifier (chat, email, git) adapters (all from `@storyshelf/core`) into a complete Hono application — JSON API under `/api/v1` plus server-rendered HTML pages (hono/jsx + HTMX, no client framework).

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";
import { startServer } from "@storyshelf/app/node";

const app = createShelfApp({ database, storage, testing: { runner: captureRunner } });
// Leave `testing` out to host Storybooks only: createShelfApp({ database, storage })
const server = await startServer({ app, port: 3000, handleSignals: true });
await server.closed; // SIGTERM or SIGINT shut it down, within the timeout
process.exit(0);
```

Adapter `init` hooks kick off in the background when the app is created. `startServer` awaits them
(`app.lifecycle.setup()`, so a failed boot check stops the server before it listens) and tears the
app down on shutdown. Hosts that call `app.fetch` themselves (Bun, Workers, Lambda, Next) skip
`@storyshelf/app/node` and call `app.lifecycle.setup()` / `teardown()` directly.

## Node host

`@storyshelf/app/node` serves an app you created on Node, with `@hono/node-server`. It is a
subpath, so the root import never loads it, and importing it registers nothing: no listener and no
signal handler exists until `startServer` runs.

```ts
const server = await startServer({
  app, // from createShelfApp(...): the host never creates one or picks adapters
  port: 3000, // 0 picks a free port; read it back from server.port
  hostname: "0.0.0.0", // optional
  handleSignals: true, // default false: SIGINT/SIGTERM call close()
  shutdownTimeoutMs: 25_000, // default 30 000
  beforeListen: async () => {
    // boot hooks: run once the app is ready, before the port opens
  },
  signal, // optional AbortSignal: aborting it shuts down, even mid start-up
});
const result = await server.close(); // idempotent: { complete, incomplete?, trigger, durationMs }
```

- **Start-up.** The app's setup, then `beforeListen`, then the port. A failure (a boot check,
  `EADDRINUSE`, a throwing hook) tears the app down once and rejects with that error, its message
  redacted of secrets. A signal or an abort during start-up rejects with `StartInterruptedError`.
- **Shutdown**, at most once whatever starts it (a signal, `close()`, an abort, a failed start):
  the listener stops accepting, idle keep-alive sockets close at once and requests in flight
  finish with `Connection: close` (for at most half the timeout, then their sockets are
  destroyed); then `app.lifecycle.teardown({ graceMs })` gets what is left, less a reserve for
  closing adapters, as the bound of the job drain (#912): jobs still running near it are handed
  back to the queue without spending an attempt. `close()` and `server.closed` resolve by the
  deadline, with `complete: false` and `incomplete: "timeout"` (or `"teardown-failed"`) when work
  was cut short, which is also logged.
- **Timeout.** Set `shutdownTimeoutMs` a few seconds below the platform's SIGTERM-to-SIGKILL window
  (Fly's `kill_timeout`, 5 s by default; ECS `stopTimeout` and Kubernetes
  `terminationGracePeriodSeconds`, 30 s by default). A job whose handler ignores its release keeps
  running until the process ends, and is recovered once its lease (`testing.leaseSeconds`) runs
  out: the timeout bounds the shutdown, the lease bounds the recovery.
- **Exit.** The library never calls `process.exit`. With `handleSignals` it removes only the
  handlers it added; the executable decides when the process ends, usually right after
  `await server.closed`.

## Logging

Three tiers, pick the shallowest that fits:

1. **Defaults** — omit `logger` and import nothing. The app creates its own instance; `SHELF_LOG_LEVEL` env sets the level (`debug`, `info`, …; default `"info"`).
2. **Configured app** — `createShelfLogger` (re-exported from `@storyshelf/app`, canonical home `@storyshelf/core/logger`), pass it in, and read it back via `app.lifecycle.logger` for your own logs:

   ```ts
   import { createShelfLogger, createShelfApp } from "@storyshelf/app";

   const app = createShelfApp({ database, storage, logger: createShelfLogger() });
   await app.lifecycle.setup();
   const logger = app.lifecycle.logger;
   ```

3. **A process that only consumes jobs or runs forked capture** — import `createShelfLogger` from `@storyshelf/core/logger` directly, never the router barrel (it must not pull Hono).

## Health

Two-tier, neither gated by adapter init: `GET /api/v1/health` is open liveness for orchestrators; `POST /api/v1/health` is site-admin deep readiness with per-adapter states.

Choose the default adapters in [deployment](../../guides/deployment/) or see the [CLI guide](../../guides/cli/) for the packaged server entry point.

## How it fits in

`app` owns everything HTTP: `routers/`, `pages/`, `ui/`, `middleware/`, the request `store`, and vendored assets. All domain logic — adapter interfaces, models, schema, capture pipeline, retention, diff — lives in `@storyshelf/core` and is imported here through its granular subpaths (never the core barrel, which is now domain-only). The capture consumer and the forked capture child live in core too, so they pull zero HTTP modules.
