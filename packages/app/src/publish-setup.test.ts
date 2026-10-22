import type { ShelfOptions } from "@storyshelf/core/config";
import { BuildComponentModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createJobQueue } from "./job-queue.ts";
import { setupPublishing } from "./publish-setup.ts";

const logger = pino({ level: "silent" });

function options(): ShelfOptions {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return { database: db, storage } as unknown as ShelfOptions;
}

function jobsFor(opts: ShelfOptions, serverless: boolean) {
  return createJobQueue(opts, serverless ? [] : ["publish"], 2);
}

describe("setupPublishing", () => {
  it("wires a completer, a job enqueuer and a handler on a long-running host", () => {
    const opts = options();
    const wiring = setupPublishing(opts, {}, logger, false, jobsFor(opts, false));
    expect(wiring.enqueuePublish).toBeTypeOf("function");
    expect(wiring.handler?.run).toBeTypeOf("function");
    expect(wiring.afterPublish).toHaveLength(1);
  });

  it("wires no job side on a host that polls no publish jobs (serverless)", () => {
    const opts = options();
    const wiring = setupPublishing(opts, {}, logger, false, jobsFor(opts, true));
    expect(wiring.enqueuePublish).toBeUndefined();
    expect(wiring.handler).toBeNull();
  });

  it("queues a publish job on the shared database queue", async () => {
    const opts = options();
    const jobs = jobsFor(opts, false);
    const wiring = setupPublishing(opts, {}, logger, false, jobs);
    await wiring.enqueuePublish?.("b1", "req-1");
    expect(await jobs.view.active()).toEqual([expect.objectContaining({ buildId: "b1" })]);
    expect(await jobs.get().poll()).toMatchObject({ kind: "publish", buildId: "b1" });
  });

  it("fails the build of a publish job whose last attempt lost its lease", async () => {
    const opts = options();
    const project = await createTestProject(opts.database, opts.database.tables);
    const build = await createTestBuild(opts.database, opts.database.tables, project.id);
    const jobs = jobsFor(opts, false);
    setupPublishing(opts, {}, logger, false, jobs);
    await jobs.exhausted.publish?.(
      { buildId: build.id, kind: "publish" } as never,
      "lease expired on the final attempt",
    );
    expect((await opts.database.get(opts.database.tables.builds, build.id))?.["status"]).toBe(
      "failed",
    );
  });

  it.each([
    ["a long-running host", false],
    ["a serverless host", true],
  ])("catalogues a build when its publishing completes, on %s", async (_name, serverless) => {
    const opts = options();
    const project = await createTestProject(opts.database, opts.database.tables);
    const build = await createTestBuild(opts.database, opts.database.tables, project.id);
    const index = {
      entries: { "a--x": { id: "a--x", title: "A", name: "X", importPath: "./A.tsx" } },
    };
    await opts.storage.write(
      `${storybookDir(project.id, build.id)}/index.json`,
      Buffer.from(JSON.stringify(index)),
    );
    const wiring = setupPublishing(opts, {}, logger, false, jobsFor(opts, serverless));
    await wiring.completer.complete(build.id, { ok: true });
    const rows = await new BuildComponentModel(opts.database).listByBuild(build.id);
    expect(rows.map((row) => row.title)).toEqual(["A"]);
    expect((await wiring.catalog.load(project.id, build.id))?.entries).toHaveLength(1);
  });
});
