---
"@storyshelf/app": patch
---

Fixed: the "Notifications are paused" banner shows only when a notification channel is enabled (#1018)

With the integrations built in, every install had a notifier wired, so the banner showed on every install without a confirmed public origin, even with no channel configured. It now shows only when at least one channel (site-wide or on a project) is enabled and no origin is confirmed.
