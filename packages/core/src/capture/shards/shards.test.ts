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
  /** Story ids that kill the browser: the render call throws when it reaches one. */
  crashStories: Set<string>;
  /** Renders that throw outright, counted down. */
  throwTimes: number;
  /** Milliseconds the runner claims each story took; unset reports none. */
  durationOf?: (storyId: string) => number;
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
        if (behaviour.crashStories.has(story.id)) {
          // Dies on this story; the ones before it already streamed out through `onCapture`.
          throw new Error(`browser crashed on ${story.id}`);
        }
        if (behaviour.failStories.has(story.id)) {
          failures.push({ storyId: story.id, viewportName: "desktop", error: "render failed" });
          continue;
        }
        const capture: RenderedSnapshot = {
          story,
          viewportName: "desktop",
          viewport: { name: "desktop", width: 1280, height: 720 },
          screenshot: png(story.id),
          ...(behaviour.durationOf ? { durationMs: behaviour.durationOf(story.id) } : {}),
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
  const behaviour: Behaviour = {
    failStories: new Set(),
    crashStories: new Set(),
    throwTimes: 0,
    rendered: [],
  };
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
  /** Plan a second build of the same project, so the first build's timings are history. */
  const planNextBuild = async () => {
    const next = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: "sha-2",
      gitBranch: "main",
      isDefault: true,
    });
    await storage.write(storybookZipPath(project.id, next.id), zipOfStories(options.stories));
    queued.length = 0;
    await executeCaptureJob({ buildId: next.id }, jobOptions);
    return next;
  };
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
    planNextBuild,
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

  it("orders the next build's shards by what each story cost last time", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    // Later stories render slower; story 24 is the single dearest.
    w.behaviour.durationOf = (storyId) => (Number(storyId.slice(-2)) + 1) * 100;
    await w.plan();
    await Promise.all(w.queued.map(async (job) => await w.runShard(job, true)));

    const next = await w.planNextBuild();

    const rows = await w.shards.renderShards(next.id);
    expect(rows).toHaveLength(3);
    const first = JSON.parse(rows[0]?.payload ?? "{}") as {
      browsers: { stories: { id: string }[] }[];
    };
    const firstIds = first.browsers.flatMap((engine) => engine.stories.map((story) => story.id));
    // The dearest story leads the heaviest shard, which is handed to the queue first.
    expect(firstIds).toContain("components-button--story-24");
    expect(w.queued[0]?.shard).toBe(rows[0]?.id);
    // Every story is still planned exactly once.
    const planned = rows.flatMap((row) => {
      const payload = JSON.parse(row.payload ?? "{}") as {
        browsers: { stories: { id: string }[] }[];
      };
      return payload.browsers.flatMap((engine) => engine.stories.map((story) => story.id));
    });
    expect(new Set(planned).size).toBe(25);
  });

  it("falls back to capture-count order when no build has timings yet", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    await Promise.all(w.queued.map(async (job) => await w.runShard(job, true)));

    const next = await w.planNextBuild();

    const rows = await w.shards.renderShards(next.id);
    const firstPayload = JSON.parse(rows[0]?.payload ?? "{}") as {
      browsers: { stories: { id: string }[] }[];
    };
    const firstIds = firstPayload.browsers.flatMap((engine) =>
      engine.stories.map((story) => story.id),
    );
    expect(firstIds[0]).toBe("components-button--story-00");
  });

  it("fails a story that crashes the browser on its own, not its shard-mates", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    w.behaviour.crashStories.add("components-button--story-12");
    await w.plan();

    const outcomes = await Promise.all(w.queued.map(async (job) => await w.runShard(job, true)));

    expect(await w.snapshots()).toHaveLength(24);
    expect(await w.status()).toBe("failed");
    const summary = outcomes.flatMap((outcome) =>
      outcome.status === "rendered" && outcome.finalized ? [outcome.summary] : [],
    )[0];
    expect(summary).toMatchObject({ failedCount: 1, buildStatus: "failed" });
    // The shard itself finished: only the crashing story is held against it.
    const [, , second] = await w.shards.listForBuild(w.build.id);
    expect(second?.status).toBe("done");
    expect(JSON.parse(second?.result ?? "{}")).toMatchObject({
      failedStoryIds: ["components-button--story-12"],
    });
  });

  it("isolates two crashing stories in the same shard", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    w.behaviour.crashStories.add("components-button--story-10");
    w.behaviour.crashStories.add("components-button--story-17");
    await w.plan();

    await Promise.all(w.queued.map(async (job) => await w.runShard(job, true)));

    expect(await w.snapshots()).toHaveLength(23);
    const [, , second] = await w.shards.listForBuild(w.build.id);
    expect(second?.status).toBe("done");
    const result = JSON.parse(second?.result ?? "{}") as { failedStoryIds: string[] };
    expect(new Set(result.failedStoryIds)).toEqual(
      new Set(["components-button--story-10", "components-button--story-17"]),
    );
  });

  it("a shard that cannot render at all fails for good and rethrows", async () => {
    const w = await world({ stories: 25, shardSize: 10 });
    await w.plan();
    await w.runShard(w.queued[0] as ShardJob);
    await w.runShard(w.queued[1] as ShardJob);
    // Every render dies, so no one story can be blamed: the shard itself fails.
    w.behaviour.throwTimes = Number.POSITIVE_INFINITY;

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
    w.behaviour.throwTimes = Number.POSITIVE_INFINITY;

    await expect(w.runShard(w.queued[2] as ShardJob, false)).rejects.toThrow("browser crashed");
    expect(await w.status()).toBe("capturing");
    expect((await w.shards.renderShards(w.build.id))[2]).toMatchObject({
      status: "pending",
      error: "browser crashed",
    });

    w.behaviour.throwTimes = 0;
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
