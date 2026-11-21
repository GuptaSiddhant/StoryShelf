import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  "azure/index": "./src/azure/index.ts",
  "gcs/index": "./src/gcs/index.ts",
  "local/index": "./src/local/index.ts",
  "s3/index": "./src/s3/index.ts",
});
