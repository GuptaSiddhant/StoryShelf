---
"@storyshelf/affected": patch
"@storyshelf/ai": patch
"@storyshelf/app": patch
"@storyshelf/auth": patch
"@storyshelf/core": patch
"@storyshelf/db-mysql": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/design-figma": patch
"@storyshelf/image": patch
"@storyshelf/mcp": patch
"@storyshelf/notify-chat": patch
"@storyshelf/notify-email": patch
"@storyshelf/notify-git": patch
"@storyshelf/observability": patch
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
"@storyshelf/storage-azure": patch
"@storyshelf/storage-gcs": patch
"@storyshelf/storage-local": patch
"@storyshelf/storage-s3": patch
"storyshelf": patch
---

Fixed: a personal notification subscription no longer silently loses messages to a room kind (#538, #437). A subscription is personal, so `via` may only name kinds that address one person; notifier providers now declare `audience` (`person` for email, `room` for Slack, Teams and the log notifier). Saving a subscription that lists a room kind such as `slack-webhook` answers 422 and points to project channels. An existing row that lists one keeps delivering over its personal kinds (mentions, review requests and every other topic share the rule), skips the room kind and logs one warning per subscription and kind, with no addresses.
