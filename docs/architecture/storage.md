# Storage

> Part of the [StoryShelf architecture spec](./README.md).

## Storage Layout

```
data/                                    # --data-dir flag (default: ./data)
  content/
    {sha256}                             # published Storybook files, stored once by content; shared by every build and project, swept when no live build's manifest names them
  {projectId}/
    content/
      {sha256}.png                       # screenshots, stored by content; shared by snapshots and baselines, swept when unreferenced
    builds/
      {buildId}/
        screenshots/
          {storyId}/{mode}.png           # legacy captured screenshots (pre content-addressing); non-chromium engines: {mode}~{browser}.png
        diffs/
          {storyId}/{mode}.png           # generated diff overlay (transient, TTL'd)
        storybook/
          manifest.json                  # path -> sha256 of the published Storybook; the files are read from content/{sha256}
          index.json                     # LEGACY: per-build files exist only for builds published before the content store; read as a fallback when there is no manifest
          static/                        # LEGACY, as above
        catalog.json                     # compact catalog of the build's index.json (entries: id, title, name, import path, type, tags)
    baselines/                           # LEGACY layout: screenshots and baselines live under {project}/content/
      {branch}/
        {storyId}/{mode}.png             # canonical approved screenshot (default branch NEVER TTL'd; feature branches TTL'd via branchTtlDays 30d daily GC)
```

**Design decisions:**

- **Local filesystem is the default.** One `docker run` to self-host. No cloud accounts needed.
- **Cloud adapters are drop-in alternatives.** S3-compatible (R2, MinIO, AWS S3, Spaces), Google Cloud Storage (GCS + emulator), and Azure Blob Storage (Azurite) — same `StorageAdapter` interface, four implementations.
- **No "container" abstraction.** Just paths. Storage adapter is `read/write/delete/exists/list` over a flat path namespace.
- **Baselines stored separately from builds, under their own branch.** Baselines are the "truth" — builds are transient, baselines persist.
