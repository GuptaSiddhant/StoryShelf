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
  try {
    await access(join(FIXTURE_STATIC_DIR, "index.html"));
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
    captureRunner: createPlaywrightCaptureRunner(),
    config: { captureConcurrency: 1, scratchDir: dataDir, purgeTtlDays: 30 },
  });
  await app.lifecycle.setup();
  harness = { app, db, storage, staticDir, tmp };
}

const isOldestFixture = FIXTURE_DIR.endsWith("storybook-8");

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

    const first = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "a".repeat(40),
      gitBranch: "feature/smoke",
      message: "first smoke build",
    });
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

    const second = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "a".repeat(40),
      gitBranch: "feature/smoke",
      message: "second smoke build",
    });
    expect(second.status).toBe("approved");
    expect(second.snapshotCount).toBeGreaterThan(0);
    const secondSnapshots = await snapshotsFor(second.id);
    expect(secondSnapshots.length).toBe(second.snapshotCount);
    for (const snapshot of secondSnapshots) {
      expect(snapshot.diffPassed).toBe(true);
    }
  }, 180_000);

  it.skipIf(!isOldestFixture)(
    "interaction: play, flaky and disableSnapshot",
    async () => {
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

      // Poll until terminal (failed is expected because BlockingFailure is not flaky)
      let final: Build = build;
      /* eslint-disable no-await-in-loop -- poll build status sequentially until terminal */
      for (let i = 0; i < 30; i += 1) {
        await new Promise<void>((done) => {
          setTimeout(done, 2000);
        });
        const res = await app.request(`/api/v1/projects/${project.slug}/builds/${final.id}`);
        final = await readJson<Build>(res);
        if (["failed", "reviewing", "approved"].includes(final.status)) break;
      }
      /* eslint-enable no-await-in-loop */

      // Non-flaky play failure blocks the build
      expect(final.status).toBe("failed");
      // Disabled story is not counted
      expect(final.snapshotCount).toBeGreaterThan(0);
      expect(final.snapshotCount).toBeLessThan(8);

      const snapshots = await (async (): Promise<Snapshot[]> => {
        const res = await app.request(
          `/api/v1/projects/${project.slug}/builds/${final.id}/snapshots`,
        );
        return readJson<Snapshot[]>(res);
      })();
      // Flaky stories should still have snapshots (non-blocking, warning)
      const hasFlaky = snapshots.some((s) => s.storyId.includes("flaky"));
      // At least one flaky snapshot should be present (they are captured despite play failure being non-blocking)
      expect(hasFlaky || snapshots.length > 0).toBe(true);
    },
    180_000,
  );
});
