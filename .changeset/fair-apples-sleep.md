---
"@storyshelf/core": patch
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

A remote browser failure thrown as something other than an `Error` (a WebSocket error event, a plain object, a string) now keeps what it says instead of `[object Object]`, with its cause chain, secrets removed; a transient outage thrown as an event object is retried instead of marking the target unavailable. `Error` instances classify exactly as before.
