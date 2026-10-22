# @storyshelf/app

The StoryShelf HTTP app: `createShelfApp()` composes database, storage, capture, auth, and notifier (chat, email, git) adapters (all from `@storyshelf/core`) into a complete Hono application — JSON API under `/api/v1` plus server-rendered HTML pages (hono/jsx + HTMX, no client framework).

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";

const app = createShelfApp({ database, storage, testing: { runner: captureRunner } });
await app.lifecycle.init();

serve({ fetch: app.fetch, port: 3000 });
```

## How it fits in

`app` owns everything HTTP: `routers/`, `pages/`, `ui/`, `middleware/`, the request `store`, and vendored assets. All domain logic — adapter interfaces, models, schema, capture pipeline, retention, diff — lives in `@storyshelf/core` and is imported here through its granular subpaths (never the core barrel, which is now domain-only). The capture consumer and the forked capture child live in core too, so they pull zero HTTP modules.
