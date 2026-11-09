---
"@storyshelf/db-postgres": minor
---

Build retention is now active on Postgres through the default `postgres.js` preset (`createPostgresDatabase`). At boot the adapter prepares the baseline pins, then exposes the build-reference lifecycle, so with `testing` enabled the build purge and branch GC run and keep any build a baseline still needs. A baseline whose recorded source build is being deleted or belongs to another project pauses retention and is named on the System page; fix it and restart. Upgrade every server instance that shares the database before relying on it. PGlite, `./neon`, `pg` and `./neon-http` still keep builds (fail closed).
