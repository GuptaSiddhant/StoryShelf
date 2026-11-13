---
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

Changed: runners reuse pages by default (opt out with STORYSHELF_REUSE_PAGES=0) (#857)

Captures now take pages from the reset pool instead of opening a context and page per screenshot. Set `reusePages: false` or `STORYSHELF_REUSE_PAGES=0` (or `false`) to open a fresh page each time. A page that fails a capture is still discarded.
