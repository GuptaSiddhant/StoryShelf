import { BuildComponentModel, BuildModel, CaptureJobModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";

/**
 * Hosting only: `createShelfApp({ database, storage })` with no `testing` option publishes
 * Storybooks of any size, and the build is accepted when publishing ends (ADR 0006, decisions 2
 * and 10).
 */

const silentLogger = pino({ level: "silent" });
const IFRAME = "<html><body>storybook</body></html>";
const INDEX = JSON.stringify({
  v: 5,
  entries: {
    "a--x": { type: "story", id: "a--x", title: "A", name: "X", importPath: "./A.stories.tsx" },
  },
});

type App = ReturnType<typeof createShelfApp>;

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from(IFRAME));
  zip.addFile("index.json", Buffer.from(INDEX));
  return zip.toBuffer();
}

let scratchDir = "";
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-publish-flow-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function boot(config: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    logger: silentLogger,
    config: { scratchDir, ...config },
  });
  await app.lifecycle.setup();
  const response = await app.request("/api/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Hosted" }),
  });
  const project = (await response.json()) as { slug: string; id: string };
  return { app, db, storage, project };
}

async function createBuild(app: App, slug: string, branch: string): Promise<{ id: string }> {
  const created = await app.request(`/api/v1/projects/${slug}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitSha: `sha-${branch}`, gitBranch: branch }),
  });
  expect(created.status).toBe(202);
  return ((await created.json()) as { build: { id: string } }).build;
}

async function uploadZip(app: App, slug: string, buildId: string, zip: Buffer): Promise<number> {
  const upload = await app.request(`/api/v1/projects/${slug}/builds/${buildId}/zip`, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: new Uint8Array(zip),
  });
  return upload.status;
}

async function statusOf(db: ReturnType<typeof makeDatabase>["db"], id: string): Promise<string> {
  return (await new BuildModel(db).get(id))?.status ?? "missing";
}

async function componentTitles(
  db: ReturnType<typeof makeDatabase>["db"],
  buildId: string,
): Promise<string[]> {
  return (await new BuildComponentModel(db).listByBuild(buildId)).map((row) => row.title);
}

async function served(app: App, slug: string, buildId: string, file: string): Promise<Response> {
  return await app.request(`/projects/${slug}/storybook/build/${buildId}/${file}`);
}

describe("publishing without testing", () => {
  it("approves a small default-branch zip, published inline, and serves its statics", async () => {
    const { app, db, project } = await boot();
    const build = await createBuild(app, project.slug, "main");

    expect(await uploadZip(app, project.slug, build.id, storybookZip())).toBe(202);

    expect(await statusOf(db, build.id)).toBe("approved");
    const iframe = await served(app, project.slug, build.id, "iframe.html");
    expect(iframe.status).toBe(200);
    expect(await iframe.text()).toBe(IFRAME);
    expect(await componentTitles(db, build.id)).toEqual(["A"]);
    await app.lifecycle.teardown();
  });

  it("publishes a small non-default build and leaves it pending", async () => {
    const { app, db, project } = await boot();
    const build = await createBuild(app, project.slug, "feature/x");

    await uploadZip(app, project.slug, build.id, storybookZip());

    expect(await statusOf(db, build.id)).toBe("pending");
    expect((await served(app, project.slug, build.id, "iframe.html")).status).toBe(200);
    await app.lifecycle.teardown();
  });

  it("publishes an over-limit zip by a job on this instance's consumer", async () => {
    const { app, db, project } = await boot({ maxInlineUnzipSize: 10 });
    const main = await createBuild(app, project.slug, "main");
    const feature = await createBuild(app, project.slug, "feature/y");

    expect(await uploadZip(app, project.slug, main.id, storybookZip())).toBe(202);
    expect(await uploadZip(app, project.slug, feature.id, storybookZip())).toBe(202);

    await vi.waitFor(
      async () => {
        expect(await statusOf(db, main.id)).toBe("approved");
        expect((await served(app, project.slug, feature.id, "iframe.html")).status).toBe(200);
        // the catalog hook runs right after the verdict
        expect(await componentTitles(db, main.id)).toEqual(["A"]);
        expect(await componentTitles(db, feature.id)).toEqual(["A"]);
      },
      { timeout: 10_000, interval: 25 },
    );
    expect(await statusOf(db, feature.id)).toBe("pending");
    expect((await served(app, project.slug, main.id, "iframe.html")).status).toBe(200);
    const jobs = await new CaptureJobModel(db).listForBuild(main.id);
    expect(jobs.map((job) => [job.kind, job.status])).toContainEqual(["publish", "done"]);
    await app.lifecycle.teardown();
  });

  it("fails an over-limit build whose zip breaks a cap", async () => {
    const { app, db, project } = await boot({ maxInlineUnzipSize: 10, maxZipEntries: 1 });
    const build = await createBuild(app, project.slug, "main");

    await uploadZip(app, project.slug, build.id, storybookZip());

    await vi.waitFor(
      async () => {
        expect(await statusOf(db, build.id)).toBe("failed");
      },
      { timeout: 10_000, interval: 25 },
    );
    await app.lifecycle.teardown();
  });

  it("refuses an over-limit zip with 413 on a serverless host, and the file-by-file route works", async () => {
    vi.stubEnv("NETLIFY", "true");
    const { app, db, project } = await boot({ maxInlineUnzipSize: 10 });
    const build = await createBuild(app, project.slug, "main");

    const upload = await app.request(`/api/v1/projects/${project.slug}/builds/${build.id}/zip`, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array(storybookZip()),
    });
    expect(upload.status).toBe(413);
    expect(await upload.text()).toContain("/dedup");
    expect(await statusOf(db, build.id)).toBe("pending");

    const hash = createHash("sha256").update(IFRAME).digest("hex");
    const base = `/api/v1/projects/${project.slug}/builds/${build.id}`;
    const dedup = await app.request(`${base}/dedup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    expect(((await dedup.json()) as { needed: string[] }).needed).toEqual([hash]);
    const form = new FormData();
    form.set(hash, new File([Buffer.from(IFRAME)], hash));
    expect((await app.request(`${base}/content`, { method: "POST", body: form })).status).toBe(200);
    const manifest = await app.request(`${base}/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ rel: "iframe.html", hash, size: IFRAME.length }] }),
    });
    expect(manifest.status).toBe(200);

    expect(await statusOf(db, build.id)).toBe("approved");
    expect(await (await served(app, project.slug, build.id, "iframe.html")).text()).toBe(IFRAME);
    vi.unstubAllEnvs();
  });

  it("catalogues a file-by-file build when its manifest is stored", async () => {
    const { app, db, project } = await boot();
    const build = await createBuild(app, project.slug, "main");
    const base = `/api/v1/projects/${project.slug}/builds/${build.id}`;
    const hash = createHash("sha256").update(INDEX).digest("hex");
    const form = new FormData();
    form.set(hash, new File([Buffer.from(INDEX)], hash));
    await app.request(`${base}/content`, { method: "POST", body: form });
    await app.request(`${base}/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ rel: "index.json", hash, size: INDEX.length }] }),
    });
    expect(await componentTitles(db, build.id)).toEqual(["A"]);
    const library = await (await app.request(`/projects/${project.slug}/library`)).text();
    expect(library).toContain("1 component");
  });

  it("leaves a file-by-file build on a non-default branch pending", async () => {
    const { app, db, project } = await boot();
    const build = await createBuild(app, project.slug, "feature/z");
    const base = `/api/v1/projects/${project.slug}/builds/${build.id}`;
    await app.request(`${base}/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [] }),
    });
    expect(await statusOf(db, build.id)).toBe("pending");
  });

  it("stops the consumer when the app is torn down", async () => {
    const { app } = await boot({ maxInlineUnzipSize: 10 });
    await expect(app.lifecycle.teardown()).resolves.toBeUndefined();
  });
});
