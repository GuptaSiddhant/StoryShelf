---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Added: repository links approved by a site admin, and git delivery through a server connection

A project links a repository through a server-wide git connection (`GitRepositoryLinkModel`): the
link is `pending` until a site admin approves it (`approveRepositoryLink`), which checks coverage
with the connection's own credentials, pins the host's numeric repository id and re-requests the
state of the project's open builds. With the operator switch on, a project admin's link is approved
at once. Configured links (`ShelfOptions.git.links`) count as approved and are applied at startup.
Delivery through an approved link uses its connection, never a channel secret: a GitHub
installation token limited to the pinned repository id, or GitLab addressed by the numeric project
id. After a 401, 403 or 404 the link itself is checked again; only a definitive answer from the
host marks it `broken`. Each link chooses its Storybook status, comment (`always`, `on-changes`,
`off`) and annotations within the connection's ceiling; the merge gate always posts. Per-project
git channels keep working unchanged (epic #1117, ADR 0054).
