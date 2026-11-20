import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { BuildModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { requestBuildState } from "../git-status.ts";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

vi.mock("../git-status.ts", async (original) => {
  const real = await original<typeof import("../git-status.ts")>();
  return { ...real, requestBuildState: vi.fn(real.requestBuildState) };
});

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

type Status = "pending" | "capturing" | "comparing" | "reviewing" | "approved" | "failed";

/** A build on `branch` in `status`, created at a distinct time so "newest" is unambiguous. */
async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "web" });
  const builds = new BuildModel(db);
  let tick = 0;
  const add = async (branch: string, status: Status): Promise<string> => {
    const build = await createTestBuild(db, db.tables, project.id, {
      gitBranch: branch,
      gitSha: `sha-${(tick += 1)}`,
    });
    await db.update(db.tables.builds, build.id, {
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString(),
    });
    if (status === "comparing") await builds.setStatus(build.id, "capturing");
    if (status === "reviewing") await builds.setStatus(build.id, "capturing");
    if (status === "approved") {
      await builds.setStatus(build.id, "capturing");
      await builds.setStatus(build.id, "reviewing");
    }
    if (status !== "pending") await builds.setStatus(build.id, status as never);
    return build.id;
  };
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s", publicBaseUrl: "https://shelf.example" },
    testing: { runner: stubRunner() },
  });
  return { app, db, add, builds };
}

const post = async (app: ReturnType<typeof createShelfApp>, body?: unknown) =>
  await app.request("/api/v1/projects/web/builds/cancel", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

describe("POST /builds/cancel", () => {
  it("keeps the newest unfinished build of each branch and cancels the rest", async () => {
    const { app, add, builds } = await seed();
    const oldMain = await add("main", "pending");
    const midMain = await add("main", "capturing");
    const oldFeat = await add("feat", "comparing");
    const newMain = await add("main", "pending");
    const newFeat = await add("feat", "pending");
    const response = await post(app);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { cancelled: string[]; count: number };
    expect(body.count).toBe(3);
    expect(new Set(body.cancelled)).toEqual(new Set([oldMain, midMain, oldFeat]));
    expect((await builds.get(newMain))?.status).toBe("pending");
    expect((await builds.get(newFeat))?.status).toBe("pending");
    expect((await builds.get(oldMain))?.status).toBe("cancelled");
  });

  it("leaves finished builds alone", async () => {
    const { app, add, builds } = await seed();
    const reviewing = await add("main", "reviewing");
    const failed = await add("main", "failed");
    await add("main", "pending");
    const older = await add("main", "pending");
    const first = await add("main", "pending");
    const body = (await (await post(app, { keepNewest: 0 })).json()) as { cancelled: string[] };
    expect(new Set(body.cancelled)).toEqual(new Set([older, first, body.cancelled[2]!]));
    expect((await builds.get(reviewing))?.status).toBe("reviewing");
    expect((await builds.get(failed))?.status).toBe("failed");
  });

  it("limits the cancel to one branch and honours keepNewest", async () => {
    const { app, add, builds } = await seed();
    const a = await add("main", "pending");
    await add("main", "pending");
    await add("main", "pending");
    const other = await add("feat", "pending");
    const body = (await (await post(app, { branch: "main", keepNewest: 2 })).json()) as {
      cancelled: string[];
    };
    expect(body.cancelled).toEqual([a]);
    expect((await builds.get(other))?.status).toBe("pending");
  });

  it("changes nothing on a dry run", async () => {
    const { app, add, builds } = await seed();
    const old = await add("main", "pending");
    await add("main", "pending");
    const body = await (await post(app, { dryRun: true })).json();
    expect(body).toEqual({ cancelled: [old], count: 1, dryRun: true });
    expect((await builds.get(old))?.status).toBe("pending");
  });

  it("ends the queued jobs of every kind and asks for each build's git state", async () => {
    const { app, db, add } = await seed();
    const old = await add("main", "pending");
    await add("main", "pending");
    const queue = createDatabaseCaptureQueue(db, { kinds: ["capture", "publish"] });
    await queue.enqueueJob({ kind: "capture", buildId: old });
    await queue.enqueueJob({ kind: "publish", buildId: old } as never);
    vi.mocked(requestBuildState).mockClear();
    expect((await post(app)).status).toBe(200);
    const rows = (await db.list(db.tables.captureJobs)).filter((row) => row["buildId"] === old);
    expect(rows.map((row) => row["status"])).toEqual(["cancelled", "cancelled"]);
    expect(vi.mocked(requestBuildState)).toHaveBeenCalledWith(old);
  });

  it("answers 404 when testing is off", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await createTestProject(db, db.tables, { name: "web" });
    const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
    expect((await post(app)).status).toBe(404);
  });
});

const form = async (app: ReturnType<typeof createShelfApp>, headers: Record<string, string> = {}) =>
  await app.request("/projects/web/builds/cancel", {
    method: "POST",
    headers: {
      cookie: "storyshelf_session=nobody",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": getCsrfToken("s", "nobody"),
      ...headers,
    },
  });

describe("POST /projects/:slug/builds/cancel (the builds page form)", () => {
  it("cancels like the API route and sends a plain browser form back to the builds list", async () => {
    const { app, add, builds } = await seed();
    const old = await add("main", "pending");
    const newest = await add("main", "pending");
    const response = await form(app);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/projects/web/builds");
    expect((await builds.get(old))?.status).toBe("cancelled");
    expect((await builds.get(newest))?.status).toBe("pending");
  });

  it("answers an HTMX post with a refresh", async () => {
    const { app, add } = await seed();
    await add("main", "pending");
    await add("main", "pending");
    const response = await form(app, { "hx-request": "true" });
    expect(response.status).toBe(204);
    expect(response.headers.get("hx-refresh")).toBe("true");
  });

  it("refuses a post without a CSRF token and cancels nothing", async () => {
    const { app, add, builds } = await seed();
    const old = await add("main", "pending");
    await add("main", "pending");
    const response = await app.request("/projects/web/builds/cancel", {
      method: "POST",
      headers: { cookie: "storyshelf_session=nobody", "sec-fetch-site": "same-origin" },
    });
    expect(response.status).toBe(403);
    expect((await builds.get(old))?.status).toBe("pending");
  });

  it("answers 404 when testing is off", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await createTestProject(db, db.tables, { name: "web" });
    const app = createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      config: { secret: "s" },
    });
    expect((await form(app)).status).toBe(404);
  });
});
