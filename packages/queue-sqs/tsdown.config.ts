import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: { index: "./src/index.ts" },
  platform: "node",
  target: "node22",
  treeshake: true,
  cjsDefault: false,
  deps: { neverBundle: true },
  clean: true,
});