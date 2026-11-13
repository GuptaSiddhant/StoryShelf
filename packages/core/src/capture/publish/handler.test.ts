import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildModel } from "../../models/build.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { createTestBuild, createTestProject } from "../../test-helpers/create-project.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/fake-adapters.ts";
import { deferred } from "../../test-helpers/index.ts";
import { storybookDir, storybookZipPath } from "../../utils/paths.ts";
import { zipStream } from "../../utils/zip-write.ts";
import { rig, stubLogger } from "../consumer/test-fixtures.ts";
import type { ConsumerJob } from "../consumer/types.ts";
import { SCRATCH_DIRNAME } from "../scratch.ts";
import { createPublishCompleter } from "./complete.ts";
import { createPublishHandler } from "./handler.ts";

let scratchDir = "";
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-publish-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sources = Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) }));
  for await (const chunk of zipStream(sources)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function setup(options: { files?: Record<string, string>; maxEntries?: number } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables);
  const build = await createTestBuild(db, db.tables, project.id);
  const files = options.files ?? { "iframe.html": "<html></html>", "index.json": "{}" };
  await storage.write(storybookZipPath(project.id, build.id), await zipOf(files));
  const log = stubLogger();
  const completer = createPublishCompleter({
    db,
    captureWillRun: false,
    afterPublish: [],
    logger: log.logger,
  });
  const handler = createPublishHandler({
    db,
    storage,
    scratchDir,
    limits: { maxEntries: options.maxEntries ?? 100, maxBytes: 1024 * 1024 },
    completer,
    logger: log.logger,
  });
  const statusOf = async (): Promise<string | undefined> =>
    (await new BuildModel(db).get(build.id))?.status;
  const run = async (job: Partial<ConsumerJob> = {}): Promise<void> => {
    await handler.run({ buildId: build.id, attempt: 1, maxAttempts: 3, ...job } as ConsumerJob, {
      logger: log.logger,
      touch: () => {},
      signal: new AbortController().signal,
    });
  };
  return { db, storage, project, build, handler, run, statusOf, log };
}

