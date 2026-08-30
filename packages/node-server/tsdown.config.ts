import { defineConfig } from "tsdown";

export default defineConfig({
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  entry: { index: "./src/index.ts" },
  platform: "node",
  target: "node22",
  treeshake: true,
  cjsDefault: false,
  fixedExtension: false,
  clean: true,
});
