---
"@storyshelf/app": patch
---

Added: Server-Timing adds a render phase and skips published and signed routes

With `serverTiming: true`, app HTML pages and `/api/v1` answers carry `db`, `storage`, `render` and `total`. Published files, signed Storybook routes and assets never get the header.
