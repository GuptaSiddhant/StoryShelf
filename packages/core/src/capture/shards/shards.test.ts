import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureRunner, RenderedSnapshot } from "../../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../../adapters/database.ts";
import { BuildModel } from "../../models/build.ts";
import { CaptureShardModel } from "../../models/capture-shard.ts";
import { ProjectModel } from "../../models/project.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/fake-adapters.ts";
import { storybookZipPath } from "../../utils/paths.ts";
import { executeCaptureJob, type CaptureJobOptions, type ShardJob } from "../orchestrator.ts";
import { executeCaptureShard, type ShardOutcome } from "./execute.ts";

function tables(db: DatabaseAdapter) {
  return {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    baselines: db.tables.baselines,
    projects: db.tables.projects,
    captureAttempts: db.tables.captureAttempts,
    captureLogs: db.tables.captureLogs,
  };
}

function zipOfStories(count: number): Buffer {
  const entries = Object.fromEntries(
    Array.from({ length: count }, (_unused, index) => {
      const id = `components-button--story-${String(index).padStart(2, "0")}`;
      return [
        id,
        {
          id,
          name: `Story ${index}`,
          title: "Components/Button",
          importPath: "./B.stories.tsx",
          type: "story",
        },
      ];
    }),
  );
  const zip = new AdmZip();
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries })));
  return zip.toBuffer();
}

const png = (tag: string): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);

interface Behaviour {
  /** Story ids the runner reports as failed to render. */
  failStories: Set<string>;
  /** Renders that throw outright, counted down. */
  throwTimes: number;
  rendered: string[];
}

function fakeRunner(behaviour: Behaviour): CaptureRunner {
  return {
    metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
    cancel: async () => {},
    render: async (input) => {
      await Promise.resolve();
      if (behaviour.throwTimes > 0) {
        behaviour.throwTimes -= 1;
        throw new Error("browser crashed");
      }
      const failures: { storyId: string; viewportName: string; error: string }[] = [];
      for (const story of input.stories) {
        behaviour.rendered.push(story.id);
        if (behaviour.failStories.has(story.id)) {
          failures.push({ storyId: story.id, viewportName: "desktop", error: "render failed" });
          continue;
        }
        const capture: RenderedSnapshot = {
          story,
          viewportName: "desktop",
          viewport: { name: "desktop", width: 1280, height: 720 },
          screenshot: png(story.id),
        };
        // oxlint-disable-next-line no-await-in-loop -- one capture at a time, like a page pool of 1
        await input.onCapture?.(capture);
      }
      return { captures: [], failures };
    },
  };
}

let scratchDir: string;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-shards-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function world(options: {
  stories: number;
  shardSize?: number | undefined;
  enqueue?: boolean;
}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db, tables(db)).create({ name: "Sharded" });
  const build = await new BuildModel(db, tables(db)).create(project.id, {
    gitSha: "sha-1",
    gitBranch: "main",
    isDefault: true,
  });
  await storage.write(storybookZipPath(project.id, build.id), zipOfStories(options.stories));
  const behaviour: Behaviour = { failStories: new Set(), throwTimes: 0, rendered: [] };
  const queued: ShardJob[] = [];
  const jobOptions: CaptureJobOptions = {
    db,
    tables: tables(db),
    storage,
    runner: fakeRunner(behaviour),
    scratchDir,
    shardSize: options.shardSize,
    ...(options.enqueue === false
      ? {}
      : {
          enqueue: async (job: ShardJob) => {
            queued.push(job);
            await Promise.resolve();
          },
        }),
  };
  const shards = new CaptureShardModel(db);
  const status = async () => (await new BuildModel(db, tables(db)).get(build.id))?.status;
  const snapshots = async () => await db.list(db.tables.snapshots);
  const runShard = async (job: ShardJob, final?: boolean): Promise<ShardOutcome> =>
    await executeCaptureShard({ buildId: job.buildId, shard: job.shard, final }, jobOptions);
  const plan = async () => await executeCaptureJob({ buildId: build.id }, jobOptions);
  return {
    db,
    build,
    project,
    behaviour,
    queued,
    jobOptions,
    shards,
    status,
    snapshots,
    runShard,
    plan,
  };
}

