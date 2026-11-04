---
"@storyshelf/app": minor
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Added: git channels show when they last delivered, and project admins can retry a channel's current state. Notification channels record `last_delivered_at` (set on a successful delivery, left alone by a failure) and the API and settings page show it next to the sanitized latest error. A new **Retry current state** action (`POST /api/v1/projects/{slug}/notification-channels/{channelId}/retry`) asks again for the open builds of the project on that one git channel, never replaying chat, email or webhooks; it needs a project admin and a confirmed public URL.
