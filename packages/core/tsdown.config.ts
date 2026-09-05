import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.tsx",
  "adapter/database": "./src/adapters/database.ts",
  "adapter/storage": "./src/adapters/storage.ts",
  "adapter/capture-runner": "./src/adapters/capture-runner.ts",
  "adapter/auth": "./src/adapters/auth.ts",
  "adapter/git-host": "./src/adapters/git-host/index.ts",
  "adapter/git-host/helpers": "./src/adapters/git-host/helpers.ts",
  "adapter/git-host/comments": "./src/adapters/git-host/comments.ts",
  "adapter/capture-queue": "./src/adapters/capture-queue.ts",
  logger: "./src/logger.ts",
  capture: "./src/capture/index.ts",
  diff: "./src/diff/index.ts",
  paths: "./src/utils/paths.ts",
  urls: "./src/urls.ts",
  schema: "./src/schema/index.ts",
  ddl: "./src/ddl.ts",
  types: "./src/types.ts",
});
