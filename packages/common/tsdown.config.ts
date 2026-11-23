import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  errors: "./src/errors/index.ts",
  http: "./src/http/index.ts",
  ids: "./src/ids/index.ts",
  logger: "./src/logger.ts",
  redact: "./src/redact/index.ts",
  settings: "./src/settings/index.ts",
  tracing: "./src/tracing/index.ts",
});
