---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Changed: notifications, git statuses and links open the build page directly

`urls.build` now points at the one build page (`/projects/:slug/builds/:id/diff`), so links no longer cost a redirect. The old `/projects/:slug/builds/:id` path still redirects, so links already sent keep working. (#909)
