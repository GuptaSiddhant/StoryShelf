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

Added: turn review-request emails off per project (#450, #437). A project member can switch `review:requested` off with **Send me review requests** (`reviewRequests` on `PUT …/notifications/me`, default `true`) without touching their other topics or channels; `notification_subscriptions` gains `review_requests` on all three databases, and existing rows keep receiving it. Unticking **Email me**, here or on the profile page, now keeps the subscription switched off instead of deleting it, so it no longer falls back to the default recipients. The topic checkboxes come from one list in core (`NOTIFICATION_EVENTS`), so `review:verdict`, `design:changed` and `insight:ready` appear (`review:requested` has no checkbox: the switch is its only control), and ticking every box stores all topics (`events` null) so later events still arrive.
