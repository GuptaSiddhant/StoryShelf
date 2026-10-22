import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
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
import { z } from "zod";
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

/** A message notifier that records the subject of everything it is asked to send. */
function recordingNotifier(sent: string[]): NotifierProvider {
  const metadata = {
    name: "log",
    version: "0.0.0",
    kind: "log",
    category: "notifier" as const,
    schema: z.object({}).loose(),
  };
  return {
    metadata,
    create: () => ({
      metadata,
      // oxlint-disable-next-line eslint/require-await -- send is async by contract
      send: async (input: unknown) => {
        sent.push((input as { formatted: { subject: string } }).formatted.subject);
      },
    }),
  };
}

async function seed(status: string, testing = true, sent: string[] = []) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "app" });
  const created = await createTestBuild(db, db.tables, project.id);
  await new BuildModel(db).setStatus(created.id, status as never);
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s", publicBaseUrl: "https://shelf.example" },
    notifications: { notifiers: [recordingNotifier(sent)] },
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
  it("cancels the build's jobs, closes its attempts and ends the build cancelled", async () => {
    const { app, db, build, url } = await seed("capturing");
    const attempts = new CaptureAttemptModel(db);
    const attempt = await attempts.startAttempt(build.projectId, build.id);
    const response = await app.request(url, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: build.id, status: "cancelled" });
    expect(await jobStatuses(db, build.id)).toEqual(["cancelled"]);
    expect((await new BuildModel(db).get(build.id))?.status).toBe("cancelled");
    expect((await attempts.listByBuild(build.id)).find((a) => a.id === attempt.id)).toMatchObject({
      status: "cancelled",
    });
  });

  it.each(["pending", "comparing"])("cancels a %s build too", async (status) => {
    const { app, url } = await seed(status);
    expect((await app.request(url, { method: "POST" })).status).toBe(200);
  });

  it.each(["reviewing", "approved", "rejected", "failed", "cancelled"])(
    "answers 409 for a %s build, and leaves it and its jobs alone",
    async (status) => {
      const { app, db, build, url } = await seed(status);
      const response = await app.request(url, { method: "POST" });
      expect(response.status).toBe(409);
      expect(await jobStatuses(db, build.id)).toEqual(["queued"]);
      expect((await new BuildModel(db).get(build.id))?.status).toBe(status);
    },
  );

  it("raises build:cancelled, never build:failed", async () => {
    const sent: string[] = [];
    const { app, url } = await seed("capturing", true, sent);
    const created = await app.request("/api/v1/projects/app/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "log", config: {} }),
    });
    expect(created.status).toBe(201);
    expect((await app.request(url, { method: "POST" })).status).toBe(200);
    await vi.waitFor(() => expect(sent.join("\n")).toContain("build:cancelled"));
    expect(sent.join("\n")).not.toContain("build:failed");
  });

  it("keeps the build cancelled when a capture ends late, and a retry resets it", async () => {
    const { app, db, build, url } = await seed("capturing");
    expect((await app.request(url, { method: "POST" })).status).toBe(200);
    const builds = new BuildModel(db);
    await builds.setStatus(build.id, "approved");
    await builds.setStatus(build.id, "failed");
    expect((await builds.get(build.id))?.status).toBe("cancelled");
    const retried = await app.request(`/api/v1/projects/app/builds/${build.id}/retry`, {
      method: "POST",
    });
    expect(retried.status).toBe(202);
    expect((await builds.get(build.id))?.status).toBe("pending");
  });

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
