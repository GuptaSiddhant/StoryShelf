import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      glint: {
        command: "vp lint --type-aware --type-check ./src",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      gtest: {
        command: "vp test run",
        cache: { input: [{ auto: true }, "!.vitest/**", "!.gitignore"] },
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      test: {
        command: "vp test run",
        cache: { input: [{ auto: true }, "!.vitest/**", "!.gitignore"] },
      },
    },
  },
});
