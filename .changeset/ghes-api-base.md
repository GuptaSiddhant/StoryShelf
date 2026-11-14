---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: GitHub Enterprise Server API base for GitHub channels; refusals name the operator setting (#915)

A GitHub channel takes an optional `apiUrl` (for example `https://ghes.example.com/api/v3`) used for statuses, check runs, the App token exchange and pull-request comments. It goes through the outbound guard like a GitLab host. When the guard refuses a git or chat URL, the settings page now says why and that the operator can allow the exact host in `outbound.allowHosts`; it never shows the resolved address.
