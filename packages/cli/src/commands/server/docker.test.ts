import { describe, expect, it } from "vitest";
import {
  generateComposeYaml,
  generateComposeYamlWithWorker,
  generateDockerfile,
  generateDockerignore,
  generateSlimServerDockerfile,
  generateWorkerDockerfile,
  generateWorkerComposeSnippet,
} from "./docker.ts";

describe("generateDockerfile", () => {
  it("installs production dependencies and copies src on a Playwright image", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("FROM mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("RUN npm install --omit=dev");
    expect(dockerfile).toContain("COPY src/ ./src/");
  });

  it("runs the TypeScript entry directly, like npm start", () => {
    expect(generateDockerfile()).toContain(
      'CMD ["node", "--experimental-transform-types", "src/index.ts"]',
    );
  });

  it("does not bundle: no esbuild, no dist output", () => {
    for (const dockerfile of [
      generateDockerfile(),
      generateSlimServerDockerfile(),
      generateWorkerDockerfile(),
    ]) {
      expect(dockerfile).not.toContain("esbuild");
      expect(dockerfile).not.toContain("dist/");
    }
  });

  it("uses a pinned Playwright image, never latest", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).not.toContain("playwright:latest");
    const image = /FROM (?<image>mcr\S+)/u.exec(generateWorkerDockerfile())?.groups?.["image"];
    expect(image).toBeDefined();
    expect(dockerfile).toContain(`FROM ${image}`);
  });

  it("copies the lockfile when present", () => {
    expect(generateDockerfile()).toContain("COPY package*.json ./");
  });
});

describe("generateSlimServerDockerfile", () => {
  it("runs src/index.ts on plain node without a browser", () => {
    const dockerfile = generateSlimServerDockerfile();
    expect(dockerfile).toContain("FROM node:lts-alpine");
    expect(dockerfile).not.toContain("playwright");
    expect(dockerfile).toContain('"src/index.ts"');
  });
});

describe("generateWorkerDockerfile", () => {
  it("runs src/worker.ts on the Playwright base", () => {
    const dockerfile = generateWorkerDockerfile();
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
    expect(dockerfile).toContain('CMD ["node", "--experimental-transform-types", "src/worker.ts"]');
    expect(dockerfile).not.toContain("EXPOSE");
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

describe("generateWorkerComposeSnippet", () => {
  it("contains worker service with queue env", () => {
    const snippet = generateWorkerComposeSnippet();
    expect(snippet).toContain("worker:");
    expect(snippet).toContain("QUEUE_URL");
    expect(snippet).toContain("WORKER_CONCURRENCY");
  });
});

describe("generateComposeYamlWithWorker", () => {
  it("combines base compose with worker snippet", () => {
    const yaml = generateComposeYamlWithWorker("sqlite");
    expect(yaml).toContain("storyshelf:");
    expect(yaml).toContain("worker:");
  });

  it("preserves postgres service when with worker", () => {
    const yaml = generateComposeYamlWithWorker("postgres");
    expect(yaml).toContain("postgres:");
    expect(yaml).toContain("worker:");
  });

  it("declares the worker as a service, before the top-level volumes block", () => {
    const yaml = generateComposeYamlWithWorker("postgres");
    expect(yaml.indexOf("  worker:")).toBeGreaterThan(yaml.indexOf("  postgres:"));
    expect(yaml.indexOf("  worker:")).toBeLessThan(yaml.indexOf("\nvolumes:"));
    expect(yaml.indexOf("\nvolumes:")).toBe(yaml.lastIndexOf("\nvolumes:"));
  });

  it("gives the worker its database and waits for postgres", () => {
    const worker = generateWorkerComposeSnippet("postgres");
    expect(worker).toContain("DATABASE_URL=postgres://");
    expect(worker).toContain("postgres:\n        condition: service_healthy");
    expect(generateWorkerComposeSnippet("sqlite")).not.toContain("DATABASE_URL");
  });
});
