# ADR 0020: Content-Addressed Storybook Assets

## Status
Accepted

## Context
Per-build `${projectId}/builds/${buildId}/storybook/**` duplicated ~5 MB of Vite-hashed `assets/**` plus `sb-common-assets/nunito-*.woff2` across every build of the same Storybook version. Builds only differ by stories, not framework assets. Storage and upload cost scaled with `builds × 5 MB` and published Storybooks streamed the same bytes repeatedly. No `sha256` tracking existed, and `app` imported `db-sqlite/schema` directly (`AnySQLiteTable`) with `as never` casts for `contentRefs`, which breaks on Postgres (`AnyPgTable`).

## Decision
1. **New `content_refs` table** (`hash PK, refCount, lastSeenAt, createdAt`) via `db-sqlite`/`db-postgres`/`db-turso` DDL (`CREATE TABLE IF NOT EXISTS`), 7-day grace when `refCount` drops to 0 (`lastSeenAt < cutoff-7d` before `DELETE` and `storage.delete(content/<hash>)`).
2. **`core/capture/statics.ts` `persistStorybookStatics(storage, dir, projectId, buildId, db?: DatabaseAdapter)`** hashes every file (`sha256`), writes once to `content/<hash>` if missing, writes legacy `storybookDir/<rel>` for fallback, upserts `content_refs` via `db.tables.contentRefs` (no `as never`), and writes `manifest.json` (`{ rel: hash }`).
3. **`core/retention/purge.ts` `deleteBuildFiles`** reads `manifest.json`, decrements `content_refs` (`refCount-1` or `0` with grace), deletes the per-build prefix, and GCs `refCount 0 && lastSeenAt < 7d`.
4. **App routers `POST /dedup`, `POST /content` (multipart), `POST /manifest`** (`/api/v1/projects/:slug/builds/:buildId/*`): `dedup` returns `needed` hashes via `storage.exists(content/<hash>)`; `content` writes `content/<hash>` and upserts; `manifest` writes `manifest.json` and enqueues capture.
5. **CLI `src/commands/dedup.ts` `walkFiles`/`hashFiles`/`tryDedupUpload`** (`POST /dedup`, `80%` bytes fallback `neededBytes/totalBytes > 0.8` → `PUT zip`, batch multipart for `needed`, then `POST /manifest`).
6. **Type-safe `DatabaseAdapter.tables: Tables`** (`core/db/tables.ts` with explicit `Table` keys, no `Record<string, Table>`). All three adapters thread `tables: schema` via `DrizzleAdapterOptions`; `fake-database` exposes `schema as Tables`; `app` has **0 direct dep on `db-sqlite`** and never uses `as never` for table handles. Storybook serving prefers `manifest.json` → `content/<hash>` with `readWithManifestFallback`, `staticsReady` checks `manifest.json` first.

## Consequences
- Upload + storage + download deduplicated; `sb-common-assets` shared across builds; `content/*` bounded by unique hashes (~5 MB) + 10 KB `manifest.json` per build; 80% fallback avoids extra round trips when Storybook version bumps.
- `content/*` is immutable (`content/<hash>` with `public, max-age=31536000, immutable` when served via short-link/buildId), `manifest.json` is per-build, legacy fallback keeps old builds readable.
- No `as never` in `app`/`core` for tables; Postgres works because `Tables` is `Table` (both `AnySQLiteTable`/`AnyPgTable` satisfy it) and `app` reads `db.tables` via the adapter, not a dialect import.
- Follow-up: remove legacy per-build copy after migration window; add `turboSnap`-style change detection orthogonal to content hashing.
