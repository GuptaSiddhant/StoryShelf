---
"@storyshelf/db-mysql": minor
---

Added: build purge and branch GC with testing on MySQL 8 (fenced retention lifecycle, ADR 0039)

`createMysqlDatabase` on a connection pool now implements `buildReferenceLifecycle`: fenced baseline references, irreversible deletion claims with resumable cleanup, and exactly-once shared-content accounting, each operation on its own pooled connection at READ COMMITTED. At boot it checks the server (MySQL 8, lifecycle tables on InnoDB, binary log not `STATEMENT`), pins every baseline's proven source build, then turns retention on; a baseline whose source is tombstoned or in another project pauses it instead (shown on the System page). The PlanetScale and TiDB presets, an injected single `Connection`, MariaDB, TiDB, Vitess and other MySQL versions stay fail closed and log why once at boot. Upgrade every instance that shares the database before relying on purge: an older instance writes baselines without the fence.

Schema: expand only (ADR 0053). Adds `builds.retention_state VARCHAR(16) NOT NULL DEFAULT 'available'` and the tables `build_references`, `build_reference_generations`, `build_deletions` and `build_content_releases` with their foreign keys and the `build_references_build_idx` index. Nothing is dropped, renamed or narrowed; SQLite and Postgres already have the same tables, and the core row types are unchanged.
