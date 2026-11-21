import { libConfig } from "../../config/tsdown.ts";

const lib = libConfig({
  index: "./src/index.tsx",
  node: "./src/node/index.ts",
  // The `storyshelf-server` executable: a `bin`, not an export (the exports map stays frozen).
  bin: "./src/server-bin/bin.ts",
});

export default {
  ...lib,
  exports: {
    devExports: "source",
    exclude: ["bin"],
    bin: { "storyshelf-server": "./src/server-bin/bin.ts" },
  },
};
