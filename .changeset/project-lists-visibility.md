---
"@storyshelf/app": patch
---

Security: project lists show only projects the signed-in user can open

With sign-in on, the **Projects** page, the top-bar project switcher, `GET /api/v1/projects`, the builds and label pages and the upstream picker in a project's settings listed every project, including ones whose pages and API answer 404 for the viewer. They now list only projects where the user has an effective role (`visibleProjects`); with auth off, and for site admins and site viewers, every project is listed, as before. Admin-only and background callers are unchanged.

Schema: none.
