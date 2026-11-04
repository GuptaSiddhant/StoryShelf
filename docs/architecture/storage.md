# Storage

> Part of the [StoryShelf architecture spec](./README.md).

## Storage Layout

```
data/                                    # --data-dir flag (default: ./data)
  {projectId}/
    content/
      {sha256}.png                       # screenshots, stored by content; shared by snapshots and baselines, swept when unreferenced
    builds/
      {buildId}/
        screenshots/
          {storyId}/{mode}.png           # legacy captured screenshots (pre content-addressing); non-chromium engines: {mode}~{browser}.png
        diffs/
          {storyId}/{mode}.png           # generated diff overlay (transient, TTL'd)
        storybook/                       # extracted Storybook static build (served for capture + preview)
          index.json
          static/
        catalog.json                     # compact catalog of the build's index.json (entries: id, title, name, import path, type, tags)
    baselines/
      {branch}/
        {storyId}/{mode}.png             # canonical approved screenshot (default branch NEVER TTL'd; feature branches TTL'd via branchTtlDays 30d daily GC)
```

**Design decisions:**

- **Local filesystem is the default.** One `docker run` to self-host. No cloud accounts needed.
- **Cloud adapters are drop-in alternatives.** S3-compatible (R2, MinIO, AWS S3, Spaces), Google Cloud Storage (GCS + emulator), and Azure Blob Storage (Azurite) — same `StorageAdapter` interface, four implementations.
- **No "container" abstraction.** Just paths. Storage adapter is `read/write/delete/exists/list` over a flat path namespace.
- **Baselines stored separately from builds, under their own branch.** Baselines are the "truth" — builds are transient, baselines persist.
