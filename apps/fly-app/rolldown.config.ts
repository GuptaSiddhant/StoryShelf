import { resolve } from "node:path";
import { defineConfig } from "rolldown";

const root = resolve(import.meta.dirname ?? ".", "../..");

export default defineConfig({
  // Absolute paths so the build works from any CWD (package dir locally,
  // repo root in Docker).
  input: resolve(root, "apps/fly-app/server.ts"),
  output: {
    dir: resolve(root, "apps/fly-app/dist"),
    entryFileNames: "server.mjs",
    format: "esm",
  },
  external: (id) => {
    if (id.startsWith("node:")) return true;
    if (["better-sqlite3", "playwright", "playwright-core"].includes(id)) return true;
    if (id.startsWith("@storyshelf/")) return false;
    if (id.startsWith(".") || id.startsWith("/")) return false;
    return true;
  },
  resolve: {
    alias: {
      "@storyshelf/core": resolve(root, "packages/core/src/index.tsx"),
      "@storyshelf/db-sqlite": resolve(root, "packages/db-sqlite/src/index.ts"),
      "@storyshelf/storage-local": resolve(root, "packages/storage-local/src/index.ts"),
      "@storyshelf/runner-playwright": resolve(root, "packages/runner-playwright/src/index.ts"),
      "@storyshelf/auth-password": resolve(root, "packages/auth-password/src/index.ts"),
    },
    conditionNames: ["source", "import", "default"],
  },
});
