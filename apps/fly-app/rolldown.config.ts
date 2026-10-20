import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "rolldown";

// `sharp` is the optional native image engine: it must resolve at runtime, never be inlined.
const EXTERNAL = /^(pino(\/|$)|playwright(-core)?(\/|$)|sharp(\/|$))/u;

const root = resolve(import.meta.dirname ?? ".", "../..");

export default defineConfig({
  platform: "node",
  // Absolute paths so the build works from any CWD (package dir locally,
  // repo root in Docker).
  // `worker` is the diff pool's thread entry: `@storyshelf/image` spawns `new URL("worker.mjs", import.meta.url)`,
  // and once it is inlined into server.mjs that resolves next to it. Without it the pool would
  // silently fall back to diffing on the main thread.
  input: {
    server: resolve(root, "apps/fly-app/server.ts"),
    worker: resolve(root, "packages/image/src/worker.ts"),
  },
  output: {
    dir: resolve(root, "apps/fly-app/dist"),
    entryFileNames: "[name].mjs",
    format: "esm",
    // Inlined CommonJS deps (unzipper, ...) call `require("zlib")`, which ESM does not provide.
    banner:
      'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  // The runtime image only carries the root-hoisted node_modules, not the per-package ones, and
  // hoisting picks one version per name (root zod is v3, the app needs v4). So inline every npm
  // dep so each resolves to its own version; only pino (worker transports load real files) and
  // Playwright (browser binaries) stay external, and both are hoisted in nub.jsonc.
  external: (id) => id.startsWith("node:") || builtinModules.includes(id) || EXTERNAL.test(id),
  // Keep side-effect-only imports (e.g. `reflect-metadata`, required by tsyringe) in order.
  treeshake: { moduleSideEffects: true },
  resolve: {
    alias: {
      "@storyshelf/core": resolve(root, "packages/core/src/index.tsx"),
      "@storyshelf/app": resolve(root, "packages/app/src/index.tsx"),
      "@storyshelf/db-sqlite": resolve(root, "packages/db-sqlite/src/index.ts"),
      "@storyshelf/storage-local": resolve(root, "packages/storage-local/src/index.ts"),
      "@storyshelf/runner-playwright": resolve(root, "packages/runner-playwright/src/index.ts"),
      "@storyshelf/auth": resolve(root, "packages/auth/src/index.ts"),
    },
    conditionNames: ["source", "import", "default"],
  },
});
