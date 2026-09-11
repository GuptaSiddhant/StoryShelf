import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpRoot: string;
let dir: string;

vi.mock("prompts", () => ({
  default: vi.fn(),
}));

import prompts from "prompts";
import { runServerInit } from "./init.ts";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-server-init-"));
  dir = join(tmpRoot, "my-server");
  vi.mocked(prompts).mockReset();
  vi.stubGlobal("__PKG_VERSION__", "0.3.2");
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("runServerInit", () => {
  it("scaffolds server.ts with in-memory queue", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "server.ts"))).toBe(true);
    const code = readFileSync(join(dir, "server.ts"), "utf8");
    expect(code).toContain("createShelfApp");
    expect(code).toContain("createPlaywrightCaptureRunner");
    expect(code).not.toContain("createSqsCaptureQueue");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/runner-playwright"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/queue-sqs"]).toBeUndefined();
  });

  it("scaffolds server with SQS queue and colocated worker", async () => {
    // First prompts call returns main answers with queue=sqs, second returns includeWorker=true
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        database: "turso",
        storage: "s3",
        auth: "none",
        git: "none",
        queue: "sqs",
        docker: false,
      })
      .mockResolvedValueOnce({ includeWorker: true });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "server.ts"))).toBe(true);
    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
    const serverCode = readFileSync(join(dir, "server.ts"), "utf8");
    expect(serverCode).toContain("createSqsCaptureQueue");
    expect(serverCode).not.toContain("createPlaywrightCaptureRunner");
    const workerCode = readFileSync(join(dir, "worker.ts"), "utf8");
    expect(workerCode).toContain("createCaptureWorker");
    expect(workerCode).toContain("createPlaywrightCaptureRunner");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/queue-sqs"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/worker"]).toBeDefined();
    expect(pkg.scripts["worker"]).toBeDefined();
  });

  it("scaffolds SQS server without worker when declined", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        database: "sqlite",
        storage: "local",
        auth: "none",
        git: "none",
        queue: "sqs",
        docker: false,
      })
      .mockResolvedValueOnce({ includeWorker: false });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "server.ts"))).toBe(true);
    expect(existsSync(join(dir, "worker.ts"))).toBe(false);
  });

  it("generates slim Dockerfile and worker compose when with worker and docker", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        database: "postgres",
        storage: "local",
        auth: "none",
        git: "none",
        queue: "sqs",
        docker: true,
      })
      .mockResolvedValueOnce({ includeWorker: true });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(dir, "Dockerfile.worker"))).toBe(true);
    expect(existsSync(join(dir, "compose.yaml"))).toBe(true);
    const compose = readFileSync(join(dir, "compose.yaml"), "utf8");
    expect(compose).toContain("worker:");
    expect(compose).toContain("postgres:");
    const dockerfile = readFileSync(join(dir, "Dockerfile.worker"), "utf8");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
  });

  it("cancels when name missing", async () => {
    vi.mocked(prompts).mockResolvedValue({});
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("defaults queue to memory when not answered", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      // queue intentionally omitted
      docker: false,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    const code = readFileSync(join(dir, "server.ts"), "utf8");
    expect(code).toContain("captureRunner");
  });
});
