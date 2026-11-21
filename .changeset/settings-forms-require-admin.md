---
"@storyshelf/app": patch
---

Security: project settings forms require the admin role

Every state-changing form under a project's settings now authorizes the caller as a project admin, as
its `/api/v1` twin does; saving your own notification preferences stays open to every member.
Deleting a project from the settings page needs a site admin, as `DELETE /api/v1/projects/:slug`
does, and the danger zone is shown only to site admins. A new test checks every such form as a viewer
and a developer.
