import { CaptureAttemptModel } from "@storyshelf/core/models";
import { CaptureLogModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const project: Project = {
  id: "p1",
  name: "Test Project",
  slug: "test-project",
  gitRepository: null,
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const build: Build = {
  id: "b1",
  projectId: "p1",
  gitSha: "sha-1",
  gitBranch: "main",
  isDefault: true,
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status: "failed",
  snapshotCount: 0,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function attemptTables(db: ReturnType<typeof makeDatabase>["db"]) {
  return { captureAttempts: db.tables.captureAttempts };
}

function logTables(db: ReturnType<typeof makeDatabase>["db"]) {
  return { captureLogs: db.tables.captureLogs };
}

async function setupSeeded() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, build);
  const attempts = new CaptureAttemptModel(db, attemptTables(db));
  const logs = new CaptureLogModel(db, logTables(db));
  const first = await attempts.startAttempt("p1", "b1", "req-1");
  await logs.append("p1", "b1", first.id, "info", "storybook extracted", { durationMs: 3 });
  await logs.append("p1", "b1", first.id, "error", "capture failed");
  await attempts.markFinished(first.id, "failed", "renderer exploded");
  const second = await attempts.startAttempt("p1", "b1", "req-2");
  await attempts.markRunning(second.id);
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  return { db, app };
}

describe("capture attempts API", () => {
  it("lists attempts oldest first", async () => {
    const { app } = await setupSeeded();
    const response = await app.request("/api/v1/projects/test-project/builds/b1/attempts");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { attemptNo: number; status: string }[];
    expect(body.map((row) => row.attemptNo)).toEqual([1, 2]);
    expect(body.map((row) => row.status)).toEqual(["failed", "running"]);
  });

  it("fetches a single attempt with its error", async () => {
    const { app } = await setupSeeded();
    const response = await app.request("/api/v1/projects/test-project/builds/b1/attempts/1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { error: string; reqId: string };
    expect(body.error).toBe("renderer exploded");
    expect(body.reqId).toBe("req-1");
  });

  it("lists every log line of an attempt in order", async () => {
    const { app } = await setupSeeded();
    const response = await app.request("/api/v1/projects/test-project/builds/b1/attempts/1/logs");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { seq: number; message: string }[];
    expect(body.map((row) => row.seq)).toEqual([1, 2]);
    expect(body.map((row) => row.message)).toEqual(["storybook extracted", "capture failed"]);
  });

  it("returns 404 for unknown attempts and builds", async () => {
    const { app } = await setupSeeded();
    const missing = await app.request("/api/v1/projects/test-project/builds/b1/attempts/9");
    expect(missing.status).toBe(404);
    const missingBuild = await app.request("/api/v1/projects/test-project/builds/nope/attempts");
    expect(missingBuild.status).toBe(404);
  });
});

describe("retry re-queues capture", () => {
  it("resets to pending and enqueues the build", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, project);
    await db.insert(db.tables.builds, { ...build, status: "failed" });
    const enqueue = vi.fn(async () => {});
    const queue = {
      metadata: {
        name: "mock",
        version: "0.0.0",
        kind: "mock",
        category: "capture-queue" as const,
      },
      enqueue,
      status: vi.fn(async () => null),
      active: vi.fn(async () => []),
      recent: vi.fn(async () => []),
    } as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue;
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      captureQueue: queue,
    });

    const response = await app.request("/api/v1/projects/test-project/builds/b1/retry", {
      method: "POST",
    });

    expect(response.status).toBe(202);
    const body = (await response.json()) as Build;
    expect(body.status).toBe("pending");
    expect(enqueue).toHaveBeenCalledWith({ buildId: "b1", reqId: expect.any(String) });
  });
});
