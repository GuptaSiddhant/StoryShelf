import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        // The MCP SDK pulls in deps that publish a `source` (TypeScript) export
        // condition, which nub enables globally; let Vite transform them.
        inline: [/eventsource-parser/u, /@modelcontextprotocol\//u],
      },
    },
  },
});
