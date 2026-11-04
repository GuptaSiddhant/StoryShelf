---
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

A remote browser that disconnects in the middle of a pass now ends the pass with one `RemoteBrowserLostError` (no more stories are scheduled on it and none after the drop is recorded as a story failure), the lease is released as failed, and the job is retried through the queue; a page crash and a cancel are unchanged.
