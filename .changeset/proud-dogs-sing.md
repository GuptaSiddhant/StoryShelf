---
"@storyshelf/affected": patch
"@storyshelf/ai": patch
"@storyshelf/app": patch
"@storyshelf/auth": patch
"@storyshelf/core": patch
"@storyshelf/db-mysql": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/design-figma": patch
"@storyshelf/image": patch
"@storyshelf/mcp": patch
"@storyshelf/notify-chat": patch
"@storyshelf/notify-email": patch
"@storyshelf/notify-git": patch
"@storyshelf/observability": patch
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
"@storyshelf/storage-azure": patch
"@storyshelf/storage-gcs": patch
"@storyshelf/storage-local": patch
"@storyshelf/storage-s3": patch
"storyshelf": patch
---

Fixed: the AI per-project call limit now holds under concurrent requests (#545). A run reserves one of the project's calls before the model is called (a pending usage row with no tokens, counted as a call; a reservation that never gets a provider answer stays a failed call with zero tokens), so N parallel insight requests can no longer all pass the check and overshoot `perProjectCallsPerHour`. `AiUsageModel` gains `reserve`, `attach`, `complete`, `settleFailed` and `release`. Usage totals for sequential calls are unchanged. The daily token cap can still be overshot by the output of the calls already running.
