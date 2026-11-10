/**
 * Git-state delivery through the durable queue on a real SQLite file (ADR 0014): a "child" handle
 * enqueues the `notify` job and goes away; a separate "parent" handle on the same file claims and
 * delivers it by polling. The forked child itself is covered in core (`child-notify.test.ts`); this
 * proves the queue half against the real driver.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import {
  createBuildStatePublisher,
  createCaptureConsumer,
  createDatabaseCaptureQueue,
  createNotifyEnqueuer,
  createNotifyHandler,
  type BuildStateDeps,
} from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, NotificationChannelModel, ProjectModel } from "@storyshelf/core/models";
import { makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const SECRET = "test-secret-0123456789abcdef";
const cadence = { idleMs: 20, activeMs: 10, activeWindowMs: 1000, jitter: 0 };

async function open(path: string): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(path);
  await db.lifecycle?.setup({ config: {}, logger: silent });
  return db;
}

function depsFor(
  db: DatabaseAdapter,
  git: ReturnType<typeof makeFakeStateNotifier>,
): BuildStateDeps {
  return {
    db,
    storage: makeStorage().storage,
    notifiers: [git.provider],
    secret: SECRET,
    config: {},
    publicOrigin: async () => await Promise.resolve("https://shelf.example.com"),
    flags: () => ({ testing: true, review: false }),
    logger: silent,
  };
}

async function seed(db: DatabaseAdapter): Promise<string> {
  const project = await new ProjectModel(db).create({ name: "Web" });
  const build = await new BuildModel(db).create(project.id, { gitSha: "abc123", gitBranch: "x" });
  await new NotificationChannelModel(db, undefined, SECRET).create({
    projectId: project.id,
    provider: "fake-git",
    config: {},
    secret: "ghp_token",
  });
  return build.id;
}

async function notifyStatuses(db: DatabaseAdapter): Promise<string[]> {
  const rows = (await db.list(db.tables.captureJobs)) as unknown as {
    kind: string;
    entry: string;
    status: string;
  }[];
  return rows.filter((row) => row.kind === "notify" && row.entry === "job").map((r) => r.status);
}

describe("git-state delivery through the durable queue on SQLite", () => {
  it("survives the enqueuing handle, and a separate consumer delivers it by polling alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-notify-"));
    const path = join(dir, "shelf.db");
    try {
      const git = makeFakeStateNotifier();
      const child = await open(path);
      const buildId = await seed(child);
      const publisher = createBuildStatePublisher({
        deps: depsFor(child, git),
        enqueue: createNotifyEnqueuer({ db: child }, createDatabaseCaptureQueue(child)),
      });
      await publisher.request(buildId);
      await publisher.request(buildId); // coalesced into the waiting job
      expect(await notifyStatuses(child)).toEqual(["queued"]);
      await child.lifecycle?.teardown?.();

      // The parent opens the same file later: the job is still there, and nothing was delivered inline.
      const parent = await open(path);
      expect(await notifyStatuses(parent)).toEqual(["queued"]);
      expect(git.calls).toEqual([]);

      const consumer = createCaptureConsumer({
        queue: createDatabaseCaptureQueue(parent, { kinds: ["notify"], owner: "parent" }),
        cadence,
        logger: silent,
        config: { concurrency: 1 },
        handlers: { notify: createNotifyHandler({ deps: depsFor(parent, git) }) },
      });
      const started = consumer.start();
      await vi.waitFor(
        async () => {
          expect(git.calls.length).toBeGreaterThan(0); // one delivery writes several states
          expect(await notifyStatuses(parent)).toEqual(["done"]);
        },
        { timeout: 10_000 },
      );
      await consumer.stop();
      await started;
      await parent.lifecycle?.teardown?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
