---
title: Back up and restore
description: Back up the database and storage of a StoryShelf deployment, restore them together, and check that no blob is missing.
---

A deployment has two halves: the **database** (rows) and **storage** (screenshots and published Storybook files). Restoring one without the other breaks builds and baselines, so back up and restore both, in the order below. (Baselines alone can also move as a zip; see [Baseline portability](/guides/portability/).)

## Back up the database

- **SQLite:** `sqlite3 shelf.db "VACUUM INTO 'backup.db'"` writes a consistent copy while the server runs. Or replicate continuously with Litestream.
- **Postgres:** `pg_dump --format=custom "$DATABASE_URL" > shelf.dump`
- **MySQL:** `mysqldump --single-transaction shelf > shelf.sql`

## Back up storage

- **Local storage:** sync the data directory (`rsync -a`, or a volume snapshot).
- **Cloud storage (S3, Azure Blob, GCS):** turn on bucket versioning or cross-region replication.

## Order: database first, then storage

Take the database backup first, then the storage backup. Storage then holds everything the database rows name, and possibly a few extra blobs. Retention makes that safe: a shared blob is only collected after nothing has used it for `CONTENT_GRACE_MS` (7 days), so a blob the database backup references is still in storage when you copy it later. The reverse order can capture rows whose blobs were never copied.

## Restore

1. Stop the server.
2. Restore the database from its backup.
3. Restore storage from its backup (or its replica/version).
4. Start the server.
5. Run the check below.

## Check consistency

```sh
storyshelf server check-storage --url https://shelf.example.com --token "$STORYSHELF_ADMIN_TOKEN"
```

The check is read-only. It walks published manifests and baselines, reports builds with blobs that storage lacks and baselines whose image is gone, and counts blobs nothing references. Output names build ids and counts only. It exits non-zero when something is missing. Add `--sample 50` to check only the newest 50 builds on a large instance (the unreferenced count is skipped then).

Unreferenced blobs are not an error; retention collects them after the grace period. Re-run [`storyshelf purge`](/guides/cli/) only on a healthy instance, never to "fix" a restore.
