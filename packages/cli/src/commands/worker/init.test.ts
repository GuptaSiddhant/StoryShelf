import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let tmpRoot: string;

vi.mock("prompts", () => ({
  default: vi.fn(),
}));

import prompts from "prompts";
import { runWorkerInit } from "./init.ts";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-worker-init-"));
  dir = join(tmpRoot, "my-worker");
  vi.mocked(prompts).mockReset();
  vi.stubGlobal("__PKG_VERSION__", "0.3.2");
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("runWorkerInit", () => {
  it("scaffolds worker.ts and package.json for sqs", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-worker",
      dir: "./my-worker",
      database: "sqlite",
      storage: "local",
      queue: "sqs",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runWorkerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
    expect(existsSync(join(dir, "package.json"))).toBe(true);
    const workerCode = readFileSync(join(dir, "worker.ts"), "utf8");
    expect(workerCode).toContain("createSqsCaptureQueue");
    expect(workerCode).toContain("createCaptureWorker");
    expect(workerCode).toContain("createSqliteDatabase");
    expect(workerCode).toContain("createLocalStorage");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/queue-sqs"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/worker"]).toBeDefined();
  });

  it("generates Dockerfile when docker true", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-worker",
      dir: "./my-worker",
      database: "turso",
      storage: "s3",
      queue: "sqs",
      docker: true,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runWorkerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(dir, ".dockerignore"))).toBe(true);
    const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
  });

  it("handles memory queue", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-worker",
      dir: "./my-worker",
      database: "sqlite",
      storage: "local",
      queue: "memory",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runWorkerInit({});
    } finally {
      process.chdir(cwd);
    }

    const workerCode = readFileSync(join(dir, "worker.ts"), "utf8");
    // memory queue placeholder comment
    expect(workerCode).toContain("remote queue");
  });

  it("cancels when name/dir missing", async () => {
    vi.mocked(prompts).mockResolvedValue({});
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runWorkerInit({});
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("autofills from installed package.json", async () => {
    // Pre-create a package.json in tmpRoot with turso/s3 to test autofill doesn't break
    writeFileSync(
      join(tmpRoot, "package.json"),
      JSON.stringify({
        dependencies: { "@storyshelf/db-turso": "0.3.2", "@storyshelf/storage-s3": "0.3.2" },
      }),
    );
    vi.mocked(prompts).mockImplementation(async (questions: unknown) => {
      // Verify that initial values were set from deps (prompts called with initial indices)
      const qs = questions as unknown as { name: string; initial?: number }[];
      const dbPrompt = qs.find((q) => q.name === "database");
      const storagePrompt = qs.find((q) => q.name === "storage");
      // turso is index 1, s3 is index 1
      expect(dbPrompt?.initial).toBe(1);
      expect(storagePrompt?.initial).toBe(1);
      return {
        name: "my-worker",
        dir: "./my-worker",
        database: "turso",
        storage: "s3",
        queue: "sqs",
        docker: false,
      };
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runWorkerInit({});
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
    const code = readFileSync(join(dir, "worker.ts"), "utf8");
    expect(code).toContain("createTursoDatabase");
    expect(code).toContain("createS3Storage");
  });
});

describe("runWorkerInit helpers", () => {
  it("resolves package.json path correctly", async () => {
    // Ensure runWorkerInit handles resolve correctly
    vi.mocked(prompts).mockResolvedValue({
      name: "test-worker",
      dir: resolve(tmpRoot, "my-worker"),
      database: "postgres",
      storage: "local",
      queue: "sqs",
      docker: false,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runWorkerInit({});
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(resolve(tmpRoot, "my-worker", "worker.ts"))).toBe(true);
  });
});
