---
"@storyshelf/app": minor
"storyshelf": minor
---

Added: cancel older unfinished builds in one step, from the builds page, the CLI and the API

`POST /api/v1/projects/:slug/builds/cancel` (class `testing`, developer role) takes `branch?`, `keepNewest?` (default 1 per branch) and `dryRun?`, cancels the older `pending`, `capturing` and `comparing` builds a batch at a time, and answers `{ cancelled, count, dryRun }`. Each build is cancelled the single-cancel way, so its jobs end and its git statuses settle. `storyshelf cancel [--branch] [--keep-newest] [--dry-run]` and a "Cancel older unfinished builds" action on the builds page use it.

Schema: none.
