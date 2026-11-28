---
"@storyshelf/app": patch
"@storyshelf/core": patch
"@storyshelf/db": patch
---

Internal: the earlier-verdict lookup on the review page is one bounded query

`SnapshotModel.latestEarlierOnBranch` finds the latest earlier snapshot of a story, mode and target on the branch with a single `LIMIT 1` query, replacing a scan of up to 200 builds' snapshots per render. Adds the non-unique index `snapshots_project_story_mode_idx` on `snapshots (project_id, story_id, viewport_name, browser)`.

Schema: expand step, a new non-unique index `snapshots_project_story_mode_idx` on `snapshots`; no existing table or column changes
