---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Added: Project → Settings → Git links a repository through the server's git connection

A project admin links a repository by its URL and a status prefix (shown as `<prefix>/testing`). The link waits for a site admin, then shows as Connected with the required check; it can also be Refused, Broken (with the reason) or Managed by configuration, and its Storybook status, pull-request comment and annotations are set per link within the connection's ceiling. The section appears only while the server has a git connection, and with the operator switch off the form gives the same answer whether or not a repository exists. `postsComments` is now exported from `@storyshelf/core/capture`. There is no schema change.
