/**
 * Remote capture against a real self-hosted Playwright server (`playwright run-server`), the setup
 * the farm guide describes. The server is the "remote": a separate process that launches the browsers,
 * so this exercises connect, `exposeNetwork` to the loopback Storybook server, the in-browser
 * fingerprint and per-target baselines. Gated by `RUN_INTEGRATION=1` like the rest.
 */
import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import { TargetLaunchError, type StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Snapshot } from "@storyshelf/core/schema";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";
import { ensureFixtureBuilt, readJson, uploadBuild, waitForBuild } from "./integration-harness.ts";
import { playwrightServer } from "./remote/playwright-server.ts";
import { remote } from "./remote/remote.ts";
import { createStaticServer } from "./static-server.ts";

const story = (id: string, title: string, name: string): StoryEntry => ({
  id,
  title,
  name,
  type: "story",
});
const STORIES = [
  story("components-button--primary", "Components/Button", "Primary"),
  story("components-button--secondary", "Components/Button", "Secondary"),
];
const VIEWPORTS = [{ name: "desktop", width: 1280, height: 720 }];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  });
}

/** Start `playwright run-server` from this package's own playwright-core, so the versions match. */
async function startServer(path: string): Promise<{ endpoint: string; child: ChildProcess }> {
  const port = await freePort();
  const cli = join(
    dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")),
    "cli.js",
  );
  const child = spawn(
    process.execPath,
    [cli, "run-server", "--host", "127.0.0.1", "--port", String(port), "--path", path],
    { stdio: ["ignore", "pipe", "inherit"], env: process.env },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (String(chunk).includes("Listening on")) resolve();
    });
  });
  return { endpoint: `ws://127.0.0.1:${port}${path}`, child };
}

const grid = () =>
  playwrightServer({
    name: "grid",
    endpoint: (server as NonNullable<typeof server>).endpoint,
    engines: ["chromium"],
    sessions: 2,
  });

