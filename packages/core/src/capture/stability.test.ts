import AdmZip from "adm-zip";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRunner, RenderResult, RunnerTarget } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { verifyStorybookToken } from "../utils/storybook-token.ts";
import { executeCaptureJob, type CaptureJobOptions, type ShardJob } from "./orchestrator.ts";
import { buildScratchDir } from "./scratch.ts";
import { executeCaptureShard } from "./shards/execute.ts";
import { stabilityCandidates, stabilityKey } from "./stability.ts";

const STORY = {
  id: "components-button--primary",
  title: "Components/Button",
  name: "Primary",
  importPath: "./Button.stories.tsx",
  type: "story" as const,
};

const GREY = [200, 200, 200] as const;
const BLUE = [20, 120, 220] as const;
const RED = [220, 40, 60] as const;

function solid([red, green, blue]: readonly [number, number, number]): Buffer {
  const image = new PNG({ width: 12, height: 12 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries: { [STORY.id]: STORY } })));
  return zip.toBuffer();
}

/** A runner that answers each render call with the next image of the script (the last one repeats). */
function scriptedRunner(
  script: (readonly [number, number, number] | "crash")[],
  targets?: RunnerTarget[],
) {
  let call = 0;
  const render = vi.fn(async (): Promise<RenderResult> => {
    await Promise.resolve();
    const step = script[Math.min(call, script.length - 1)];
    call += 1;
    if (step === "crash") throw new Error("browser exploded");
    return {
      captures: [{ story: STORY, viewportName: "desktop", screenshot: solid(step ?? GREY) }],
      failures: [],
    };
  });
  const runner: CaptureRunner = {
    metadata: {
      name: "Fake Runner",
      version: "0.0.0",
      kind: "fake",
      category: "capture-runner",
      ...(targets ? { targets } : {}),
    },
    render,
    cancel: vi.fn(async () => {
      await Promise.resolve();
    }),
  };
  return { runner, render };
}

let scratchDir: string;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-stability-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

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

interface World {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  projectId: string;
  /** Capture a build on `branch` whose renders follow `script`; returns the render spy and the snapshot. */
  capture(
    branch: string,
    script: Parameters<typeof scriptedRunner>[0],
  ): Promise<{
    render: ReturnType<typeof scriptedRunner>["render"];
    snapshot: Snapshot | undefined;
  }>;
  buildStatus(branch: string): Promise<string | undefined>;
  /** Whether the build on `branch` still has its extracted Storybook on disk. */
  scratchLeft(branch: string): Promise<boolean>;
}

/** A project whose `main` baseline is the grey render, ready for a feature build to differ from. */
async function world(
  projectPatch: Record<string, unknown> = {},
  remote?: { targets: RunnerTarget[]; extras: Partial<CaptureJobOptions> },
): Promise<World> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db, tables(db)).create({
    name: "Stability",
    requireVerifiedDefault: false,
  });
  await db.update(db.tables.projects, project.id, projectPatch);
  const builds = new Map<string, string>();
  const capture: World["capture"] = async (branch, script) => {
    const build = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: `sha-${branch}-${builds.size}`,
      gitBranch: branch,
      isDefault: branch === "main",
    });
    builds.set(branch, build.id);
    await storage.write(storybookZipPath(project.id, build.id), storybookZip());
    const { runner, render } = scriptedRunner(script, remote?.targets);
    await executeCaptureJob(
      { buildId: build.id },
      { db, tables: tables(db), storage, runner, scratchDir, ...remote?.extras },
    );
    const rows = await db.list(db.tables.snapshots);
    return {
      render,
      snapshot: rows.find((row) => row.buildId === build.id) as Snapshot | undefined,
    };
  };
  return {
    db,
    storage,
    projectId: project.id,
    capture,
    scratchLeft: async (branch) =>
      await readdir(buildScratchDir(scratchDir, project.id, builds.get(branch) ?? "")).then(
        () => true,
        () => false,
      ),
    buildStatus: async (branch) => {
      const id = builds.get(branch);
      return id === undefined ? undefined : (await db.get(db.tables.builds, id))?.status;
    },
  };
}

