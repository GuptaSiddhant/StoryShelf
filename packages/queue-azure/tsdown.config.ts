import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  "storage-queues": "./src/storage-queues.ts",
  "service-bus": "./src/service-bus.ts",
});
