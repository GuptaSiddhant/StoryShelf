import { createShelfApp } from "@storyshelf/app";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { screenshotPath } from "@storyshelf/core/paths";
import type { Build, Snapshot } from "@storyshelf/core/schema";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import AdmZip from "adm-zip";
import { execFile, type ExecException } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

const FIXTURE_DIR = process.env["FIXTURE_DIR"]
  ? resolve(process.env["FIXTURE_DIR"])
  : resolve(import.meta.dirname ?? ".", "..", "..", "..", "fixtures", "storybook-8");
const FIXTURE_STATIC_DIR = join(FIXTURE_DIR, "storybook-static");

let harness: {
  app: ReturnType<typeof createShelfApp>;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  staticDir: string;
  tmp: string;
} | null = null;

function getHarness(): NonNullable<typeof harness> {
  if (!harness) {
    throw new Error("Integration test harness not initialized");
  }
  return harness;
}

async function runFixtureCommand(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((fulfill, reject) => {
    execFile(
      command,
      [...args],
      { cwd: FIXTURE_DIR, timeout: 300_000 },
      (error: ExecException | null) => {
        if (error) {
          reject(new Error(error.message));
        } else {
          fulfill();
        }
      },
    );
  });
}

async function fixtureBuilt(): Promise<boolean> {
  // Gate on iframe.html (what capture loads), not index.html — current
  // Storybook builds emit no top-level index.html.
  try {
    await access(join(FIXTURE_STATIC_DIR, "iframe.html"));
    return true;
  } catch {
    return false;
  }
}

async function runBuilders(
  runners: readonly (readonly [string, readonly string[]])[],
): Promise<boolean> {
  const [runner, ...rest] = runners;
  if (!runner) {
    return false;
  }
  const [command, args] = runner;
  try {
    await runFixtureCommand(command, args);
  } catch {
    return runBuilders(rest);
  }
  return (await fixtureBuilt()) || runBuilders(rest);
}

async function buildFixture(): Promise<void> {
  const runners: readonly (readonly [string, readonly string[]])[] = [
    ["npx", ["storybook", "build", "-o", "storybook-static"]],
    ["npm", ["run", "build-storybook"]],
    ["nub", ["run", "build-storybook"]],
  ];
  const built = await runBuilders(runners);
  if (!built) {
    throw new Error(
      `Storybook fixture not built at ${FIXTURE_STATIC_DIR}. Install the fixture deps and run \`npm run build-storybook\` from ${FIXTURE_DIR} first (each fixture has its own npm install).`,
    );
  }
}

async function ensureFixtureBuilt(): Promise<string> {
  if (!(await fixtureBuilt())) {
    await buildFixture();
  }
  return FIXTURE_STATIC_DIR;
}

async function readJson<TData>(response: Response): Promise<TData> {
  return (await response.json()) as TData;
}

/**
 * Upload a build via the two-step protocol: create the build with JSON
 * metadata, PUT the Storybook zip to the returned upload URL, then return
 * the refreshed build record.
 */
async function uploadBuild(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  staticDir: string,
  meta: { gitSha: string; gitBranch: string; message: string },
): Promise<Build> {
  const zip = new AdmZip();
  zip.addLocalFolder(staticDir);
  const zipBuffer = new Uint8Array(zip.toBuffer());
  const createResponse = await app.request(`/api/v1/projects/${slug}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(meta),
  });
  expect(createResponse.status).toBe(202);
  const created = await readJson<{ build: Build; uploadUrl: string }>(createResponse);
  const putResponse = await app.request(created.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: zipBuffer,
  });
  expect(putResponse.status).toBe(202);
  return readJson<Build>(await app.request(`/api/v1/projects/${slug}/builds/${created.build.id}`));
}

/**
 * Poll a build until it reaches one of the wanted statuses. Capture runs
 * asynchronously after upload, so callers must wait instead of asserting
 * immediately. Throws on timeout.
 */
async function waitForBuild(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  buildId: string,
  wanted: readonly string[],
  timeoutMs = 150_000,
): Promise<Build> {
  const started = Date.now();
  /* oxlint-disable eslint/no-await-in-loop -- poll loop must be sequential */
  for (;;) {
    const build = await readJson<Build>(
      await app.request(`/api/v1/projects/${slug}/builds/${buildId}`),
    );
    if (wanted.includes(build.status)) {
      return build;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for build ${buildId} to reach ${wanted.join("/")}`);
    }
    await new Promise<void>((done) => {
      setTimeout(done, 2000);
    });
  }
  /* oxlint-enable eslint/no-await-in-loop */
}

