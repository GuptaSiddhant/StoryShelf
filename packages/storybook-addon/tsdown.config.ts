import { libConfig } from "../../config/tsdown.ts";

// `shims` is off: the shared config adds Node shims (`node:path`, `import.meta.url`) to every
// module, and the manager tree runs in the browser, where Storybook's bundler cannot resolve them.
const modern = {
  ...libConfig({
    index: "./src/index.ts",
    preset: "./src/preset.ts",
    manager: "./src/manager.ts",
  }),
  shims: false,
};

// The manager entries run in Storybook's browser bundle, not in Node: Storybook's manager builder
// reads them by file path (the preset adds them), so `manager` stays out of the `exports` map.
// Storybook 8.6 externalizes the manager API as `@storybook/manager-api`; 9 and later as
// `storybook/manager-api`. `manager-api.ts` is the one module that names it, and this second
// build writes the whole manager tree to `dist/legacy` with the 8.6 name.
const legacy = {
  ...modern,
  entry: { manager: "./src/manager.ts" },
  outDir: "dist/legacy",
  dts: false,
  clean: false,
  exports: false,
  outputOptions: { paths: { "storybook/manager-api": "@storybook/manager-api" } },
};

export default [{ ...modern, exports: { devExports: "source", exclude: ["manager"] } }, legacy];
