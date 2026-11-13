---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Internal: add `projects.switch_stories` (default off) and the operator veto `testing.switchStories` (#988)

Schema: expand-only. Adds the boolean column `projects.switch_stories`, `NOT NULL DEFAULT false`, in SQLite, Postgres and MySQL; nothing is dropped or altered, and the previous release ignores it. Nothing reads it yet: it takes effect with the runner work of ADR 0052, which ships only after its measurement gate.

`testing.switchStories: false` forbids the setting for the whole server; `switchStoriesEnabled(project, veto)` is the one place the project's value is read.
