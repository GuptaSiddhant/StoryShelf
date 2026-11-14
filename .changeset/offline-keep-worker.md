---
"@storyshelf/app": minor
---

Added: keep a project's default-branch Storybook available offline (ADR 0048)

The service worker now keeps opted-in projects on the device. It syncs from `GET /api/v1/offline` on app start and by periodic background sync, downloads only the content hashes the device lacks into Cache Storage, and deletes projects the answer leaves out and hashes nothing refers to. A 500 MB cap per device refuses a project that would pass it and never evicts silently. Kept Storybooks are served only from the cache at `/offline/<slug>/` and stop being served `maxOfflineDays` after the last successful sync; `/offline` lists them. The page controls it by message (keep, unkeep, sync, usage, set-cap).
