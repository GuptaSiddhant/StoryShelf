# @storyshelf/router

The StoryShelf HTTP server: `createShelfRouter()` composes database, storage, capture, auth, and git-host adapters (all from `@storyshelf/core`) into a complete Hono application — JSON API under `/api/v1` plus server-rendered HTML pages (hono/jsx + HTMX, no client framework).

## Quick start

```ts
import { createShelfRouter } from "@storyshelf/router";

const app = createShelfRouter({ database, storage, captureRunner });
await app.lifecycle.init();

serve({ fetch: app.fetch, port: 3000 });
```

## How it fits in

`router` owns everything HTTP: `routers/`, `pages/`, `ui/`, `middleware/`, the request `store`, and vendored assets. All domain logic — adapter interfaces, models, schema, capture pipeline, retention, diff — lives in `@storyshelf/core` and is imported here through its granular subpaths (never the core barrel, which is now domain-only). Queue and remote workers depend on core alone and pull zero HTTP modules.
