import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { SCRATCH_DIRNAME } from "@storyshelf/core/capture";
import { BuildModel, CaptureJobModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir, storybookZipPath } from "@storyshelf/core/utils";
import AdmZip from "adm-zip";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

vi.mock("../job-queue.ts", async (original) => {
  const real = await original<typeof import("../job-queue.ts")>();
  return {
    ...real,
    // Enqueue and cancel as usual, but hand no job out: no consumer races the assertions.
    createJobQueue: (...args: Parameters<typeof real.createJobQueue>) => {
      const queue = real.createJobQueue(...args);
      return {
        ...queue,
        get: () => ({
          ...queue.get(),
          poll: async () => await new Promise<null>((resolve) => setTimeout(resolve, 100, null)),
        }),
      };
    },
  };
});

const silentLogger = pino({ level: "silent" });

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html><body>storybook</body></html>"));
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries: {} })));
  return zip.toBuffer();
}

/** Build ids of the capture jobs queued on the app's database. */
async function queuedCaptures(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.list(db.tables.captureJobs);
  return rows.filter((row) => row["kind"] === "capture").map((row) => String(row["buildId"]));
}

async function uploadZip(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  zip: Buffer,
  contentLength?: string,
): Promise<{ buildId: string; status: number; body: string }> {
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
  return { buildId: build.id, status: upload.status, body: await upload.text() };
}

/** Upload with a streamed body and no Content-Length, as a chunked upload arrives. */
async function uploadChunked(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  zip: Buffer,
): Promise<{ buildId: string; status: number }> {
  const created = await app.request(`/api/v1/projects/${slug}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitSha: "sha-1", gitBranch: "main" }),
  });
  const { build, uploadUrl } = (await created.json()) as {
    build: { id: string };
    uploadUrl: string;
  };
  const half = Math.ceil(zip.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(zip.subarray(0, half)));
      controller.enqueue(new Uint8Array(zip.subarray(half)));
      controller.close();
    },
  });
  const upload = await app.request(
    new Request(`http://localhost${uploadUrl}`, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body,
      duplex: "half",
    } as RequestInit),
  );
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
  vi.unstubAllEnvs();
  await rm(scratchDir, { recursive: true, force: true });
});

describe("upload inline statics", () => {
  it("persists statics inline for small zips", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      testing: { runner: stubRunner() },
      config: { scratchDir, maxInlineUnzipSize: 1024 * 1024 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(202);
    expect(await queuedCaptures(db)).toContain(buildId);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(true);
    // Capture will run, so publishing leaves the status to it (no auto-accept).
    expect((await new BuildModel(db).get(buildId))?.status).toBe("pending");
    // The extracted scratch copy is removed once the statics are persisted.
    const left = await readdir(join(scratchDir, SCRATCH_DIRNAME, projectId, buildId)).catch(
      () => null,
    );
    expect(left).toBeNull();
  });

  it("defers large zips to capture", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      testing: { runner: stubRunner() },
      config: { scratchDir, maxInlineUnzipSize: 10 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(202);
    expect(await queuedCaptures(db)).toContain(buildId);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
  });

  it("extracts inline by default (50 MB) without any configuration", async () => {
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
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(true);
  });

  it("counts the streamed bytes: a chunked upload without Content-Length is still extracted inline", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { scratchDir },
    });
    const { slug, id: projectId } = await setupProject(app);
    const { buildId, status } = await uploadChunked(app, slug, storybookZip());
    expect(status).toBe(202);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(true);
  });

  it("sends a chunked upload over the inline limit to a publish job", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { scratchDir, maxInlineUnzipSize: 10 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const { buildId, status } = await uploadChunked(app, slug, storybookZip());
    expect(status).toBe(202);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
    const jobs = await new CaptureJobModel(db).listForBuild(buildId);
    expect(jobs.map((job) => job.kind)).toEqual(["publish"]);
  });

  it("refuses an over-limit zip with 413 and the file-by-file pointer on a serverless host", async () => {
    vi.stubEnv("VERCEL", "1");
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { scratchDir, maxInlineUnzipSize: 10 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const zip = storybookZip();
    const { buildId, status, body } = await uploadZip(app, slug, zip, String(zip.length));
    expect(status).toBe(413);
    expect(body).toContain("/dedup");
    expect(body).toContain("/manifest");
    expect(await storage.exists(storybookZipPath(projectId, buildId))).toBe(false);
    expect(await new CaptureJobModel(db).listForBuild(buildId)).toEqual([]);
  });

  it("still extracts a small zip inline on a serverless host", async () => {
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "fn");
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
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(true);
  });

  it("fails a hosting-only build whose zip breaks a cap, and publishes nothing", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { scratchDir, maxZipEntries: 1 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const { buildId, status } = await uploadZip(app, slug, storybookZip());
    expect(status).toBe(202);
    expect((await new BuildModel(db).get(buildId))?.status).toBe("failed");
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/manifest.json`)).toBe(false);
  });

  it("defaults the scratch dir for inline extraction when none is configured", async () => {
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
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(true);
  });

  it("still returns 202 when inline extraction fails", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      testing: { runner: stubRunner() },
      config: { scratchDir, maxInlineUnzipSize: 1024 * 1024 },
    });
    const { slug, id: projectId } = await setupProject(app);
    const garbage = Buffer.from("definitely-not-a-zip");
    const { buildId, status } = await uploadZip(app, slug, garbage, String(garbage.length));
    expect(status).toBe(202);
    expect(await queuedCaptures(db)).toContain(buildId);
    expect(await storage.exists(`${storybookDir(projectId, buildId)}/iframe.html`)).toBe(false);
    // Capture will backfill, so a failed inline publish leaves the status to it.
    expect((await new BuildModel(db).get(buildId))?.status).toBe("pending");
  });
});
