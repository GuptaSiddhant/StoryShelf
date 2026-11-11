import { defineConfig } from "vite-plus";
import tsdownConfig from "./tsdown.config.js";

export default defineConfig({
  run: {
    tasks: {
      glint: {
        command: "vp lint --type-aware --type-check ./src",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      gtest: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
    },
  },
  pack: tsdownConfig,
});
