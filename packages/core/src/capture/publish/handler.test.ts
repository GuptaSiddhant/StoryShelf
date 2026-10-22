import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildModel } from "../../models/build.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { createTestBuild, createTestProject } from "../../test-helpers/create-project.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/fake-adapters.ts";
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
    });
  };
  return { db, storage, project, build, handler, run, statusOf, log };
}

describe("createPublishHandler", () => {
  it("accepts only jobs that name a build", async () => {
    const { handler } = await setup();
    expect(handler.accepts?.({ buildId: "b1" } as ConsumerJob)).toBe(true);
    expect(handler.accepts?.({ buildId: "" } as ConsumerJob)).toBe(false);
  });

  it("publishes statics and manifest, approves the default-branch build, cleans scratch", async () => {
    const { storage, project, build, run, statusOf } = await setup();
    await run();
    const prefix = storybookDir(project.id, build.id);
    expect(await storage.exists(`${prefix}/iframe.html`)).toBe(true);
    expect(await storage.exists(`${prefix}/manifest.json`)).toBe(true);
    expect(await statusOf()).toBe("approved");
    const left = await readdir(join(scratchDir, SCRATCH_DIRNAME, project.id, build.id)).catch(
      () => null,
    );
    expect(left).toBeNull();
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
