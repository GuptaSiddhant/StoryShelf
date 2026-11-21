---
"@storyshelf/app": minor
---

Added: @storyshelf/app/node startServer for Node hosts

`startServer({ app, port, handleSignals, shutdownTimeoutMs, beforeListen, signal })` serves an app created with `createShelfApp` on Node. It waits for the app's setup, runs `beforeListen`, opens the port, and on shutdown (a signal with `handleSignals`, `close()`, an abort or a failed start; exactly once) stops accepting, finishes requests in flight with `Connection: close`, and tears the app down through `app.lifecycle.teardown({ graceMs })`, so the #912 job drain hands running jobs back within `shutdownTimeoutMs` (default 30 s). `close()` is idempotent and resolves by the deadline, reporting an incomplete shutdown; the library never calls `process.exit`, and importing it has no side effects. `@hono/node-server` (now `^2.1.11`, past GHSA-rmxm-3fg6-px4f) is a runtime dependency of `@storyshelf/app`. The product image, the Fly demo and the dev server use it: `SHELF_SHUTDOWN_GRACE_SECONDS` now bounds the whole shutdown, and unset it is 30 s instead of an unbounded drain.

Schema: none.
