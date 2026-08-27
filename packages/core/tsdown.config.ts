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
  ddl: "./src/ddl.ts",
  types: "./src/types.ts",
  "models/project": "./src/models/project.ts",
  "models/build": "./src/models/build.ts",
  "models/snapshot": "./src/models/snapshot.ts",
  "models/baseline": "./src/models/baseline.ts",
  "models/member": "./src/models/member.ts",
  "models/comment": "./src/models/comment.ts",
  "models/label": "./src/models/label.ts",
  "models/token": "./src/models/token.ts",
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
