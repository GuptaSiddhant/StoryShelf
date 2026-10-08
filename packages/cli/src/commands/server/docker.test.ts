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
  it("includes node builder and playwright stages", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("FROM node:lts-alpine AS builder");
    expect(dockerfile).toContain("FROM mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("COPY src/ ./src/");
    expect(dockerfile).toContain("esbuild src/index.ts");
  });

  it("starts the bundle at the path it was copied to", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("COPY --from=builder /app/dist/server.mjs ./");
    expect(dockerfile).toContain('CMD ["node", "server.mjs"]');
  });

  it("externalizes and ships playwright-core on a pinned image", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("--external:playwright-core");
    expect(dockerfile).toContain("node_modules/playwright-core");
    expect(dockerfile).not.toContain("playwright:latest");
    const image = /FROM (?<image>mcr\S+)/u.exec(generateWorkerDockerfile())?.groups?.["image"];
    expect(image).toBeDefined();
    expect(dockerfile).toContain(`FROM ${image}`);
  });

  it("never needs an interactive npx prompt", () => {
    expect(generateDockerfile()).toContain("npx -y esbuild");
    expect(generateSlimServerDockerfile()).toContain("npx -y esbuild");
    expect(generateWorkerDockerfile()).toContain("npx -y esbuild");
  });
});

describe("generateSlimServerDockerfile", () => {
  it("bundles src/index.ts without a browser", () => {
    const dockerfile = generateSlimServerDockerfile();
    expect(dockerfile).toContain("esbuild src/index.ts");
    expect(dockerfile).not.toContain("playwright");
    expect(dockerfile).toContain('CMD ["node", "dist/server.mjs"]');
  });
});

describe("generateWorkerDockerfile", () => {
  it("builds src/worker.ts and uses playwright base", () => {
    const dockerfile = generateWorkerDockerfile();
    expect(dockerfile).toContain("esbuild src/worker.ts");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("COPY --from=builder /app/dist/worker.mjs ./");
    expect(dockerfile).toContain('CMD ["node", "worker.mjs"]');
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
