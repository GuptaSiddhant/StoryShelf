# ADR 0003: Storage and Content-Addressed Assets

## Status

Accepted

Supersedes (archived): ADR 0006, ADR 0020

## Context

StoryShelf stores screenshots, baselines, diff overlays and published Storybook files. A self-hosted
tool should not need a cloud account, but cloud deployments need object storage. Separately, a
Storybook build is mostly framework assets (hashed Vite bundles, fonts) that are identical across
builds of the same Storybook version; storing and uploading them per build multiplies storage and
transfer by the number of builds. Screenshots repeat in the same way: most stories are unchanged
from one build to the next.

## Decision

### 1. One storage interface, several backends

```typescript
interface StorageAdapter {
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  writeStream(path: string, stream: Readable): Promise<void>;
  readStream(path: string): Promise<Readable>;
}
```

The interface has no containers and no MIME types. Backends:

- `@storyshelf/storage-local` (default): a `--data-dir` on the filesystem; one `docker run` to
  self-host. Writes go through a temporary file and a rename, so a write cut short never leaves a
  torn file at a content address, and keys are listed `/`-separated on every host.
- `@storyshelf/storage-s3`: AWS S3, Cloudflare R2, MinIO and DigitalOcean Spaces, with an optional
  key prefix and endpoint.
- `@storyshelf/storage-azure` (Azure Blob) and `@storyshelf/storage-gcs` (Google Cloud Storage).

Adapter packages follow the layout in the `adapter-layout` skill. Switching backends changes one
adapter. Backup is a copy of the data directory (plus the SQLite file) or bucket versioning. Retention
deletes files and database rows together (ADR 0009); default-branch baselines are never purged.

### 2. Published Storybook files are content-addressed

- Every file of an uploaded Storybook is hashed (`sha256`) and stored once at `content/<hash>`.
  Each build has a `manifest.json` mapping relative path to hash. Serving a published Storybook
  resolves paths through the manifest, and readiness is "the manifest exists". Builds created before
  content addressing keep working through their per-build files.
- A `content_refs` table (`hash` primary key, `refCount`, `lastSeenAt`, `createdAt`) counts
  references. Deleting a build decrements the counts of its manifest. A hash whose count is 0 is
  deleted from storage and the table only after a 7-day grace period (`lastSeenAt` older than the
  cutoff).
- `content/<hash>` objects are immutable and are served with
  `Cache-Control: public, max-age=31536000, immutable`; `manifest.json` is per build.

### 3. File-by-file upload route

Under `/api/v1/projects/:slug/builds/:buildId/`:

- `POST /dedup` takes a list of hashes and returns the ones for which `content/<hash>` does not exist.
- `POST /content` (multipart) writes the needed files and upserts `content_refs`.
- `POST /manifest` stores `manifest.json` and completes the upload (what happens next depends on
  `testing`; see ADR 0006).

The CLI walks and hashes the build directory, asks `/dedup`, and uploads only what is needed. When
the needed bytes exceed 80% of the total (`neededBytes / totalBytes > 0.8`, as after a Storybook
version bump) it falls back to a single zip upload, avoiding extra round trips. This route stores
content-addressed files and needs no extraction and no scratch disk, so it works on serverless hosts.

### 4. Zip uploads and scratch space

A zip upload is extracted into a scratch directory and persisted through the same content-addressed
path. `config.scratchDir` is an optional field of `config` and defaults to
`path.join(os.tmpdir(), "storyshelf")`; there is no "scratchDir is not set" error. A build's scratch
directory is removed in a `finally` after capture and after inline extraction, and a boot sweep
removes directories orphaned by a crash. This matters because `/tmp` is memory-backed on some hosts
and small on constrained platforms. How large zips are published is decided in ADR 0006.

### 5. Screenshot blobs are content-addressed per project

Screenshots, baselines and overlays are stored at `<project>/content/<sha256>.png`:

- Per project, not global, so project deletion and isolation stay simple.
- Shared by snapshots and baselines: approving a snapshot repoints the baseline instead of copying.
- An upload is skipped when the bytes already exist. Identical paths mean identical bytes, so the
  diff step is skipped without reading either image.
- Unlike statics, screenshots are reclaimed by mark-and-sweep in the retention purge rather than by
  counters: an object no snapshot or baseline references is deleted once it has stayed
  unreferenced across two sweeps at least 24 hours apart. First-seen times are kept in
  `<project>/content/.sweep.json` (no schema change and no storage `stat`), and each candidate is
  re-checked against the database immediately before deletion.
- Reusing an existing object writes nothing, so the sweep cannot see that reuse. A capture may hold a
  reuse for minutes or hours before its snapshot rows land. The sweep therefore defers every deletion
  in a project while reuse may be in flight: a build of the project is `pending`, `capturing` or
  `comparing` and was updated within the grace period (a stuck build delays reclaiming storage but
  never blocks it for good), or a reuse claim (`<project>/content/.claims/<ulid>.json`, written by
  baseline import and by approving a legacy per-build snapshot around the store-then-write-rows step)
  younger than the grace period exists.
- Older per-build and per-baseline files keep working and are cleaned up as before.

## Consequences

**Positive**

- Local storage needs no infrastructure; S3, Azure and GCS cover cloud deployments through the same
  interface.
- Framework assets are stored and transferred once per unique hash, so storage grows with unique
  content rather than with `builds x 5 MB`; unchanged screenshots cost no storage and no diff.
- Publishing through the file-by-file route works on hosts with no scratch disk.
- Code outside the database packages reads `db.tables`, so Postgres works without a dialect import.

**Negative**

- Several implementations to maintain, mitigated by a small interface.
- Object-store listing is eventually consistent on some providers.
- Reference counting for statics and mark-and-sweep for screenshots are two reclamation mechanisms,
  and the sweep's deferral rules add complexity.
- A sweep may keep an unreferenced object for at least two sweeps (24 hours or more).

## Alternatives rejected

| Alternative                                     | Why rejected                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Local filesystem only                           | Prevents cloud deployments                                                                                                |
| Cloud storage required, one bucket per project  | An unnecessary barrier for a self-hosted tool                                                                             |
| Per-object claims on every dedupe hit           | Would write on exactly the path whose point is to write nothing                                                           |
| Reference counters for screenshots              | Every delete path (builds, baselines, imports, project delete) would have to stay balanced, and a miss frees a live image |
| Global (cross-project) screenshot content store | Complicates project deletion and isolation                                                                                |