describe("sharded capture", () => {
  it("plans a big build into shards and leaves the build capturing", async () => {
    const w = await world({ stories: 25, shardSize: 10 });

    const summary = await w.plan();

    expect(summary).toMatchObject({ storyCount: 25, shards: 3 });
    expect(w.queued).toHaveLength(3);
    expect(await w.status()).toBe("capturing");
    expect(await w.snapshots()).toHaveLength(0);
    const rows = await w.shards.listForBuild(w.build.id);
    expect(rows.map((row) => [row.kind, row.ordinal, row.status])).toEqual([
      ["plan", 0, "done"],
      ["render", 1, "pending"],
      ["render", 2, "pending"],
      ["render", 3, "pending"],
    ]);
    expect(w.behaviour.rendered).toEqual([]); // the plan stage renders nothing
  });

  it("renders every shard once and the last one finalizes the build", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();

    const outcomes: ShardOutcome[] = [];
    for (const job of w.queued) {
      // oxlint-disable-next-line no-await-in-loop -- shards run one after another here
      outcomes.push(await w.runShard(job));
    }

    expect(outcomes.map((outcome) => outcome.status === "rendered" && outcome.finalized)).toEqual([
      false,
      false,
      true,
    ]);
    expect(await w.status()).toBe("approved");
    expect(await w.snapshots()).toHaveLength(25);
    expect(new Set(w.behaviour.rendered).size).toBe(25);
    expect(w.behaviour.rendered).toHaveLength(25);
    const last = outcomes.at(-1);
    expect(last?.status === "rendered" && last.finalized && last.summary).toMatchObject({
      storyCount: 25,
      failedCount: 0,
      buildStatus: "approved",
    });
  });

  it("finalizes exactly once when shards finish concurrently", async () => {
    const w = await world({ stories: 40, shardSize: 10 });
    await w.plan();

    const outcomes = await Promise.all(w.queued.map(async (job) => await w.runShard(job)));

    const finalizers = outcomes.filter(
      (outcome) => outcome.status === "rendered" && outcome.finalized,
    );
    expect(finalizers).toHaveLength(1);
    expect(await w.status()).toBe("approved");
    expect(await w.snapshots()).toHaveLength(40);
  });

  it("fails the build when a story fails to render in any shard", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    w.behaviour.failStories.add("components-button--story-12");
    await w.plan();

    const outcomes = await Promise.all(w.queued.map(async (job) => await w.runShard(job)));

    expect(await w.status()).toBe("failed");
    const summary = outcomes.flatMap((outcome) =>
      outcome.status === "rendered" && outcome.finalized ? [outcome.summary] : [],
    )[0];
    expect(summary).toMatchObject({ failedCount: 1, buildStatus: "failed" });
    expect(await w.snapshots()).toHaveLength(24);
  });

  it("a shard that fails for good fails the build and rethrows", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    await w.runShard(w.queued[0] as ShardJob);
    await w.runShard(w.queued[1] as ShardJob);
    w.behaviour.throwTimes = 1;

    await expect(w.runShard(w.queued[2] as ShardJob, true)).rejects.toThrow("browser crashed");

    expect(await w.status()).toBe("failed");
    const [, , , third] = await w.shards.listForBuild(w.build.id);
    expect(third).toMatchObject({ status: "failed", error: "browser crashed" });
  });

  it("a shard that will be retried keeps the build capturing, and the retry finishes it", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    await w.runShard(w.queued[0] as ShardJob);
    await w.runShard(w.queued[1] as ShardJob);
    w.behaviour.throwTimes = 1;

    await expect(w.runShard(w.queued[2] as ShardJob, false)).rejects.toThrow("browser crashed");
    expect(await w.status()).toBe("capturing");
    expect((await w.shards.renderShards(w.build.id))[2]).toMatchObject({
      status: "pending",
      error: "browser crashed",
    });

    const retried = await w.runShard(w.queued[2] as ShardJob, true);
    expect(retried).toMatchObject({ status: "rendered", finalized: true });
    expect(await w.status()).toBe("approved");
    expect(await w.snapshots()).toHaveLength(25);
  });

  it("a rerun of a half-persisted shard starts clean instead of colliding", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    const [first] = w.queued;
    await w.runShard(first as ShardJob);
    // Simulate an interrupted run: the shard is back to pending but its snapshots are still there.
    await w.db.update(w.db.tables.captureShards, first?.shard ?? "", {
      status: "pending",
      result: null,
    });

    await expect(w.runShard(first as ShardJob)).resolves.toMatchObject({ status: "rendered" });
    expect((await w.snapshots()).filter((row) => row.storyId.endsWith("story-00"))).toHaveLength(1);
  });

  it("skips a shard that already finished, vanished, or whose build is no longer capturing", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    const [first, second] = w.queued;
    await w.runShard(first as ShardJob);
    expect(await w.runShard(first as ShardJob)).toMatchObject({ status: "skipped" });
    expect(await w.runShard({ buildId: w.build.id, shard: "gone" })).toMatchObject({
      status: "skipped",
      reason: "shard no longer exists",
    });
    await new BuildModel(w.db, tables(w.db)).setStatus(w.build.id, "failed");
    expect(await w.runShard(second as ShardJob)).toMatchObject({ status: "skipped" });
  });

  it("runs a small build in one piece, as without sharding", async () => {
    const w = await world({ stories: 10, shardSize: 10 });

    const summary = await w.plan();

    expect(summary.shards).toBeUndefined();
    expect(w.queued).toEqual([]);
    expect(await w.status()).toBe("approved");
    expect(await w.snapshots()).toHaveLength(10);
    expect(await w.shards.listForBuild(w.build.id)).toEqual([]);
  });

  it("does not shard without a way to queue the shards, or without a shard size", async () => {
    const noQueue = await world({ stories: 40, shardSize: 10, enqueue: false });
    expect((await noQueue.plan()).shards).toBeUndefined();
    expect(await noQueue.status()).toBe("approved");

    const noSize = await world({ stories: 40, shardSize: undefined });
    expect((await noSize.plan()).shards).toBeUndefined();
    expect(noSize.queued).toEqual([]);
  });

  it("planning again replaces the old shards, so old shard jobs do nothing", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    const oldJobs = [...w.queued];
    w.queued.length = 0;

    await w.plan();

    expect(w.queued).toHaveLength(3);
    expect(await w.runShard(oldJobs[0] as ShardJob)).toMatchObject({ status: "skipped" });
    for (const job of w.queued) {
      // oxlint-disable-next-line no-await-in-loop -- shards run one after another here
      await w.runShard(job);
    }
    expect(await w.status()).toBe("approved");
  });

  it("removes each shard's scratch directory", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    await w.runShard(w.queued[0] as ShardJob);
    const { readdir } = await import("node:fs/promises");
    const shardsDir = join(scratchDir, ".storyshelf-scratch", w.project.id, w.build.id, "shards");
    expect(await readdir(shardsDir).catch(() => [])).toEqual([]);
  });
});
