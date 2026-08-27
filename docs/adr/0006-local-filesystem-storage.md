# ADR 0006: Storage Adapter (Local + S3-Compatible)

## Status

Accepted

## Context

StoryShelf stores screenshots, baselines, diff overlays, and Storybook build files. The predecessor (StoryBooker) used cloud storage (S3, GCS, Azure Blob) with one bucket per project. For a self-hosted tool, requiring cloud accounts is an unnecessary barrier — but limiting to local filesystem only prevents cloud deployments.

PocketBase's model is instructive: local filesystem by default, S3 as an option. Same adapter interface, two implementations.

## Decision

Provide two storage implementations from v1, with the same adapter interface:

1. **Local filesystem** (default) — for Docker/VPS self-hosted deployments
2. **S3-compatible** (alternative) — for cloud deployments (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces)

### StorageAdapter interface

```typescript
interface StorageAdapter {
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
```

This is deliberately simpler than StoryBooker's interface (no "containers", no MIME types, no streams). Just read/write/delete buffers.

### Local layout

```
data/                          # --data-dir flag
  {projectId}/
    builds/{buildId}/screenshots/{storyId}/{viewport}.png
    builds/{buildId}/diffs/{storyId}/{viewport}.png
    builds/{buildId}/storybook/       # extracted Storybook build (served for capture + preview)
    baselines/{branch}/{storyId}/{viewport}.png
```

### S3-compatible layout

Same path structure, stored in a bucket. Prefix: `data/` or configurable via `--storage-prefix`.

```typescript
const s3 = createS3Storage({
  bucket: process.env.S3_BUCKET,
  prefix: "shelf/",                       // optional key prefix
  endpoint: process.env.S3_ENDPOINT,      // for MinIO, R2, etc.
  region: process.env.S3_REGION,
  // Uses AWS SDK v3 from-env credentials
});
```

### Backup

- **Local:** `rsync` or `cp` the `data/` directory. SQLite is a single file: `data/shelf.db`.
- **S3:** `aws s3 sync` or versioning-enabled bucket for point-in-time recovery.
- **Docker:** volume mount persists across container restarts.

### Retention

Baselines are the durable truth and are **never purged**; build data (screenshots, diffs, Storybook statics) is transient. See ADR 0009 for the purge policy (TTL + per-branch retention + orphan-GC), which deletes storage files and database rows together.

## Consequences

**Positive:**
- Local: zero infrastructure, one `docker run`, trivial debugging
- S3: horizontal scaling, cloud-native, versioning, lifecycle policies
- Same adapter interface — switch between local and S3 by changing one config flag
- MinIO gives you S3-compatible storage on-prem without an AWS account

**Negative:**
- Two implementations to maintain (but the interface is ~5 methods, so this is minimal)
- S3 has eventual consistency for listing (mitigated by strong consistency for reads/writes since 2020)
