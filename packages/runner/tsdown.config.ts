import { libConfig } from "../../config/tsdown.ts";

const config = libConfig({
  index: "./src/index.ts",
  "a11y/index": "./src/a11y/index.ts",
  "images/index": "./src/images/index.ts",
  "images/worker": "./src/images/worker.ts",
  "remote/index": "./src/remote/index.ts",
});

// `images/worker` is built only so the diff pool can spawn it via `new URL("worker.mjs", import.meta.url)`;
// it stays out of the public `exports` map.
export default { ...config, exports: { devExports: "source", exclude: ["images/worker"] } };
