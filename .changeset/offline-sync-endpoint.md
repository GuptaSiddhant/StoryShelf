---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: an offline sync endpoint for default-branch Storybooks (ADR 0048).

`GET /api/v1/offline?projects=<slug,…>` (class `hosting`) lists, for each requested project the caller may read, the latest published default-branch build with its file manifest (path, content hash, size) and `maxOfflineDays`. A project that is unknown, hidden or has no such build is left out. The new `offline.maxOfflineDays` config (default 30) sets how long a device may keep serving a copy after its last sync.

Schema: none
