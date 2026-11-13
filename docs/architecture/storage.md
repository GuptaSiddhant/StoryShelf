# Storage

> Part of the [StoryShelf architecture spec](./README.md).

## Storage Layout

The layout below is what new installs write. The legacy paths, which are still read, are in their own block after it.

```
data/                                        # --data-dir flag (default: ./data); the storage adapter's root
  content/
    {sha256}                                 # published Storybook files, stored once by content; shared by every build and project; swept when no live build's manifest names them
  {projectId}/
    content/
      {sha256}.png                           # screenshots, stored by content; shared by snapshots and baselines; swept when unreferenced
    builds/
      {buildId}/
        storybook.zip                        # the uploaded Storybook archive, read when its statics are extracted
        storybook/
          manifest.json                      # path -> sha256 of the published Storybook; the files are read from content/{sha256}
        catalog.json                         # compact catalog of the build's index.json (entries: id, title, name, import path, type, tags)
        diffs/
          {storyId}/{mode}.png               # generated diff overlay (transient, TTL'd)
```

**Legacy layout** (read as a fallback, never written by new builds):

```
data/
  {projectId}/
    builds/
      {buildId}/
        screenshots/
          {storyId}/{mode}.png               # captured screenshots from before content addressing; non-chromium engines: {mode}~{browser}.png
        storybook/
          index.json                         # per-build copy of index.json, from builds published before the content store; read as a fallback when there is no manifest
          static/                            # per-build published files, as above
    baselines/
      {branch}/
        {storyId}/{mode}.png                 # baselines from before content addressing; the default branch is never TTL'd, feature branches are GC'd by branchTtlDays
```

**Design decisions:**

- **Local filesystem is the default.** One `docker run` to self-host. No cloud accounts needed.
- **Cloud adapters are drop-in alternatives.** S3-compatible (R2, MinIO, AWS S3, Spaces), Google Cloud Storage (GCS + emulator), and Azure Blob Storage (Azurite) — same `StorageAdapter` interface, four implementations.
- **No "container" abstraction.** Just paths. Storage adapter is `read/write/delete/exists/list` over a flat path namespace.
- **Content-addressed images.** Screenshots and published files are stored once by SHA-256. A baseline is a row that names a content hash, so approving a screenshot does not copy it.
- **Baselines are separate from builds.** A build's own objects live under `builds/{buildId}/` and are deleted when the build is purged. Baselines persist, and are released only through the retention lifecycle (see [Retention](./retention.md)).
