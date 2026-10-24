/**
 * Two app instances on one database (ADR 0006, decision 4): booting the second must not reset the
 * first one's builds, and a job whose holder died is finished by another instance once its lease
 * expired.
 */
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, CaptureJobModel } from "@storyshelf/core/models";
import {
  createManualClock,
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
  type ManualClock,
} from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "./index.tsx";
import { stubRunner } from "./test-runner.ts";

const logger = createShelfLogger({ level: "silent" });

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables);
  const build = await createTestBuild(db, db.tables, project.id);
  await new BuildModel(db).setStatus(build.id, "capturing");
  return { db, storage, build };
}

function instance(db: ReturnType<typeof makeDatabase>["db"], storage: never, clock?: ManualClock) {
  return createShelfApp({
    database: db,
    storage,
    logger,
    testing: {
      runner: stubRunner(),
      ...(clock === undefined ? {} : { queueClock: { now: clock.now, timers: clock.timers } }),
    },
  });
}

const until = async (check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  // oxlint-disable-next-line eslint/no-await-in-loop -- polling loop
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error("condition not reached in time");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling loop
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("two instances on one database", () => {
  it("starting a second instance leaves the first one's capturing build alone", async () => {
    const { db, storage, build } = await seed();
    // Instance A holds the job with a live lease.
    const holder = createDatabaseCaptureQueue(db, { owner: "instance-a" });
    await holder.enqueue({ buildId: build.id });
    const claimed = await holder.poll();
    expect(claimed?.attempt).toBe(1);

    const first = instance(db, storage as never);
    const second = instance(db, storage as never);
    await first.lifecycle.setup();
    await second.lifecycle.setup();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect((await new BuildModel(db).get(build.id))?.status).toBe("capturing");
    const jobs = new CaptureJobModel(db);
    expect(await jobs.get(`${claimed?.jobId}:2`)).toBeNull();
    expect(await jobs.get(`${claimed?.jobId}:1`)).toMatchObject({
      owner: "instance-a",
      status: "running",
    });
    await first.lifecycle.teardown();
    await second.lifecycle.teardown();
    holder.lifecycle.teardown().catch(() => {});
  });

  it("another instance claims the job of a holder that died, after its lease expired", async () => {
    const { db, storage, build } = await seed();
    const clock = createManualClock();
    const dying = createDatabaseCaptureQueue(db, {
      owner: "dead-instance",
      leaseMs: 5,
      now: clock.now,
      timers: clock.timers,
    });
    await dying.enqueue({ buildId: build.id });
    const claimed = await dying.poll();
    expect(claimed?.attempt).toBe(1);

    const survivor = instance(db, storage as never, clock);
    await survivor.lifecycle.setup();
    await until(async () => clock.pending > 0);
    await clock.advance(20_000);
    const jobs = new CaptureJobModel(db);
    await until(async () => (await jobs.get(`${claimed?.jobId}:2`)) !== null);
    expect(await jobs.get(`${claimed?.jobId}:1`)).toMatchObject({ status: "expired" });
    expect(await jobs.get(`${claimed?.jobId}:2`)).toMatchObject({ owner: expect.any(String) });
    await survivor.lifecycle.teardown();
  });

  it("fails the build of a job whose last attempt lost its lease", async () => {
    const { db, storage, build } = await seed();
    const clock = createManualClock();
    const dying = createDatabaseCaptureQueue(db, {
      owner: "dead-instance",
      leaseMs: 5,
      retries: 0,
      now: clock.now,
      timers: clock.timers,
    });
    await dying.enqueue({ buildId: build.id });
    expect(await dying.poll()).not.toBeNull();

    const survivor = instance(db, storage as never, clock);
    await survivor.lifecycle.setup();
    await until(async () => clock.pending > 0);
    await clock.advance(20_000);
    await until(async () => (await new BuildModel(db).get(build.id))?.status === "failed");
    await survivor.lifecycle.teardown();
  });
});
