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
import { setupPublishing } from "./publish-setup.ts";

const logger = pino({ level: "silent" });

function options(): ShelfOptions {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return { database: db, storage } as unknown as ShelfOptions;
}

describe("setupPublishing", () => {
  it("wires a completer and a publish consumer on a long-running host", () => {
    const wiring = setupPublishing(options(), {}, logger, false, {});
    expect(wiring.enqueuePublish).toBeTypeOf("function");
    expect(wiring.consumer?.isRunning()).toBe(false);
    expect(wiring.afterPublish).toHaveLength(1);
  });

  it("wires no consumer and no job queue on a serverless host", () => {
    const wiring = setupPublishing(options(), {}, logger, false, { VERCEL: "1" });
    expect(wiring.enqueuePublish).toBeUndefined();
    expect(wiring.consumer).toBeNull();
  });

  it("starts and drains its consumer, and a never-started one stops quietly", async () => {
    const wiring = setupPublishing(options(), {}, logger, false, {});
    await wiring.consumer?.stop();
    const started = wiring.consumer?.start();
    await Promise.resolve();
    await wiring.consumer?.stop();
    await started;
    expect(wiring.consumer?.isRunning()).toBe(false);
  });

  it.each([
    ["a long-running host", {}],
    ["a serverless host", { VERCEL: "1" }],
  ])("catalogues a build when its publishing completes, on %s", async (_name, env) => {
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
    const wiring = setupPublishing(opts, {}, logger, false, env);
    await wiring.completer.complete(build.id, { ok: true });
    const rows = await new BuildComponentModel(opts.database).listByBuild(build.id);
    expect(rows.map((row) => row.title)).toEqual(["A"]);
    expect((await wiring.catalog.load(project.id, build.id))?.entries).toHaveLength(1);
  });
});
