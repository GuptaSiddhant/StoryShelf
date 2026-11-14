---
"@storyshelf/core": minor
"@storyshelf/notify-chat": patch
---

Added: Slack, Teams and log chat providers are built into core

The chat providers now live in `@storyshelf/core` and register by default, so a project admin can connect Slack or Teams without installing a package. `@storyshelf/notify-chat` re-exports them and is deprecated.
