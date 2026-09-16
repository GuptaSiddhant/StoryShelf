import { describe, expect, it } from "vitest";
import {
  generateComposeYaml,
  generateComposeYamlWithWorker,
  generateDockerfile,
  generateDockerignore,
  generateWorkerDockerfile,
  generateWorkerComposeSnippet,
} from "./docker.ts";

describe("generateDockerfile", () => {
  it("includes node builder and playwright stages", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("FROM node:lts-alpine AS builder");
    expect(dockerfile).toContain("FROM mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("server.ts");
  });
});

describe("generateWorkerDockerfile", () => {
  it("builds worker.ts and uses playwright base", () => {
    const dockerfile = generateWorkerDockerfile();
    expect(dockerfile).toContain("worker.ts");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("dist/worker.mjs");
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

  it("adds turso env for non-postgres", () => {
    const yaml = generateComposeYaml("turso");
    expect(yaml).toContain("TURSO_DATABASE_URL");
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
});
