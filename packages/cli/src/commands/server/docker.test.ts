import { describe, expect, it } from "vitest";
import { generateComposeYaml, generateDockerfile, generateDockerignore } from "./docker.ts";

describe("generateDockerfile", () => {
  it("installs production dependencies and copies src on a Playwright image", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("FROM mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("RUN npm install --omit=dev");
    expect(dockerfile).toContain("COPY src/ ./src/");
  });

  it("runs the TypeScript entry directly, like npm start", () => {
    expect(generateDockerfile()).toContain('CMD ["node", "src/index.ts"]');
  });

  it("does not bundle: no esbuild, no dist output", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).not.toContain("esbuild");
    expect(dockerfile).not.toContain("dist/");
  });

  it("uses a pinned Playwright image, never latest", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).not.toContain("playwright:latest");
    expect(dockerfile).toMatch(/FROM mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-\w+/u);
  });

  it("copies the lockfile when present", () => {
    expect(generateDockerfile()).toContain("COPY package*.json ./");
  });
});

describe("generateDockerignore", () => {
  it("ignores node_modules and data", () => {
    const ignore = generateDockerignore();
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("data/");
  });
});

describe("generateComposeYaml", () => {
  it("includes base service and volumes", () => {
    const yaml = generateComposeYaml("sqlite");
    expect(yaml).toContain("storyshelf:");
    expect(yaml).toContain("storyshelf-data:");
  });

  it("adds turso env only for turso", () => {
    expect(generateComposeYaml("turso")).toContain("TURSO_DATABASE_URL");
    expect(generateComposeYaml("sqlite")).not.toContain("TURSO_DATABASE_URL");
    expect(generateComposeYaml("better-sqlite3")).not.toContain("TURSO_DATABASE_URL");
  });

  it("adds postgres service for postgres", () => {
    const yaml = generateComposeYaml("postgres");
    expect(yaml).toContain("postgres:");
    expect(yaml).toContain("postgres-data:");
  });
});
