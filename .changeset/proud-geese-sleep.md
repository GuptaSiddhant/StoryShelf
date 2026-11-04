---
"@storyshelf/affected": minor
"@storyshelf/ai": minor
"@storyshelf/app": minor
"@storyshelf/auth": minor
"@storyshelf/core": minor
"@storyshelf/db-mysql": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/design-figma": minor
"@storyshelf/image": minor
"@storyshelf/mcp": minor
"@storyshelf/notify-chat": minor
"@storyshelf/notify-email": minor
"@storyshelf/notify-git": minor
"@storyshelf/observability": minor
"@storyshelf/runner-playwright": minor
"@storyshelf/runner-puppeteer": minor
"@storyshelf/storage-azure": minor
"@storyshelf/storage-gcs": minor
"@storyshelf/storage-local": minor
"@storyshelf/storage-s3": minor
"storyshelf": minor
---

Added: `@`-mention project members in review comments (#463, #437). A comment can name a project member with `@alex.doe` (the part of their email before the `@`) or `@Alex Doe` (their display name). The server resolves it against that project's members only and stores the ids in a new nullable `comments.mentions` column (JSON, in SQLite, Postgres and MySQL; existing databases get it on start-up). A handle that names no member, or two, stays plain text. Mentions show highlighted with the member's current name, and the API's comments carry `mentions: [{ userId, handle }]` (never read from the request). Each mentioned member gets one `comment:mentioned` notification: by email by default, through their subscription's channels when they have an enabled one, never to a project channel or a webhook, and a member who is subscribed to `comment:created` and mentioned gets the mention instead of the comment. The comment box suggests members as you type `@` (two new `review` page routes, `mention-suggest` and `mention-complete`).
