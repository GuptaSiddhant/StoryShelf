import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { BuildModel, CaptureAttemptModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

vi.mock("../job-queue.ts", async (original) => {
  const real = await original<typeof import("../job-queue.ts")>();
  return {
    ...real,
    // Enqueue and cancel as usual, but hand no job out: no consumer races the assertions.
    createJobQueue: (...args: Parameters<typeof real.createJobQueue>) => {
      const queue = real.createJobQueue(...args);
      return {
        ...queue,
        get: () => ({
          ...queue.get(),
          poll: async () => await new Promise<null>((resolve) => setTimeout(resolve, 100, null)),
        }),
      };
    },
  };
});

/** Status of the build's capture jobs on the database queue. */
async function jobStatuses(db: DatabaseAdapter, buildId: string): Promise<string[]> {
  const rows = await db.list(db.tables.captureJobs);
  return rows.filter((row) => row["buildId"] === buildId).map((row) => String(row["status"]));
}

async function seed(status: string, testing = true) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "app" });
  const created = await createTestBuild(db, db.tables, project.id);
  await new BuildModel(db).setStatus(created.id, status as never);
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
  });
  const url = `/api/v1/projects/app/builds/${created.id}/cancel`;
  await createDatabaseCaptureQueue(db, { kinds: ["capture"] }).enqueueJob({
    kind: "capture",
    buildId: created.id,
  });
  return { app, db, build: created, url };
}

describe("POST /builds/:buildId/cancel", () => {
  it("cancels the build's jobs, closes its attempts and fails the build", async () => {
    const { app, db, build, url } = await seed("capturing");
    const attempts = new CaptureAttemptModel(db);
    const attempt = await attempts.startAttempt(build.projectId, build.id);
    const response = await app.request(url, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: build.id, status: "failed" });
    expect(await jobStatuses(db, build.id)).toEqual(["cancelled"]);
    expect((await new BuildModel(db).get(build.id))?.status).toBe("failed");
    expect((await attempts.listByBuild(build.id)).find((a) => a.id === attempt.id)).toMatchObject({
      status: "cancelled",
    });
  });

  it.each(["pending", "comparing"])("cancels a %s build too", async (status) => {
    const { app, url } = await seed(status);
    expect((await app.request(url, { method: "POST" })).status).toBe(200);
  });

  it.each(["reviewing", "approved", "rejected", "failed"])(
    "answers 409 for a %s build, and leaves it and its jobs alone",
    async (status) => {
      const { app, db, build, url } = await seed(status);
      const response = await app.request(url, { method: "POST" });
      expect(response.status).toBe(409);
      expect(await jobStatuses(db, build.id)).toEqual(["queued"]);
      expect((await new BuildModel(db).get(build.id))?.status).toBe(status);
    },
  );

  it("answers 404 for an unknown build and without testing (class testing)", async () => {
    const { app } = await seed("capturing");
    const missing = await app.request("/api/v1/projects/app/builds/nope/cancel", {
      method: "POST",
    });
    expect(missing.status).toBe(404);
    const hosting = await seed("capturing", false);
    expect((await hosting.app.request(hosting.url, { method: "POST" })).status).toBe(404);
  });
});
