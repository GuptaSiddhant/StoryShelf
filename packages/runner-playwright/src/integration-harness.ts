/** Shared pieces of the real-browser suites: the built fixture, uploading a build, waiting for capture. */
import type { createShelfApp } from "@storyshelf/app";
import type { Build } from "@storyshelf/core/schema";
import AdmZip from "adm-zip";
import { execFile, type ExecException } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vite-plus/test";

const FIXTURE_DIR = process.env["FIXTURE_DIR"]
  ? resolve(process.env["FIXTURE_DIR"])
  : resolve(import.meta.dirname ?? ".", "..", "..", "..", "fixtures", "storybook-8");
export const FIXTURE_STATIC_DIR = join(FIXTURE_DIR, "storybook-static");

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
    ["npx", ["storybook", "build", "-o", "storybook-static", "--stats-json"]],
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

/** Whether the build carries `preview-stats.json`, the dependency graph affected capture reads. */
async function fixtureHasStats(): Promise<boolean> {
  try {
    await access(join(FIXTURE_STATIC_DIR, "preview-stats.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The built fixture, building it when missing or when an older build left no stats file (the
 * fixtures build with `--stats-json` since #499). A build that still has none is returned as is:
 * the suites that need stats report that themselves.
 */
export async function ensureFixtureBuilt(): Promise<string> {
  if (!(await fixtureBuilt()) || !(await fixtureHasStats())) {
    await buildFixture();
  }
  return FIXTURE_STATIC_DIR;
}

export async function readJson<TData>(response: Response): Promise<TData> {
  return (await response.json()) as TData;
}

/**
 * Upload a build via the two-step protocol: create the build with JSON
 * metadata, PUT the Storybook zip to the returned upload URL, then return
 * the refreshed build record.
 */
export async function uploadBuild(
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
export async function waitForBuild(
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

/** The attempt fields the integration tests read. */
export interface FinishedAttempt {
  status: string;
  failedCount: number;
}

/**
 * Poll an attempt until it has left `queued`/`running`. `finalizeBuild` writes
 * the build before `finishAttempt` writes the attempt's counts, so a build
 * that reads terminal can still show the attempt's default counts. Throws on
 * timeout.
 */
export async function waitForAttemptFinished(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  buildId: string,
  attemptNo: number,
  timeoutMs = 150_000,
): Promise<FinishedAttempt> {
  const started = Date.now();
  /* oxlint-disable eslint/no-await-in-loop -- poll loop must be sequential */
  for (;;) {
    const attempt = await readJson<FinishedAttempt>(
      await app.request(`/api/v1/projects/${slug}/builds/${buildId}/attempts/${attemptNo}`),
    );
    if (attempt.status !== "queued" && attempt.status !== "running") {
      return attempt;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for attempt ${attemptNo} of build ${buildId} to finish`);
    }
    await new Promise<void>((done) => {
      setTimeout(done, 250);
    });
  }
  /* oxlint-enable eslint/no-await-in-loop */
}
