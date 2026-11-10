import { defineConfig } from "vite-plus";
import tsdownConfig from "./tsdown.config.js";

export default defineConfig({
  pack: tsdownConfig,
  run: {
    tasks: {
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
