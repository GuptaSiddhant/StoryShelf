---
"@storyshelf/core": patch
---

Fixed: one pull-request comment per project, found beyond the first 100 comments

The comment is keyed by project instead of build, so ten pushes rewrite one comment and an older build never overwrites a newer one. GitHub and GitLab comment lists now follow every page, so a busy pull request no longer collects a second comment. The old per-build marker is still read for one release, so an open pull request adopts its comment.
