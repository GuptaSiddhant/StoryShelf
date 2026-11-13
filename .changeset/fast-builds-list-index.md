---
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Changed: index builds by project, branch and creation time so build lists skip the sort

`builds(project_id, created_at)` and `builds(project_id, git_branch, created_at)` replace `builds(git_branch)`, which no query used without a project. Existing databases pick them up on startup; the change is compatible with the previous release.
