---
"@storyshelf/db-postgres": patch
---

Fixed: two first migrations on an empty Postgres database no longer collide (#803).

The `postgres.js`, `pg` and `./neon` presets now run migrations under a session-level advisory lock on one dedicated connection, so servers booting together on a fresh database take turns instead of failing with a `pg_type` unique violation. `./neon-http`, Vercel and PGlite have no shared session to lock on and are unchanged. MySQL was not changed.
