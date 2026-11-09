---
"@storyshelf/db-postgres": patch
---

Added: build retention on the pg and ./neon presets (#375).

Build retention is now active on the `pg` and `./neon` (WebSocket) Postgres presets when they run on a connection pool, like the `postgres.js` preset: with `testing` enabled the build purge and branch GC run. A single `Client` or `PoolClient` you inject shares one session, so it keeps builds (fail closed), as do `./neon-http` and PGlite.
