---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Security: approve the repository link the dialog showed; validate commit ids and break autolinks

The approve dialog posts the link's `updatedAt` and a link edited since is refused. Both build-create routes accept only a hex `gitSha` (7 to 64 characters) or `local-<hex>`, and the pull-request comment keeps commit ids inert and breaks bare URLs and `&` in story text.

Schema: none.
