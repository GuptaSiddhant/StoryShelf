---
"@storyshelf/app": minor
"@storyshelf/core": minor
"storyshelf": minor
---

Added: `storyshelf server check-storage` reports blobs the database references but storage lacks

A read-only operator check, backed by `POST /api/v1/admin/check-storage` (site admin). It names build ids and counts, never paths. A new "Back up and restore" guide covers SQLite, Postgres, MySQL and cloud storage.
