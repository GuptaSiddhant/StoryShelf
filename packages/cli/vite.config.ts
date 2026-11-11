import { defineConfig } from "vite-plus";
import tsdownConfig from "./tsdown.config.js";

export default defineConfig({
  pack: tsdownConfig,
  run: {
    tasks: {
      glint: {
        command: "vp lint --type-aware --type-check ./src",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      gtest: {
        command: "vp test run",
        cache: {
          env: [
            "PUBLISHED_BASE_DOMAIN",
            "STORAGE_S3_BUCKET",
            "STORAGE_S3_ENDPOINT",
            "STORAGE_S3_REGION",
            "TURSO_DATABASE_URL",
            "TURSO_AUTH_TOKEN",
            "RUN_TERRAFORM",
          ],
        },
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
      test: {
        command: "vp test run",
        cache: {
          env: [
            "PUBLISHED_BASE_DOMAIN",
            "STORAGE_S3_BUCKET",
            "STORAGE_S3_ENDPOINT",
            "STORAGE_S3_REGION",
            "TURSO_DATABASE_URL",
            "TURSO_AUTH_TOKEN",
            "RUN_TERRAFORM",
          ],
        },
      },
    },
  },
});
