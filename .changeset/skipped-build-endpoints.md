---
"@storyshelf/app": minor
"@storyshelf/core": minor
"storyshelf": minor
---

Added: skip-source and skipped-build endpoints, behind `skippedBuilds` (off by default)

`GET /api/v1/projects/:slug/builds/skip-source?branch=&sha=` says which approved build a commit that changed no story may repeat, and `POST /api/v1/projects/:slug/builds/skipped` records that commit as a `skipped` build without an upload (ADR 0044, decisions 3, 4 and 6). Eligibility is checked again in the same transaction as the insert, so a source whose verdict moved after the hint answers `409`. Both routes are class `testing` and answer `404` unless the new server option `skippedBuilds: true` is set, so a release can ship the readers of the `skipped` status before any server writes it (ADR 0053). A skipped build follows its source: whenever the source's state is requested, the state of the builds skipped from it is requested too. A verdict, retry, cancel, re-diff or approval on a skipped build answers `409`. The CLI client gains `skipSource` and `createSkipped`; the `--skip-unchanged` flag follows.
