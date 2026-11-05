---
"@storyshelf/db-postgres": patch
---

Groundwork for build retention on Postgres: the build-reference lifecycle (fenced reference replacement, deletion claims, content uses and claims) now exists for postgres.js and PGlite, with row locks taken in a fixed order, and passes the shared contract suite on both PGlite and a real server. No preset exposes it yet, so Postgres deployments with `testing` still skip automatic build deletion until a following release switches it on.