describe("createPublishHandler", () => {
  it("stops at the deadline: an aborted job runs nothing and completes no publication", async () => {
    const { handler, build, statusOf } = await setup();
    const before = await statusOf();
    const controller = new AbortController();
    controller.abort(new Error("job deadline exceeded"));

    await expect(
      handler.run({ buildId: build.id, attempt: 1, maxAttempts: 3 } as ConsumerJob, {
        logger: stubLogger().logger,
        touch: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow("job deadline exceeded");
    expect(await statusOf()).toBe(before);
  });

  it("an expired invocation writes no more, completes nothing and leaves the scratch to the redelivery", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_unused, index) => [`f${String(index)}.html`, `<p>${index}</p>`]),
    );
    const { handler, storage, build, project, statusOf, run } = await setup({ files });
    const before = await statusOf();
    const controller = new AbortController();
    const write = storage.write.bind(storage);
    const writes: string[] = [];
    storage.write = async (key, data, ...rest) => {
      writes.push(key);
      if (writes.length === 1) controller.abort(new Error("job deadline exceeded"));
      return await write(key, data, ...rest);
    };

    await expect(
      handler.run({ buildId: build.id, attempt: 1, maxAttempts: 1 } as ConsumerJob, {
        logger: stubLogger().logger,
        touch: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow("job deadline exceeded");

    const prefix = storybookDir(project.id, build.id);
    expect(writes.length).toBeLessThan(60);
    expect(writes).not.toContain(`${prefix}/manifest.json`);
    expect(await statusOf()).toBe(before);
    // The shared scratch is the redelivery's: the expired run did not remove it.
    expect(await readdir(join(scratchDir, SCRATCH_DIRNAME, project.id, build.id))).not.toEqual([]);

    storage.write = write;
    await run({ attempt: 2 });
    expect(await storage.exists(`${prefix}/manifest.json`)).toBe(true);
  });

  it("records the build's use of each distinct published blob", async () => {
    const { db, build, run } = await setup();
    const recordContentUses = vi.fn(async () => await Promise.resolve([] as string[]));
    Object.assign(db, { buildReferenceLifecycle: { recordContentUses } });
    await run();
    expect(recordContentUses).toHaveBeenCalledTimes(1);
    const [, buildId, hashes] = recordContentUses.mock.calls[0] as unknown as [
      string,
      string,
      string[],
    ];
    expect(buildId).toBe(build.id);
    expect(hashes).toHaveLength(2);
  });

  it("fails the publish for a retry when a collector claimed one of the blobs", async () => {
    const { db, run } = await setup();
    const recordContentUses = vi.fn(async () => await Promise.resolve(["h1"]));
    Object.assign(db, { buildReferenceLifecycle: { recordContentUses } });
    await expect(run()).rejects.toThrow(/being collected/u);
  });

  it("accepts only jobs that name a build", async () => {
    const { handler } = await setup();
    expect(handler.accepts?.({ buildId: "b1" } as ConsumerJob)).toBe(true);
    expect(handler.accepts?.({ buildId: "" } as ConsumerJob)).toBe(false);
  });

  it("publishes statics and manifest, approves the default-branch build, cleans scratch", async () => {
    const { storage, project, build, run, statusOf } = await setup();
    await run();
    const prefix = storybookDir(project.id, build.id);
    // Files are stored once, by content; the per-build directory holds only the manifest.
    expect(await storage.exists(`${prefix}/iframe.html`)).toBe(false);
    expect(await storage.exists(`${prefix}/manifest.json`)).toBe(true);
    expect(await statusOf()).toBe("approved");
  });

  it("is idempotent: a redelivery after a lost lease republishes and keeps the status", async () => {
    const { storage, project, build, run, statusOf, db } = await setup();
    await run();
    await new BuildModel(db).setStatus(build.id, "rejected");
    await run({ attempt: 2 });
    expect(await storage.exists(`${storybookDir(project.id, build.id)}/manifest.json`)).toBe(true);
    expect(await statusOf()).toBe("rejected");
  });

  it("fails the build and acks (no retry) when the zip breaks a cap", async () => {
    const { run, statusOf, storage, project, build } = await setup({
      files: { "a.txt": "1", "b.txt": "2", "c.txt": "3" },
      maxEntries: 2,
    });
    await run();
    expect(await statusOf()).toBe("failed");
    expect(await storage.exists(`${storybookDir(project.id, build.id)}/manifest.json`)).toBe(false);
  });

  it("retries other errors, and fails the build only on the last attempt", async () => {
    const { run, statusOf, storage, project, build } = await setup();
    await storage.delete(storybookZipPath(project.id, build.id));
    await expect(run({ attempt: 1, maxAttempts: 3 })).rejects.toThrow();
    expect(await statusOf()).toBe("pending");
    await expect(run({ attempt: 3, maxAttempts: 3 })).rejects.toThrow();
    expect(await statusOf()).toBe("failed");
  });

  it("stops extracting when the job is cancelled: no manifest, the build is neither completed nor failed", async () => {
    const { handler, storage, project, build, statusOf, log } = await setup();
    // The zip stream never ends, like a read stuck on the network.
    const stuck = new PassThrough();
    let opened!: () => void;
    const openedPromise = new Promise<void>((resolve) => {
      opened = resolve;
    });
    storage.readStream = async () => {
      opened();
      return await Promise.resolve(stuck);
    };
    const job = { buildId: build.id, jobId: "j1", attempt: 1, maxAttempts: 3 } as ConsumerJob;
    const running = handler.run(job, {
      logger: log.logger,
      touch: () => {},
      signal: new AbortController().signal,
    });
    await openedPromise;
    await handler.cancel?.(job);
    await expect(running).rejects.toThrow("publish cancelled");
    expect(stuck.destroyed).toBe(true);
    expect(await storage.exists(`${storybookDir(project.id, build.id)}/manifest.json`)).toBe(false);
    expect(await statusOf()).toBe("pending");
  });

  it("does not complete the build when the cancel lands after the last file was stored", async () => {
    const { handler, storage, build, statusOf, log } = await setup();
    const job = { buildId: build.id, jobId: "j2", attempt: 1, maxAttempts: 3 } as ConsumerJob;
    // The run is told to stop while its manifest is written: the extraction itself still succeeds.
    const write = storage.write.bind(storage);
    storage.write = async (path: string, data: Buffer) => {
      await write(path, data);
      if (path.endsWith("/manifest.json")) await handler.cancel?.(job);
    };

    await expect(
      handler.run(job, {
        logger: log.logger,
        touch: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("publish cancelled");

    expect(await statusOf()).toBe("pending");
  });

  it("keeps a reclaimed attempt cancellable when the older run of the same job ends", async () => {
    const { handler, storage, build, log } = await setup();
    const older = new PassThrough();
    const newer = new PassThrough();
    const streams = [older, newer];
    let opened = 0;
    const bothOpen: Array<() => void> = [];
    const gates = [0, 1].map(
      async (index) => await new Promise<void>((resolve) => (bothOpen[index] = resolve)),
    );
    storage.readStream = async () => {
      const at = opened;
      opened += 1;
      bothOpen[at]?.();
      return await Promise.resolve(streams[at] as PassThrough);
    };
    const job = { buildId: build.id, jobId: "j3", attempt: 1, maxAttempts: 3 } as ConsumerJob;
    const context = { logger: log.logger, touch: () => {}, signal: new AbortController().signal };

    // The lease of the first run was lost, so the job was claimed again while it still runs.
    const first = handler.run(job, context);
    await gates[0];
    const second = handler.run(job, { ...context });
    await gates[1];
    // The older run ends (a broken zip): it must not drop the newer run's controller.
    older.end(Buffer.from("not a zip"));
    await expect(first).rejects.toThrow();

    await handler.cancel?.(job);
    await expect(second).rejects.toThrow("publish cancelled");
    expect(newer.destroyed).toBe(true);
  });

  it("a cancel for a lost attempt does not stop the reclaimed attempt that runs now", async () => {
    const { handler, storage, build, log } = await setup();
    const stream = new PassThrough();
    const opened = deferred();
    storage.readStream = async () => {
      opened.resolve();
      return await Promise.resolve(stream);
    };
    const lost = { buildId: build.id, jobId: "j4", attempt: 1, maxAttempts: 3 } as ConsumerJob;
    const reclaimed = { ...lost, attempt: 2 } as ConsumerJob;
    const running = handler.run(reclaimed, {
      logger: log.logger,
      touch: () => {},
      signal: new AbortController().signal,
    });
    await opened.promise;
    // The consumer that lost attempt 1 reports it: attempt 2 is a different run.
    await handler.cancel?.(lost);
    // Still running: a broken zip is what fails it, a stopped run would resolve instead.
    stream.end(Buffer.from("not a zip"));
    await expect(running).rejects.toThrow();
  });

  it("tolerates a cancel for a job that is not running", async () => {
    const { handler, build } = await setup();
    await expect(
      handler.cancel?.({ buildId: build.id, jobId: "never" } as ConsumerJob),
    ).resolves.toBeUndefined();
  });

  it("drops a job whose build is gone", async () => {
    const { run, log } = await setup();
    await run({ buildId: "ghost" });
    expect(log.calls.some((c) => c.fields === "build is gone; dropping publish job")).toBe(true);
  });
});

describe("publish jobs through the consumer", () => {
  it("publishes a build from a queued job and acks it", async () => {
    const { db, storage, project, build, handler, statusOf } = await setup();
    const r = rig({ db, kinds: ["publish"], handlers: { publish: handler } });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "publish", buildId: build.id });
    const jobs = new CaptureJobModel(db);
    await vi.waitFor(
      async () => {
        await r.clock.advance(1000);
        expect((await jobs.get(id))?.status).toBe("done");
      },
      { timeout: 5000, interval: 10 },
    );
    expect((await jobs.get(id))?.status).toBe("done");
    expect(await statusOf()).toBe("approved");
    expect(await storage.exists(`${storybookDir(project.id, build.id)}/manifest.json`)).toBe(true);
    await consumer.stop();
    await started;
  });
});
