import { defineConfig, type UserConfig } from "tsdown";

const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");

const entry: UserConfig["entry"] = {
  index: "./src/index.tsx",
  "adapter/database": "./src/adapters/database.ts",
  "adapter/storage": "./src/adapters/storage.ts",
  "adapter/capture-runner": "./src/adapters/capture-runner.ts",
  "adapter/auth": "./src/adapters/auth.ts",
  "adapter/status": "./src/adapters/status.ts",
  "adapter/logger": "./src/adapters/logger.ts",
  schema: "./src/schema.ts",
  types: "./src/types.ts",
};

export default defineConfig({
  dts: true,
  entry,
  platform: "node",
  sourcemap: true,
  target: "node22",
  treeshake: true,
  unbundle: true,
  cjsDefault: false,
  deps: { neverBundle: true },
  shims: true,
  clean: !isWatchMode,
});
