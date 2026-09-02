import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };
const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");

export default defineConfig({
  dts: true,
  entry: { index: "./src/index.ts" },
  platform: "node",
  sourcemap: true,
  target: "node24",
  treeshake: true,
  unbundle: true,
  cjsDefault: false,
  deps: { neverBundle: true },
  exports: { devExports: "source" },
  shims: true,
  clean: !isWatchMode,
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
});
