---
"@storyshelf/app": patch
---

Changed: a signed-in user with no role on a project now gets `404 Project not found` from its API routes and pages, the same answer as for a project that does not exist, instead of `403` (or the page itself). `403` remains for a member whose role is too low for the action.
