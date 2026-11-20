---
"@storyshelf/core": patch
---

Fixed: story and test names in the pull-request comment never mention a git host user

A story, test or target named like `@acme/button` is written with a zero-width joiner after the `@`, so GitHub and GitLab no longer notify a user or team.

Schema: none
