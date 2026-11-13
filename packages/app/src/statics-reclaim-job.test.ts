import { SiteSettingsModel } from "@storyshelf/core/models";
import { RECLAIM_COPIES_KEY } from "@storyshelf/core/retention";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import type { JobQueue } from "./job-queue.ts";
import { setupStaticsReclaim } from "./statics-reclaim-job.ts";

const A = "a".repeat(64);
const logger = { info: vi.fn(), warn: vi.fn() } as never;

function queue(kinds: JobQueue["kinds"]) {
  const enqueueJob = vi.fn(async () => await Promise.resolve("job"));
  const jobs = { kinds, get: () => ({ enqueueJob }) } as unknown as JobQueue;
  return { jobs, enqueueJob };
}

describe("statics-reclaim job", () => {
  it("has no job side on a host that does not poll the kind", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const wiring = setupStaticsReclaim({ db, storage, logger }, queue(["capture"]).jobs);
    expect(wiring).toEqual({ enqueue: undefined, handler: null });
  });

  it("queues one single-flight job until the sweep is done", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const q = queue(["statics-reclaim"]);
    const wiring = setupStaticsReclaim({ db, storage, logger }, q.jobs);
    await wiring.enqueue?.();
    expect(q.enqueueJob).toHaveBeenCalledWith({
      kind: "statics-reclaim",
      activeKey: "statics-reclaim",
    });
    await new SiteSettingsModel(db).set(RECLAIM_COPIES_KEY, '{"done":true}');
    await wiring.enqueue?.();
    expect(q.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("runs pages until done, keeping the lease alive", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "x",
      gitBranch: "main",
      status: "approved",
      retentionState: "available",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    objects.set("p1/builds/b1/storybook/manifest.json", Buffer.from(JSON.stringify({ "a.js": A })));
    objects.set("p1/builds/b1/storybook/a.js", Buffer.from("a"));
    objects.set(`content/${A}`, Buffer.from("a"));
    const wiring = setupStaticsReclaim({ db, storage, logger }, queue(["statics-reclaim"]).jobs);
    const touch = vi.fn();
    await wiring.handler?.run({} as never, {
      logger,
      touch,
      signal: new AbortController().signal,
    });
    expect(objects.has("p1/builds/b1/storybook/a.js")).toBe(false);
    expect(touch).toHaveBeenCalled();
  });

  it("stops when the job is aborted", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "x",
      gitBranch: "main",
      status: "approved",
      retentionState: "available",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const wiring = setupStaticsReclaim({ db, storage, logger }, queue(["statics-reclaim"]).jobs);
    const controller = new AbortController();
    controller.abort();
    await wiring.handler?.run({} as never, { logger, touch: vi.fn(), signal: controller.signal });
    expect(await new SiteSettingsModel(db).get(RECLAIM_COPIES_KEY)).toBeNull();
  });
});
