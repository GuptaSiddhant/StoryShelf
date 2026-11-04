---
"@storyshelf/app": patch
---

Added: a signed story preview now says, under the preview, that it reloads itself every 40 minutes to stay signed in (from the configured interval). When a renewal still fails after its retries, a warning notice replaces that line with a "Reload preview" button that asks for a fresh signed link now, announces itself politely, and moves focus into the frame on success. The sandbox is unchanged. `Alert` takes an optional `role` (`"status"` for a polite message).
