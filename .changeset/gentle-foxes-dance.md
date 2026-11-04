---
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

Reusing pages (opt-in) now also deletes every Cache Storage entry and unregisters service workers of the Storybook origin when a page is reset between captures, so one story cannot affect the next through them.