async function createHarness(): Promise<void> {
  const staticDir = await ensureFixtureBuilt();
  const tmp = await mkdtemp(join(tmpdir(), "storyshelf-int-"));
  const dataDir = join(tmp, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createSqliteDatabase(join(tmp, "shelf.db"));
  const storage = createLocalStorage(dataDir);
  const app = createShelfApp({
    database: db,
    storage,
    capture: { runner: createPlaywrightCaptureRunner(), concurrency: 1 },
    config: { scratchDir: dataDir, purgeTtlDays: 30 },
  });
  await app.lifecycle.setup();
  harness = { app, db, storage, staticDir, tmp };
}

/**
 * Brightness (0–255) of a PNG's first pixel. The first scanline has no row
 * above, so every PNG filter reduces to the raw bytes for pixel 0.
 */
function firstPixelBrightness(png: Buffer): number {
  const colorType = png[25];
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const [red = 0, green = 0, blue = 0] = raw.subarray(1, 1 + bytesPerPixel);
  return (red + green + blue) / 3;
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("browser integration smoke", () => {
  beforeAll(async () => {
    await createHarness();
  }, 300_000);

  afterAll(async () => {
    const current = harness;
    harness = null;
    if (!current) {
      return;
    }
    await current.app.lifecycle.teardown();
    await rm(current.tmp, { recursive: true, force: true });
  });

  it("captures a build end-to-end: upload, capture, diff, review approve", async () => {
    const { app, storage, staticDir } = getHarness();

    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Integration Smoke" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await readJson<{ id: string; slug: string }>(projectResponse);

    const snapshotsFor = async (buildId: string): Promise<Snapshot[]> => {
      const response = await app.request(
        `/api/v1/projects/${project.slug}/builds/${buildId}/snapshots`,
      );
      return readJson<Snapshot[]>(response);
    };

    const uploaded = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "a".repeat(40),
      gitBranch: "feature/smoke",
      message: "first smoke build",
    });
    const first = await waitForBuild(app, project.slug, uploaded.id, ["reviewing"]);
    expect(first.status).toBe("reviewing");
    expect(first.snapshotCount).toBeGreaterThan(0);
    expect(first.changedCount).toBe(first.snapshotCount);

    const firstSnapshots = await snapshotsFor(first.id);
    expect(firstSnapshots.length).toBe(first.snapshotCount);
    for (const snapshot of firstSnapshots) {
      expect(snapshot.status).toBe("new");
    }

    const [probe] = firstSnapshots;
    if (!probe) {
      throw new Error("Expected at least one snapshot");
    }
    const screenshot = await storage.read(
      screenshotPath(project.id, first.id, probe.storyId, probe.viewportName),
    );
    expect(screenshot.length).toBeGreaterThan(0);

    const approveResponse = await app.request(
      `/api/v1/projects/${project.slug}/builds/${first.id}/approve-all`,
      {
        method: "POST",
      },
    );
    expect(approveResponse.status).toBe(200);
    const reviewed = await readJson<Build>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}`),
    );
    expect(reviewed.status).toBe("approved");

    const uploadedSecond = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "a".repeat(40),
      gitBranch: "feature/smoke",
      message: "second smoke build",
    });
    const second = await waitForBuild(app, project.slug, uploadedSecond.id, ["approved"]);
    expect(second.status).toBe("approved");
    // Same commit already approved on this branch: capture is skipped, so no
    // snapshots are produced. The skip is recorded in the attempt log.
    expect(second.snapshotCount).toBe(0);
    const attempts = await readJson<Array<{ attemptNo: number }>>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${second.id}/attempts`),
    );
    expect(attempts.length).toBeGreaterThan(0);
    const logs = await readJson<Array<{ message: string }>>(
      await app.request(
        `/api/v1/projects/${project.slug}/builds/${second.id}/attempts/${attempts[0]?.attemptNo}/logs`,
      ),
    );
    expect(logs.some((line) => line.message.includes("duplicate sha already approved"))).toBe(true);
  }, 300_000);

  it("interaction: play, flaky and disableSnapshot", async () => {
    const { app, staticDir } = getHarness();

    // Create a project with executePlay enabled (opt-in)
    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Play Smoke", executePlay: true, playTimeoutMs: 5000 }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await readJson<{ id: string; slug: string }>(projectResponse);

    const build = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "b".repeat(40),
      gitBranch: "feature/play",
      message: "play smoke",
    });

    // Poll until terminal. Play results land after snapshots, so the build
    // passes through "reviewing" first — wait specifically for "failed"
    // (expected because BlockingFailure is not flaky).
    const final = await waitForBuild(app, project.slug, build.id, ["failed"]);

    // Non-flaky play failure blocks the build
    expect(final.status).toBe("failed");

    const logsRes = await app.request(
      `/api/v1/projects/${project.slug}/builds/${final.id}/attempts/1/logs`,
    );
    const logs =
      await readJson<{ level: string; message: string; fields: string | null }[]>(logsRes);
    const storyIdsOf = (predicate: (l: { level: string; message: string }) => boolean) =>
      logs
        .filter((l) => predicate(l))
        .map((l) => (JSON.parse(l.fields ?? "{}") as { storyId?: string }).storyId)
        .filter((id): id is string => id !== undefined);
    // Exactly one blocking failure (BlockingFailure); flaky play failures are warnings only
    const attemptRes = await app.request(
      `/api/v1/projects/${project.slug}/builds/${final.id}/attempts/1`,
    );
    const attempt = await readJson<{ failedCount: number }>(attemptRes);
    expect(attempt.failedCount).toBe(1);
    // The attempt log records the blocking render failure as the only error line;
    // flaky failures are downgraded to warnings.
    expect(storyIdsOf((l) => l.level === "error")).toEqual(["components-button--blocking-failure"]);
    const flaky = storyIdsOf((l) => l.message.includes("flaky story failed"));
    expect(new Set(flaky)).toEqual(
      new Set([
        "components-button--flaky-tag",
        "components-button--flaky-param",
        "components-button--chromatic-flaky",
      ]),
    );
    // Disabled story is not counted
    expect(final.snapshotCount).toBeGreaterThan(0);
    // 7 plain captures + 5 from the Themed modes stories; the disabled story adds none.
    expect(final.snapshotCount).toBeLessThan(13);

    const res = await app.request(`/api/v1/projects/${project.slug}/builds/${final.id}/snapshots`);
    const snapshots = await readJson<Snapshot[]>(res);
    const ids = new Set(snapshots.map((s) => s.storyId));
    // Stories without a play function (and the flaky ones) are still captured
    expect(ids.has("components-button--primary")).toBe(true);
    expect(ids.has("components-button--disabled")).toBe(false);
  }, 300_000);

  it("modes: theme globals produce distinct, correctly sized captures", async () => {
    const { app, storage, staticDir } = getHarness();
    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Modes Smoke" }),
    });
    const project = await readJson<{ id: string; slug: string }>(projectResponse);
    const uploaded = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "c".repeat(40),
      gitBranch: "feature/modes",
      message: "modes smoke",
    });
    const build = await waitForBuild(app, project.slug, uploaded.id, ["reviewing"]);
    const snapshots = await readJson<Snapshot[]>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots`),
    );
    const modesOf = (storyId: string): Snapshot[] =>
      snapshots.filter((snapshot) => snapshot.storyId === storyId);

    // `storyshelf` key: the plain desktop capture plus a light and a dark mode.
    const surface = modesOf("components-themed--surface");
    expect(surface.map((snapshot) => snapshot.viewportName).toSorted()).toEqual([
      "dark",
      "desktop",
      "light",
    ]);
    const dark = surface.find((snapshot) => snapshot.viewportName === "dark");
    const light = surface.find((snapshot) => snapshot.viewportName === "light");
    expect(dark?.mode).toBe('{"theme":"dark"}');
    const read = async (snapshot: Snapshot | undefined): Promise<Buffer> =>
      await storage.read(
        screenshotPath(project.id, build.id, snapshot?.storyId ?? "", snapshot?.viewportName ?? ""),
      );
    expect(firstPixelBrightness(await read(dark))).toBeLessThan(40);
    expect(firstPixelBrightness(await read(light))).toBeGreaterThan(215);

    // `chromatic` key alias: a named dark mode at the mobile1 viewport width.
    const alias = modesOf("components-themed--chromatic-alias");
    expect(alias.map((snapshot) => snapshot.viewportName).toSorted()).toEqual([
      "dark-mobile",
      "desktop",
    ]);
    expect(alias.find((snapshot) => snapshot.viewportName === "dark-mobile")).toMatchObject({
      viewportWidth: 320,
      mode: '{"theme":"dark"}',
    });

    // Group approval covers the story/mode; the rest of the build stays open.
    const approve = await app.request(
      `/api/v1/projects/${project.slug}/builds/${build.id}/stories/components-themed--surface/modes/dark/approve`,
      { method: "POST" },
    );
    expect(approve.status).toBe(200);
  }, 300_000);

  it("browsers: per-engine snapshots, shared approval and stable re-capture", async () => {
    const { app, storage, staticDir } = getHarness();
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Browsers Smoke" }),
    });
    const project = await readJson<{ id: string; slug: string }>(created);
    const patched = await app.request(`/api/v1/projects/${project.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browsers: ["chromium", "firefox"] }),
    });
    expect(patched.status).toBe(200);

    const snapshotsFor = async (buildId: string): Promise<Snapshot[]> =>
      await readJson<Snapshot[]>(
        await app.request(`/api/v1/projects/${project.slug}/builds/${buildId}/snapshots`),
      );

    const first = await waitForBuild(
      app,
      project.slug,
      (
        await uploadBuild(app, project.slug, staticDir, {
          gitSha: "d".repeat(40),
          gitBranch: "feature/browsers",
          message: "two engines",
        })
      ).id,
      ["reviewing"],
    );
    const snapshots = await snapshotsFor(first.id);
    const engines = (key: string): string[] =>
      snapshots
        .filter((snapshot) => `${snapshot.storyId}/${snapshot.viewportName}` === key)
        .map((snapshot) => snapshot.browser ?? "")
        .toSorted();
    expect(engines("components-button--primary/desktop")).toEqual(["chromium", "firefox"]);
    expect(engines("components-themed--surface/dark")).toEqual(["chromium", "firefox"]);
    const firefox = snapshots.find(
      (snapshot) =>
        snapshot.browser === "firefox" && snapshot.storyId === "components-button--primary",
    );
    expect(
      (
        await storage.read(
          screenshotPath(project.id, first.id, "components-button--primary", "desktop", "firefox"),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(firefox?.screenshotPath).toContain("desktop~firefox");

    // One approval covers the story/mode on both engines and promotes both baselines.
    const group = await app.request(
      `/api/v1/projects/${project.slug}/builds/${first.id}/stories/components-button--primary/modes/desktop/approve`,
      { method: "POST" },
    );
    expect(group.status).toBe(200);
    const afterGroup = await snapshotsFor(first.id);
    expect(
      afterGroup
        .filter((snapshot) => snapshot.storyId === "components-button--primary")
        .map((snapshot) => snapshot.status),
    ).toEqual(["approved", "approved"]);

    await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}/approve-all`, {
      method: "POST",
    });
    const approved = await readJson<Build>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}`),
    );
    expect(approved.status).toBe("approved");

    // A new commit re-captures on both engines and matches each engine's own baseline.
    const second = await waitForBuild(
      app,
      project.slug,
      (
        await uploadBuild(app, project.slug, staticDir, {
          gitSha: "e".repeat(40),
          gitBranch: "feature/browsers",
          message: "re-capture",
        })
      ).id,
      ["approved"],
    );
    const rechecked = await snapshotsFor(second.id);
    expect(rechecked.length).toBe(snapshots.length);
    expect(new Set(rechecked.map((snapshot) => snapshot.status))).toEqual(new Set(["unchanged"]));
  }, 600_000);
});
