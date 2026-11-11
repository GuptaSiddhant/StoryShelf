import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      glint: {
        command:
          "vp lint --type-aware --type-check server.ts ai.ts ai.test.ts vitest.config.ts sprite.ts sprite.test.ts storage.ts storage.test.ts migrate.ts migrate.test.ts migrate-to-s3.ts && vp lint sprite",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      gtest: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      build: {
        command: "rolldown -c rolldown.config.ts",
        cache: { input: [{ auto: true }, "!dist/**"], output: ["dist/**"] },
      },
    },
  },
});
