import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        // `ai` pulls in deps that publish a `source` (TypeScript) export condition,
        // which nub enables globally; let Vite transform them instead of Node.
        inline: [/eventsource-parser/u, /@ai-sdk\//u, /\/ai\//u],
      },
    },
  },
});