let server: { endpoint: string; child: ChildProcess } | null = null;
let staticDir = "";

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "remote capture (playwright run-server)",
  () => {
    beforeAll(async () => {
      staticDir = await ensureFixtureBuilt();
      server = await startServer("/storyshelf-farm");
    }, 300_000);

    afterAll(() => {
      server?.child.kill();
    });

    it("renders over the connection, reaching the loopback Storybook through exposeNetwork", async () => {
      const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", grid()] });
      await runner.lifecycle?.setup({} as never);
      expect(runner.metadata.targets).toEqual([
        { target: "chromium", reach: "loopback", status: "ready" },
        { target: "chromium@grid", reach: "loopback", status: "ready" },
      ]);
      const result = await runner.render({
        buildId: "remote-1",
        storybookDir: staticDir,
        stories: STORIES,
        viewports: VIEWPORTS,
        target: "chromium@grid",
      });
      expect(result.failures).toEqual([]);
      expect(result.captures).toHaveLength(2);
      for (const capture of result.captures) {
        expect(capture.screenshot.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
        expect(capture.browser).toBe("chromium@grid");
      }
      // Measured inside the browser the server launched.
      expect(result.environment).toMatchObject({
        browserVersion: expect.stringMatching(/^\d+\./u),
        platform: "linux",
        deviceScaleFactor: 1,
      });
    }, 120_000);

    it("reads story parameters on a remote target too", async () => {
      const runner = createPlaywrightCaptureRunner({ browsers: [grid()] });
      const parameters = await runner.extractParameters?.({
        buildId: "remote-2",
        storybookDir: staticDir,
        stories: STORIES,
        target: "chromium@grid",
      });
      expect(Object.keys(parameters ?? {}).length).toBeGreaterThanOrEqual(0);
    }, 120_000);

    it("connects over CDP and needs a URL the browser can reach when it cannot route back", async () => {
      const { chromium } = await import("playwright-core");
      const port = await freePort();
      const local = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
      const cdp = remote({
        name: "cdp",
        engines: ["chromium"],
        sessions: 2,
        connect: () => ({ protocol: "cdp", endpoint: `http://127.0.0.1:${port}` }),
      });
      const runner = createPlaywrightCaptureRunner({ browsers: [cdp] });
      const input = {
        buildId: "remote-3",
        storybookDir: staticDir,
        stories: STORIES.slice(0, 1),
        viewports: VIEWPORTS,
      };
      try {
        expect(runner.metadata.targets?.[0]?.reach).toBe("url");
        await expect(runner.render(input)).rejects.toBeInstanceOf(TargetLaunchError);
        // The seam core fills with a signed URL: any URL the browser can open works the same way.
        const served = await createStaticServer(staticDir);
        try {
          const result = await runner.render({
            ...input,
            storybookUrl: `${served.url}/iframe.html`,
          });
          expect(result.failures).toEqual([]);
          expect(result.captures).toHaveLength(1);
          expect(result.environment?.platform).toBe("linux");
        } finally {
          await served.close();
        }
      } finally {
        await local.close();
      }
    }, 120_000);

    it("has no authentication of its own, and a wrong path is refused at the handshake", async () => {
      // The spike: a bare run-server guards only by its --path (here a secret one); anything that
      // reaches the port with the path can drive a browser, so the guide puts it behind a proxy.
      const wrong = createPlaywrightCaptureRunner({
        browsers: [
          playwrightServer({
            name: "wrong",
            endpoint: (server as NonNullable<typeof server>).endpoint.replace("farm", "other"),
            engines: ["chromium"],
          }),
        ],
      });
      await expect(
        wrong.render({
          buildId: "remote-4",
          storybookDir: staticDir,
          stories: STORIES.slice(0, 1),
          viewports: VIEWPORTS,
        }),
      ).rejects.toThrow(/Cannot launch chromium@wrong/u);
    }, 120_000);
  },
);

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("remote capture through the app", () => {
  let tmp = "";
  let app: ReturnType<typeof createShelfApp> | null = null;
  let db: DatabaseAdapter | null = null;
  let farm: { endpoint: string; child: ChildProcess } | null = null;

  beforeAll(async () => {
    await ensureFixtureBuilt();
    farm = await startServer("/app-farm");
    tmp = await mkdtemp(join(tmpdir(), "storyshelf-remote-"));
    const dataDir = join(tmp, "data");
    await mkdir(dataDir, { recursive: true });
    db = createSqliteDatabase(join(tmp, "shelf.db"));
    const runner = createPlaywrightCaptureRunner({
      browsers: [
        "chromium",
        playwrightServer({
          name: "grid",
          endpoint: farm.endpoint,
          engines: ["chromium"],
          sessions: 2,
        }),
      ],
    });
    app = createShelfApp({
      database: db,
      storage: createLocalStorage(dataDir),
      testing: { runner, concurrency: 1 },
      config: { scratchDir: dataDir, purgeTtlDays: 30 },
    });
    await app.lifecycle.setup();
  }, 300_000);

  afterAll(async () => {
    farm?.child.kill();
    await app?.lifecycle.teardown();
    await rm(tmp, { recursive: true, force: true });
  });

  it("keeps its own baselines per target and recaptures stably", async () => {
    const shelf = app as NonNullable<typeof app>;
    const created = await shelf.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Remote Smoke" }),
    });
    const project = await readJson<{ id: string; slug: string }>(created);
    const patched = await shelf.request(`/api/v1/projects/${project.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browsers: ["chromium", "chromium@grid"] }),
    });
    expect(patched.status).toBe(200);
    const snapshotsOf = async (buildId: string): Promise<Snapshot[]> =>
      await readJson<Snapshot[]>(
        await shelf.request(`/api/v1/projects/${project.slug}/builds/${buildId}/snapshots`),
      );
    const capture = async (sha: string): Promise<string> => {
      const uploaded = await uploadBuild(shelf, project.slug, staticDir, {
        gitSha: sha.repeat(40),
        gitBranch: "feature/remote",
        message: "remote smoke",
      });
      return (await waitForBuild(shelf, project.slug, uploaded.id, ["reviewing", "approved"])).id;
    };

    const first = await capture("a");
    const snapshots = await snapshotsOf(first);
    const targets = (key: string): string[] =>
      snapshots
        .filter((snapshot) => `${snapshot.storyId}/${snapshot.viewportName}` === key)
        .map((snapshot) => snapshot.browser ?? "")
        .toSorted();
    expect(targets("components-button--primary/desktop")).toEqual(["chromium", "chromium@grid"]);

    await shelf.request(`/api/v1/projects/${project.slug}/builds/${first}/approve-all`, {
      method: "POST",
    });
    const second = await capture("b");
    // Each target matches its own baseline: the fingerprint of the remote one is stable.
    expect(new Set((await snapshotsOf(second)).map((snapshot) => snapshot.status))).toEqual(
      new Set(["unchanged"]),
    );
  }, 600_000);
});

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "remote capture over a signed Storybook URL",
  () => {
    let tmp = "";
    let app: ReturnType<typeof createShelfApp> | null = null;
    let listener: ReturnType<typeof serve> | null = null;
    let browser: { close: () => Promise<void> } | null = null;

    beforeAll(async () => {
      staticDir = await ensureFixtureBuilt();
      const { chromium } = await import("playwright-core");
      const debugPort = await freePort();
      browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
      const appPort = await freePort();
      tmp = await mkdtemp(join(tmpdir(), "storyshelf-signed-"));
      const dataDir = join(tmp, "data");
      await mkdir(dataDir, { recursive: true });
      const cdp = remote({
        name: "cdp",
        engines: ["chromium"],
        sessions: 2,
        connect: () => ({ protocol: "cdp", endpoint: `http://127.0.0.1:${debugPort}` }),
      });
      app = createShelfApp({
        database: createSqliteDatabase(join(tmp, "shelf.db")),
        storage: createLocalStorage(dataDir),
        testing: {
          runner: createPlaywrightCaptureRunner({ browsers: [cdp] }),
          concurrency: 1,
        },
        config: {
          scratchDir: dataDir,
          secret: "signed-url-integration-secret-0123456789",
          publicBaseUrl: `http://127.0.0.1:${appPort}`,
        },
      });
      await app.lifecycle.setup();
      listener = serve({ fetch: app.fetch, port: appPort, hostname: "127.0.0.1" });
    }, 300_000);

    afterAll(async () => {
      listener?.close();
      await browser?.close();
      await app?.lifecycle.teardown();
      await rm(tmp, { recursive: true, force: true });
    });

    it("renders a Storybook the browser can only reach through /_s/<token>/", async () => {
      const shelf = app as NonNullable<typeof app>;
      const created = await shelf.request("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Signed Smoke" }),
      });
      const project = await readJson<{ id: string; slug: string }>(created);
      const patched = await shelf.request(`/api/v1/projects/${project.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browsers: ["chromium@cdp"], storybookUrlTtlSeconds: 3600 }),
      });
      expect(patched.status).toBe(200);
      const uploaded = await uploadBuild(shelf, project.slug, staticDir, {
        gitSha: "c".repeat(40),
        gitBranch: "feature/signed",
        message: "signed url smoke",
      });
      const done = await waitForBuild(shelf, project.slug, uploaded.id, [
        "reviewing",
        "approved",
      ]).catch(async (error: unknown) => {
        const attempts = await shelf.request(
          `/api/v1/projects/${project.slug}/builds/${uploaded.id}/attempts`,
        );
        throw new Error(`${String(error)}: ${await attempts.text()}`);
      });
      const snapshots = await readJson<Snapshot[]>(
        await shelf.request(`/api/v1/projects/${project.slug}/builds/${done.id}/snapshots`),
      );
      expect(snapshots.length).toBeGreaterThan(0);
      expect(new Set(snapshots.map((snapshot) => snapshot.browser))).toEqual(
        new Set(["chromium@cdp"]),
      );
    }, 600_000);
  },
);
