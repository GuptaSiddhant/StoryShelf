---
"@storyshelf/app": patch
---

The design render route (`GET /api/v1/projects/:slug/design/renders/:renderId`) is now a hosting route: component design links render on an instance without `testing`, so it no longer answers 404 there.
