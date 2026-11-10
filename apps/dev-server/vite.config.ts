import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: "vp test run",
        cache: { input: [{ auto: true }, "!.vitest/**", "!.gitignore"] },
      },
    },
  },
});
