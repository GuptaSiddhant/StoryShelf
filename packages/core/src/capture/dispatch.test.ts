import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { createShelfLogger } from "../logger.ts";
import { BuildModel } from "../models/build.ts";
import { CaptureAttemptModel } from "../models/capture-attempt.ts";
import { CaptureLogModel } from "../models/capture-log.ts";
import { CaptureShardModel } from "../models/capture-shard.ts";
import { NotificationChannelModel } from "../models/notification-channel.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { makeFakeStateNotifier } from "../test-helpers/fake-notifier.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { createBuildStatePublisher } from "./build-state/publisher.ts";
import { createDispatchJob, type DispatchDeps } from "./dispatch.ts";
import { SignedUrlLifetimeError } from "./token-chunks.ts";

const SECRET = "test-secret-0123456789abcdef";

function tables(db: DatabaseAdapter) {
  return {
    projects: db.tables.projects,
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    baselines: db.tables.baselines,
    notificationChannels: db.tables.notificationChannels,
    captureAttempts: db.tables.captureAttempts,
    captureLogs: db.tables.captureLogs,
    captureShards: db.tables.captureShards,
  };
}

function zipWithIndex(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 4,
        entries: {
          "s-1": {
            id: "s-1",
            name: "Primary",
            title: "Components/Button",
            importPath: "./Button.stories.tsx",
            type: "story",
          },
        },
      }),
    ),
  );
  return zip.toBuffer();
}

function zipOfStories(count: number): Buffer {
  const entries = Object.fromEntries(
    Array.from({ length: count }, (_unused, index) => {
      const id = `s-${String(index).padStart(2, "0")}`;
      const entry = {
        id,
        name: id,
        title: "Components/Button",
        importPath: "./B.stories.tsx",
        type: "story",
      };
      return [id, entry];
    }),
  );
  const zip = new AdmZip();
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries })));
  return zip.toBuffer();
}

function fakeRunner(render: CaptureRunner["render"]): CaptureRunner {
  return {
    metadata: { name: "Fake Runner", version: "0.0.0", kind: "fake", category: "capture-runner" },
    render,
    cancel: async () => {},
  };
}

function successRender(): CaptureRunner["render"] {
  return vi.fn(async () => {
    await Promise.resolve();
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return {
      captures: [
        {
          story: {
            id: "s-1",
            title: "Components/Button",
            name: "Primary",
            importPath: "./Button.stories.tsx",
            type: "story" as const,
          },
          viewportName: "desktop",
          screenshot: Buffer.concat([header, Buffer.alloc(100)]),
        },
      ],
      failures: [],
    };
  });
}

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-dispatch-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function seedBuild(db: ReturnType<typeof makeDatabase>["db"]) {
  const project = await new ProjectModel(db, tables(db)).create({ name: "Dispatch" });
  const build = await new BuildModel(db, tables(db)).create(project.id, {
    gitSha: "sha-1",
    gitBranch: "feature/x",
  });
  return { project, build };
}

function depsFor(
  db: ReturnType<typeof makeDatabase>["db"],
  storage: ReturnType<typeof makeStorage>["storage"],
  runner: CaptureRunner,
): DispatchDeps {
  return {
    db,
    tables: tables(db),
    jobOptions: {
      db,
      tables: tables(db),
      storage,
      runner,
      scratchDir,
      logger: createShelfLogger({ level: "silent" }),
    },
    buildState: buildStateFor(db, storage, []),
    logger: createShelfLogger({ level: "silent" }),
  };
}

function buildStateFor(
  db: ReturnType<typeof makeDatabase>["db"],
  storage: ReturnType<typeof makeStorage>["storage"],
  notifiers: NotifierProvider[],
) {
  return createBuildStatePublisher({
    deps: {
      db,
      storage,
      notifiers,
      secret: SECRET,
      config: {},
      publicOrigin: async () => await Promise.resolve("https://shelf.example.com"),
      flags: () => ({ testing: true, review: false }),
      logger: createShelfLogger({ level: "silent" }),
    },
  });
}

