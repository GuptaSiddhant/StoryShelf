---
"@storyshelf/mcp": patch
---

Changed: the MCP server installs @storyshelf/common instead of all of core (#1334)

`@storyshelf/mcp` took only `httpJson`, `HttpError` and `readSetting` from core. It now depends on `@storyshelf/common`, so `npx @storyshelf/mcp` no longer installs core, Drizzle, pino or the image libraries.

Schema: none.