describe("unstable render detection", () => {
  it("does not flag a change whose second render matches the first", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    const { render, snapshot } = await w.capture("feature", [BLUE, BLUE]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({ status: "changed", diffPassed: false, unstable: false });
  });

  it("flags a change whose second render differs, and it stays a change to review", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    const { render, snapshot } = await w.capture("feature", [BLUE, RED]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({ status: "changed", diffPassed: false, unstable: true });
  });

  it("changes neither the snapshot status nor the build outcome", async () => {
    const stable = await world();
    await stable.capture("main", [GREY]);
    await stable.capture("feature", [BLUE, BLUE]);
    const flaky = await world();
    await flaky.capture("main", [GREY]);
    const { snapshot } = await flaky.capture("feature", [BLUE, RED]);
    expect(await flaky.buildStatus("feature")).toBe(await stable.buildStatus("feature"));
    expect(snapshot?.status).toBe("changed");
  });

  it("renders only once more, never a third time", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    const { render } = await w.capture("feature", [BLUE, RED, GREY, BLUE]);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("does not re-render a snapshot that matches its baseline", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    const { render, snapshot } = await w.capture("feature", [GREY]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({ status: "unchanged", unstable: null });
  });

  it("does not re-render when the project turned detection off", async () => {
    const w = await world({ detectUnstable: false });
    await w.capture("main", [GREY]);
    const { render, snapshot } = await w.capture("feature", [BLUE, RED]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({ status: "changed", unstable: null });
  });

  it("does not re-render a default-branch change, which is approved without review", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    const { render, snapshot } = await w.capture("main", [BLUE, RED]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({ status: "approved", unstable: null });
  });

  it("leaves the snapshot unjudged, and the build complete, when the second render crashes", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    const { snapshot } = await w.capture("feature", [BLUE, "crash"]);
    expect(snapshot).toMatchObject({ status: "changed", unstable: null });
    expect(await w.buildStatus("feature")).not.toBe("failed");
  });

  it("gives the second render of a remote browser its own signed Storybook URL", async () => {
    const secret = "s3cret-s3cret-s3cret";
    const w = await world(
      { browsers: '["chromium@cdp"]' },
      {
        targets: [{ target: "chromium@cdp", reach: "url", status: "ready" }],
        extras: {
          secret,
          publicOrigin: async () => await Promise.resolve("https://shelf.example.com"),
        },
      },
    );
    await w.capture("main", [GREY]);
    const { render, snapshot } = await w.capture("feature", [BLUE, RED]);
    const calls = render.mock.calls as unknown as [{ storybookUrl?: string }][];
    expect(calls).toHaveLength(2);
    for (const [request] of calls) {
      const token = /\/_s\/([^/]+)\//u.exec(request.storybookUrl ?? "")?.[1] ?? "";
      expect(verifyStorybookToken(token, secret, "capture").ok).toBe(true);
    }
    expect(snapshot).toMatchObject({ unstable: true });
  });

  it("still cleans the extracted Storybook up once the build is done", async () => {
    const w = await world();
    await w.capture("main", [GREY]);
    await w.capture("feature", [BLUE, RED]);
    expect(await w.scratchLeft("feature")).toBe(false);
  });
});

describe("stabilityCandidates", () => {
  const base = {
    storyId: "s1",
    browser: "chromium",
    viewportName: "desktop",
    status: "changed",
    diffPassed: false,
    inherited: false,
    unstable: null,
  } as unknown as Snapshot;
  const row = (patch: Partial<Snapshot>): Snapshot => ({ ...base, ...patch });

  it("keeps only changed, rendered, not-yet-judged snapshots", () => {
    const rows = [
      row({ id: "keep" }),
      row({ id: "unchanged", status: "unchanged", diffPassed: true }),
      row({ id: "approved", status: "approved" }),
      row({ id: "inherited", inherited: true }),
      row({ id: "judged", unstable: false }),
      row({ id: "judged-flaky", unstable: true }),
    ];
    expect(stabilityCandidates(rows).map((candidate) => candidate.id)).toEqual(["keep"]);
  });

  it("limits a pass to the (engine, story) pairs of its scope", () => {
    const rows = [row({ id: "a", storyId: "s1" }), row({ id: "b", storyId: "s2" })];
    const scope = new Set([stabilityKey("chromium", "s2")]);
    expect(stabilityCandidates(rows, scope).map((candidate) => candidate.id)).toEqual(["b"]);
    expect(stabilityCandidates(rows, new Set())).toEqual([]);
  });
});

describe("unstable render detection across shards", () => {
  const STORY_B = { ...STORY, id: "components-button--secondary", name: "Secondary" };
  const STORY_C = { ...STORY, id: "components-button--tertiary", name: "Tertiary" };

  function twoStoryZip(): Buffer {
    const entries = { [STORY.id]: STORY, [STORY_B.id]: STORY_B, [STORY_C.id]: STORY_C };
    const zip = new AdmZip();
    zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries })));
    return zip.toBuffer();
  }

  /** Story A renders blue every time; story B renders blue, then red, then blue again. */
  function flakyBRunner() {
    const seen = new Map<string, number>();
    const stories: string[][] = [];
    const render = vi.fn(async (input: Parameters<CaptureRunner["render"]>[0]) => {
      await Promise.resolve();
      stories.push(input.stories.map((story) => story.id));
      return {
        captures: input.stories.map((story) => {
          const count = seen.get(story.id) ?? 0;
          seen.set(story.id, count + 1);
          const flaky = story.id === STORY_B.id && count % 2 === 1;
          return { story, viewportName: "desktop", screenshot: solid(flaky ? RED : BLUE) };
        }),
        failures: [],
      };
    });
    const runner: CaptureRunner = {
      metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
      render,
      cancel: vi.fn(async () => {
        await Promise.resolve();
      }),
    };
    return { runner, stories };
  }

  it("judges each shard's own changed snapshots, once", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, tables(db)).create({
      name: "Sharded stability",
      requireVerifiedDefault: false,
    });
    const builds = new BuildModel(db, tables(db));
    const main = await builds.create(project.id, {
      gitSha: "sha-main",
      gitBranch: "main",
      isDefault: true,
    });
    await storage.write(storybookZipPath(project.id, main.id), twoStoryZip());
    const grey: CaptureRunner = {
      metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
      cancel: async () => {},
      render: async (input) => {
        await Promise.resolve();
        return {
          captures: input.stories.map((story) => ({
            story,
            viewportName: "desktop",
            screenshot: solid(GREY),
          })),
          failures: [],
        };
      },
    };
    await executeCaptureJob(
      { buildId: main.id },
      { db, tables: tables(db), storage, runner: grey, scratchDir },
    );

    const feature = await builds.create(project.id, {
      gitSha: "sha-feature",
      gitBranch: "feature",
      isDefault: false,
      affectedOnly: false,
    });
    await storage.write(storybookZipPath(project.id, feature.id), twoStoryZip());
    const { runner, stories } = flakyBRunner();
    const queued: ShardJob[] = [];
    const options: CaptureJobOptions = {
      db,
      tables: tables(db),
      storage,
      runner,
      scratchDir,
      shardSize: 1,
      enqueue: async (job: ShardJob) => {
        queued.push(job);
        await Promise.resolve();
      },
    };
    await executeCaptureJob({ buildId: feature.id }, options);
    expect(queued).toHaveLength(3);
    for (const job of queued) {
      // oxlint-disable-next-line no-await-in-loop -- shards run one after another here
      await executeCaptureShard({ buildId: job.buildId, shard: job.shard }, options);
    }

    const featureRows = (await db.list(db.tables.snapshots)).filter(
      (row) => row.buildId === feature.id,
    );
    const byStory = Object.fromEntries(featureRows.map((row) => [row.storyId, row]));
    expect(byStory[STORY.id]).toMatchObject({ status: "changed", unstable: false });
    expect(byStory[STORY_B.id]).toMatchObject({ status: "changed", unstable: true });
    expect(byStory[STORY_C.id]).toMatchObject({ status: "changed", unstable: false });
    // Each shard rendered its own story, then re-rendered only that story.
    expect(stories.every((call) => call.length === 1)).toBe(true);
    const counts = new Map<string, number>();
    for (const id of stories.flat()) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts).toEqual(
      new Map([
        [STORY.id, 2],
        [STORY_B.id, 2],
        [STORY_C.id, 2],
      ]),
    );
  });
});