describe("createDispatchJob attempt history", () => {
  it("records one completed attempt with logs per run", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const runJob = createDispatchJob(depsFor(db, storage, fakeRunner(successRender())));

    await runJob({ buildId: build.id, reqId: "req-1" });
    await runJob({ buildId: build.id, reqId: "req-2" });

    const attempts = await new CaptureAttemptModel(db, tables(db)).listByBuild(build.id);
    expect(attempts.map((row) => row.attemptNo)).toEqual([1, 2]);
    expect(attempts.every((row) => row.status === "completed")).toBe(true);
    expect(attempts[0]?.reqId).toBe("req-1");
    expect(attempts[0]?.storyCount).toBe(1);

    const logs = new CaptureLogModel(db, tables(db));
    const first = await logs.listByAttempt(attempts[0]?.id ?? "");
    const second = await logs.listByAttempt(attempts[1]?.id ?? "");
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first.map((row) => row.message)).toContain("capture completed");
    expect(first.map((row) => row.seq)).toEqual(first.map((_, index) => index + 1));
  });

  it("captures a non-default build like any other and shows its states on git channels", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    await new NotificationChannelModel(db, tables(db), SECRET).create({
      projectId: project.id,
      provider: "fake-git",
      config: { prefix: "storyshelf-web" },
      secret: "ghp_token",
    });
    const git = makeFakeStateNotifier();
    const deps = {
      ...depsFor(db, storage, fakeRunner(successRender())),
      buildState: buildStateFor(db, storage, [git.provider]),
    };

    await createDispatchJob(deps)({ buildId: build.id });

    const [attempt] = await new CaptureAttemptModel(db, tables(db)).listByBuild(build.id);
    expect(attempt?.status).toBe("completed");
    const firstStatus = git.calls.find((call) => call.target.kind === "status");
    expect(firstStatus).toMatchObject({
      state: "pending",
      target: { sha: "sha-1", context: "storyshelf-web/testing" },
    });
  });

  it("touches the job lease on every attempt-log line", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const runJob = createDispatchJob(depsFor(db, storage, fakeRunner(successRender())));
    const touch = vi.fn();

    await runJob({ buildId: build.id }, { touch });

    const attempts = await new CaptureAttemptModel(db, tables(db)).listByBuild(build.id);
    const logs = await new CaptureLogModel(db, tables(db)).listByAttempt(attempts[0]?.id ?? "");
    expect(touch.mock.calls.length).toBeGreaterThanOrEqual(logs.length);
  });

  it("records a failed attempt with the full error text", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const render = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("renderer exploded");
    });
    const runJob = createDispatchJob(depsFor(db, storage, fakeRunner(render)));

    await expect(runJob({ buildId: build.id })).rejects.toThrow("renderer exploded");

    const attempts = await new CaptureAttemptModel(db, tables(db)).listByBuild(build.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.error).toContain("renderer exploded");
    const logs = await new CaptureLogModel(db, tables(db)).listByAttempt(attempts[0]?.id ?? "");
    expect(logs.map((row) => row.message)).toContain("capture failed");
  });

  it("fails the build without a retry when the signed URL lifetime cannot fit the pass", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const render = vi.fn(async () => {
      await Promise.resolve();
      throw new SignedUrlLifetimeError("increase or clear the project lifetime override");
    });
    const runJob = createDispatchJob(depsFor(db, storage, fakeRunner(render)));

    await expect(runJob({ buildId: build.id })).resolves.toBeUndefined();

    const attempts = await new CaptureAttemptModel(db, tables(db)).listByBuild(build.id);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.error).toContain("increase or clear");
    expect((await new BuildModel(db, tables(db)).get(build.id))?.status).toBe("failed");
  });
});

/** A render to hold: it waits for `release`, then throws, like a duplicate whose browser died. */
interface Hold {
  next?: { entered: () => void; release: Promise<unknown> } | undefined;
}

