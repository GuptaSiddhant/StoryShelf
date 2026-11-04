import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        // `@storyshelf/ai` pulls in `ai`, whose deps publish a `source` (TypeScript) export condition,
        // which nub enables globally; let Vite transform them instead of Node (same as packages/ai).
        inline: [/eventsource-parser/u, /@ai-sdk\//u, /\/ai\//u],
      },
    },
  },
});
