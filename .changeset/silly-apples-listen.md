---
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

Wait for the Storybook preview to finish starting before reading story parameters, so a remote page no longer fails with `SB_PREVIEW_API_0005` or silently loses its parameters.
