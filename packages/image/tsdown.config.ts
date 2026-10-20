import { libConfig } from "../../config/tsdown.ts";

const config = libConfig({
  index: "./src/index.ts",
  worker: "./src/worker.ts",
});

// `worker` is built only so `pool` can spawn it via `new URL("./worker.mjs", import.meta.url)`;
// it stays out of the public `exports` map.
export default {
  ...config,
  exports: { devExports: "source", exclude: ["worker"] },
};
