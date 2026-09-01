import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

export default defineConfig({
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  entry: { index: "./src/index.ts" },
  platform: "node",
  target: "node22",
  treeshake: true,
  cjsDefault: false,
  fixedExtension: false,
  deps: { neverBundle: true },
  clean: true,
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
