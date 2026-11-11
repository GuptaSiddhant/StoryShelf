import { defineConfig } from "vite-plus";
import tsdownConfig from "./tsdown.config.js";

export default defineConfig({
  pack: tsdownConfig,
  run: {
    tasks: {
      glint: {
        command: "vp lint --type-aware --type-check ./src ./.storybook",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      gtest: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      gstorybook: {
        command: "storybook build -o storybook-static --stats-json",
        cache: { input: [{ auto: true }, "!storybook-static/**"], output: ["storybook-static/**"] },
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      "build-storybook": {
        command: "storybook build -o storybook-static --stats-json",
        cache: {
          input: [{ auto: true }, "!storybook-static/**"],
          output: ["storybook-static/**"],
        },
      },
    },
  },
});
