---
"@storyshelf/app": patch
---

Added: the server image reads `SHELF_STORYBOOK_HOSTING` to choose `sandboxed` hosting

`SHELF_STORYBOOK_HOSTING=sandboxed` serves uploaded Storybooks in a sandbox without access to the app's session; unset or `trusted` keeps today's behaviour, and any other value stops boot. The security guide now states that the default is `trusted` and what that means. Schema: none.
