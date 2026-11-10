import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "rolldown -c rolldown.config.ts",
        cache: { input: [{ auto: true }, "!dist/**"], output: ["dist/**"] },
      },
    },
  },
});
