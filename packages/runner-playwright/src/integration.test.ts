import { execFile, type ExecException } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import AdmZip from "adm-zip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createShelfRouter, screenshotPath, type Build, type DatabaseAdapter, type Snapshot, type StorageAdapter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";

import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

const FIXTURE_DIR = process.env["FIXTURE_DIR"]
  ? resolve(process.env["FIXTURE_DIR"])
  : resolve(import.meta.dirname, "..", "..", "..", "fixtures", "storybook-8");
const FIXTURE_STATIC_DIR = join(FIXTURE_DIR, "storybook-static");

let harness: {
  app: ReturnType<typeof createShelfRouter>;
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

async function runBuilders(runners: readonly (readonly [string, readonly string[]])[]): Promise<boolean> {
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

async function createHarness(): Promise<void> {
  const staticDir = await ensureFixtureBuilt();
  const tmp = await mkdtemp(join(tmpdir(), "storyshelf-int-"));
  const dataDir = join(tmp, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createSqliteDatabase(join(tmp, "shelf.db"));
  await db.migrate();
  const storage = createLocalStorage(dataDir);
  const app = createShelfRouter({
    database: db,
    storage,
    captureRunner: createPlaywrightCaptureRunner(),
    config: { captureConcurrency: 1, scratchDir: dataDir, purgeTtlDays: 30 },
  });
  harness = { app, db, storage, staticDir, tmp };
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
    await current.db.close();
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

    const upload = async (message: string): Promise<Build> => {
      const zip = new AdmZip();
      zip.addLocalFolder(staticDir);
      const form = new FormData();
      form.set("gitSha", "a".repeat(40));
      form.set("gitBranch", "feature/smoke");
      form.set("message", message);
      const zipBuffer = zip.toBuffer();
      const zipBlob = new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" });
      form.set("zip", zipBlob, "storybook.zip");
      const response = await app.request(`/api/v1/projects/${project.slug}/builds`, { method: "POST", body: form });
      expect(response.status).toBe(202);
      const created = await readJson<Build>(response);
      return created;
    };

    const snapshotsFor = async (buildId: string): Promise<Snapshot[]> => {
      const response = await app.request(`/api/v1/projects/${project.slug}/builds/${buildId}/snapshots`);
      return readJson<Snapshot[]>(response);
    };

    const first = await upload("first smoke build");
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

    const approveResponse = await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}/approve-all`, {
      method: "POST",
    });
    expect(approveResponse.status).toBe(200);
    const reviewed = await readJson<Build>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}`),
    );
    expect(reviewed.status).toBe("approved");

    const second = await upload("second smoke build");
    expect(second.status).toBe("approved");
    expect(second.snapshotCount).toBeGreaterThan(0);
    const secondSnapshots = await snapshotsFor(second.id);
    expect(secondSnapshots.length).toBe(second.snapshotCount);
    for (const snapshot of secondSnapshots) {
      expect(snapshot.diffPassed).toBe(true);
    }
  }, 180_000);
});