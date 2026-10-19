---
title: Baseline portability
description: Export a project's baselines as a zip and import them into any StoryShelf instance — backup, migration, and staging → prod promotion.
---

Your baselines are yours. StoryShelf can export every accepted baseline of a project as a plain zip archive and import the same archive into any StoryShelf instance. There's no lock-in in either direction: you can leave with your baselines, or bring them in.

Typical uses:

- **Backup and restore**: take a nightly snapshot of your baselines, restore after an incident.
- **Migration**: move a project to a new server, database, or storage backend without re-accepting every story.
- **Promotion**: export the baselines approved on a staging instance and import them into production.

Only baselines move. Builds, snapshots, and review history are transient by design (see [Retention](/concepts/retention/)), so they are not part of the archive.

## Export

```sh
curl -fsS -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -o baselines.zip \
  "https://storyshelf.example.com/api/v1/projects/my-app/baselines/export"
```

Add `?branch=main` to export a single branch. Without it, every branch is exported, including feature-branch baselines.

Anyone who can view the project (role **viewer** or higher, including project tokens) can export, because they can already see each baseline image in the review UI. The export is streamed, so memory use stays flat even for large projects.

## Import

```sh
curl -fsS -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @baselines.zip \
  "https://storyshelf.example.com/api/v1/projects/my-app/baselines/import"
# {"imported":42,"created":40,"updated":2}
```

Import requires the **approver** (or admin) role, the same permission that accepts baselines through review. The target project must already exist. Its slug and id can differ from the source project's, because archives never contain instance-specific ids.

Import is an **upsert**:

- A baseline with the same story, mode, browser, and branch is **overwritten**.
- Baselines in the project that are not in the archive are **kept**.
- Imported baselines keep their original `createdAt` / `updatedAt` timestamps. Their link to the snapshot they were accepted from is cleared, because snapshots don't travel.
- Importing the same archive twice is safe (the second run reports everything as `updated`).

The whole archive is validated before anything is written. A malformed archive returns `400` and leaves the project untouched.

## Archive format (v1)

The archive mirrors the storage layout, minus the project id:

```
manifest.json
baselines/
  main/
    button--primary/
      desktop.png            # chromium keeps the bare mode name
      desktop~firefox.png    # other engines get a ~browser suffix
  feature/login/
    card--default/
      mobile.png
```

`manifest.json` is the source of truth:

```json
{
  "format": "storyshelf-baselines",
  "version": 1,
  "exportedAt": "2026-10-13T09:00:00.000Z",
  "project": "my-app",
  "branch": null,
  "baselines": [
    {
      "storyId": "button--primary",
      "viewport": "desktop",
      "browser": "chromium",
      "branch": "main",
      "mode": null,
      "infraHash": "…",
      "createdAt": "2026-09-01T12:00:00.000Z",
      "updatedAt": "2026-10-10T08:30:00.000Z",
      "file": "baselines/main/button--primary/desktop.png",
      "sha256": "…"
    }
  ],
  "skipped": []
}
```

- `branch` is the export filter (`null` means all branches).
- `skipped` lists baselines whose image is missing from storage (or over the 64 MiB image limit). They are reported, not archived, and logged by the server, so a single broken row never blocks an export. Other storage errors (for example a transient S3 failure) abort the download instead, so a truncated archive is never mistaken for a complete backup.
- Images are stored uncompressed inside the zip, since PNGs are already compressed.

Because the format is plain zip, JSON, and PNG, you can also build archives yourself, for example to seed StoryShelf from screenshots taken elsewhere. Write one manifest entry per image and include each image's SHA-256.

## Limits and safety

Imports come from outside the instance, so the server treats every archive as untrusted:

| Check                 | Limit / rule                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Request body          | `min(maxUploadBytes, 512 MiB)`, otherwise `413`                                                                                             |
| Archive size          | 512 MiB in both directions, so an export can always be imported back. An export that would grow past it fails; export one branch at a time. |
| Baselines per archive | 50,000 (export a branch at a time beyond that)                                                                                              |
| One image             | 64 MiB                                                                                                                                      |
| `manifest.json`       | 32 MiB                                                                                                                                      |
| Zip features          | No zip64, encryption, or multi-disk. Entry sizes are checked before decompression, and CRCs are verified.                                   |
| Entry names           | No absolute paths, `..` segments, backslashes, or drive letters                                                                             |
| Identities            | Story, mode, browser, and branch pass the same path-segment checks as captured baselines                                                    |
| Content               | PNG signature plus SHA-256 match with the manifest                                                                                          |

Storage paths are always derived from the manifest identity, never from file names inside the zip, so an archive can't write outside its project's baseline prefix.

## Recipes

**Promote staging → production**

```sh
curl -fsS -H "Authorization: Bearer $STAGING_TOKEN" -o main.zip \
  "https://staging.example.com/api/v1/projects/my-app/baselines/export?branch=main"
curl -fsS -H "Authorization: Bearer $PROD_APPROVER_TOKEN" -H "Content-Type: application/zip" \
  --data-binary @main.zip "https://storyshelf.example.com/api/v1/projects/my-app/baselines/import"
```

**Nightly backup**

```sh
curl -fsS -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -o "baselines-$(date +%F).zip" \
  "https://storyshelf.example.com/api/v1/projects/my-app/baselines/export"
```

**Coming from Chromatic**: Chromatic has no baseline export API, so there's nothing to import on day one. See [Migrating from Chromatic](/guides/chromatic-migration/). Once you're on StoryShelf, this export means you won't hit the same wall again.

The full request and response schemas are in the [API reference](/api/).
