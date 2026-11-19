---
"@storyshelf/app": patch
"storyshelf": patch
---

Added: `storyshelf upload` prints a link to the build page when it finishes

The create-build answer carries the build page's path as `buildUrl` (from the store's URL builder, never absolute). The CLI joins it to the server URL it was given and prints `View the build: <url>`, for a skipped build too. A server that predates the field still gets `Build created: <id>`.
