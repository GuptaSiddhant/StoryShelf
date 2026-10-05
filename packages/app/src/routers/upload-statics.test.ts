import type { CaptureJob, CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html><body>storybook</body></html>"));
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries: {} })));
  return zip.toBuffer();
}

function makeQueue(): { queue: CaptureQueue; jobs: CaptureJob[] } {
  const jobs: CaptureJob[] = [];
  const queue: CaptureQueue = {
    metadata: {
      name: "Test Queue",
      version: "0.0.0",
      description: "Recording test double",
      kind: "test",
      category: "capture-queue",
    },
    enqueue: async (job: CaptureJob) => {
      jobs.push(job);
      await Promise.resolve();
    },
    status: async () => {
      await Promise.resolve();
      return null;
    },
    active: async () => {
      await Promise.resolve();
      return [];
    },
    recent: async () => {
      await Promise.resolve();
      return [];
    },
  };
  return { queue, jobs };
}

/** Non-rendering runner double: enqueue works, nothing executes. */
function makeRunner(): CaptureRunner {
  return {
    metadata: { name: "Test Runner", version: "0.0.0", kind: "test", category: "capture-runner" },
    render: async () => {
      await Promise.resolve();
      return { captures: [], failures: [] };
    },
    cancel: async () => {
      await Promise.resolve();
    },
  };
}

async function uploadZip(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  zip: Buffer,
  contentLength: string | undefined,
): Promise<{ buildId: string; status: number }> {
  const created = await app.request(`/api/v1/projects/${slug}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitSha: "sha-1", gitBranch: "main" }),
  });
  expect(created.status).toBe(202);
  const { build, uploadUrl } = (await created.json()) as {
    build: { id: string };
    uploadUrl: string;
  };
  const headers: Record<string, string> = { "content-type": "application/zip" };
  if (contentLength !== undefined) {
    headers["content-length"] = contentLength;
  }
  const upload = await app.request(uploadUrl, {
    method: "PUT",
    headers,
    body: new Uint8Array(zip),
  });
  return { buildId: build.id, status: upload.status };
}

async function setupProject(
  app: ReturnType<typeof createShelfApp>,
): Promise<{ slug: string; id: string }> {
  const response = await app.request("/api/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Statics" }),
  });
  expect(response.status).toBe(201);
  const project = (await response.json()) as { slug: string; id: string };
  return project;
}

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-upload-statics-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

describe("upload inline statics", () => {
  it("persists statics inline for small zips", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { queue, jobs } = makeQueue();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      captureQueue: queue,
      captureRunner: makeRunner(),
      config: { scratchDir, maxInlineUnzipSize: 1024 * 1024 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(202);
    expect(jobs.map((job) => job.buildId)).toContain(buildId);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(true);
  });

  it("defers large zips to capture", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { queue, jobs } = makeQueue();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      captureQueue: queue,
      captureRunner: makeRunner(),
      config: { scratchDir, maxInlineUnzipSize: 10 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(202);
    expect(jobs.map((job) => job.buildId)).toContain(buildId);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
  });

  it("skips inline extraction when no limit is configured", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { scratchDir },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(202);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
  });

  it("skips inline extraction without scratchDir", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { maxInlineUnzipSize: 1024 * 1024 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(202);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
  });

  it("still returns 202 when inline extraction fails", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { queue, jobs } = makeQueue();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      captureQueue: queue,
      captureRunner: makeRunner(),
      config: { scratchDir, maxInlineUnzipSize: 1024 * 1024 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const garbage = Buffer.from("definitely-not-a-zip");
    const { buildId, status } = await uploadZip(app, slug, garbage, String(garbage.length));
    expect(status).toBe(202);
    expect(jobs.map((job) => job.buildId)).toContain(buildId);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
  });
});
