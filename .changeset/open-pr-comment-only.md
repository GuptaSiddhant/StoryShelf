---
"@storyshelf/core": patch
---

Fixed: the pull-request comment goes only to an open pull request, never to a merged or closed one

GitHub and GitLab list every pull or merge request that contains a commit, so a build of a
default-branch commit commented on the PR that merged it. Both lookups now pick an open one and
post no comment when there is none, as the documentation says.
