---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Added: repository picker in Project → Settings → Git when the operator switch is on

With "any repository a connection covers" allowed, the link form offers the repositories the
server's connection reaches (a GitHub App's installation repositories, a GitLab group's projects)
beside the typed URL. The list is paginated with a hard page cap and the form says when it was cut
short; if listing fails the form falls back to the typed URL. With the switch off the form stays
URL-only and the host is never asked. A typed URL resolves as before.