function shardRunner(failing: boolean, hold: Hold = {}): CaptureRunner {
  return fakeRunner(
    vi.fn<CaptureRunner["render"]>(async (input) => {
      await Promise.resolve();
      const held = hold.next;
      if (held) {
        hold.next = undefined;
        held.entered();
        await held.release;
        throw new Error("duplicate crashed");
      }
      if (failing) {
        throw new Error("browser crashed");
      }
      const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return {
        captures: input.stories.map((story) => ({
          story,
          viewportName: "desktop",
          screenshot: Buffer.concat([header, Buffer.from(story.id)]),
        })),
        failures: [],
      };
    }),
  );
}

async function planBuild(failShard: boolean, hold: Hold = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const { project, build } = await seedBuild(db);
  await storage.write(storybookZipPath(project.id, build.id), zipOfStories(6));
  const queued: { buildId: string; shard: string }[] = [];
  const deps = depsFor(db, storage, shardRunner(failShard, hold));
  deps.jobOptions.shardSize = 1;
  deps.jobOptions.enqueue = async (job) => {
    await Promise.resolve();
    queued.push({ buildId: job.buildId, shard: job.shard });
  };
  const runJob = createDispatchJob(deps);
  await runJob({ buildId: build.id });
  return { db, build, queued, runJob };
}

/** A promise the test resolves by hand: an explicit signal instead of a sleep. */
function gate(): { passed: Promise<null>; open: () => void } {
  const opener: { open: () => void } = { open: () => {} };
  const passed = new Promise<null>((resolve) => {
    opener.open = () => {
      resolve(null);
    };
  });
  return { passed, open: () => opener.open() };
}

async function inOrder<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  const [head, ...rest] = items;
  if (head === undefined) {
    return;
  }
  await run(head);
  await inOrder(rest, run);
}

describe("createDispatchJob sharding", () => {
  it("keeps the attempt open until the last shard ends, then closes it once", async () => {
    const { db, build, queued, runJob } = await planBuild(false);
    const attempts = new CaptureAttemptModel(db, tables(db));

    expect(queued.length).toBeGreaterThan(1);
    expect((await attempts.listByBuild(build.id))[0]?.status).toBe("running");

    await inOrder(queued, runJob);

    const rows = await attempts.listByBuild(build.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("completed");
    expect(rows[0]?.storyCount).toBe(6);
    expect((await new BuildModel(db, tables(db)).get(build.id))?.status).not.toBe("capturing");
    expect(
      (await new CaptureShardModel(db).renderShards(build.id)).every((s) => s.status === "done"),
    ).toBe(true);
  });

  it("fails the attempt when a shard's last try fails", async () => {
    const { db, build, queued, runJob } = await planBuild(true);

    await inOrder(queued, async (job) => {
      await expect(runJob({ ...job, attempts: 0 })).rejects.toThrow("browser crashed");
    });

    const rows = await new CaptureAttemptModel(db, tables(db)).listByBuild(build.id);
    expect(rows[0]?.status).toBe("failed");
    expect((await new BuildModel(db, tables(db)).get(build.id))?.status).toBe("failed");
  });

  it("touches the job lease while a shard renders and persists", async () => {
    const { queued, runJob } = await planBuild(false);
    const touch = vi.fn();

    await runJob(queued[0] as { buildId: string; shard: string }, { touch });

    expect(touch).toHaveBeenCalled();
  });

  it("a duplicate shard that fails after the build finalized leaves the attempt alone", async () => {
    const hold: Hold = {};
    const { db, build, queued, runJob } = await planBuild(false, hold);
    const last = queued.at(-1) as { buildId: string; shard: string };
    await inOrder(queued.slice(0, -1), async (job) => {
      await runJob(job);
    });
    const entered = gate();
    const release = gate();
    hold.next = { entered: entered.open, release: release.passed };

    // The queue hands the last shard to two workers; the duplicate sits in its render...
    const duplicate = runJob({ ...last, attempts: 0 });
    await entered.passed;
    // ...while the original finishes it and finalizes the build.
    await runJob(last);
    const attempts = new CaptureAttemptModel(db, tables(db));
    const closed = (await attempts.listByBuild(build.id))[0];
    expect(closed).toMatchObject({ status: "completed", storyCount: 6, error: null });

    release.open();
    await expect(duplicate).rejects.toThrow("duplicate crashed");

    expect((await attempts.listByBuild(build.id))[0]).toEqual(closed);
  });
});
