// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Sharded-capture benchmark (ADR 0031 phase 5).
 *
 *   node scripts/bench-shards.mjs --storybook <built storybook dir> [--scenario <name>]...
 *                                 [--repeat 2] [--out results.json]
 *
 * Runs a real capture (db-sqlite, local storage, Playwright, the database queue and its consumer) of one built
 * Storybook under several configurations and reports wall-clock from enqueue to a finished build,
 * peak resident memory of this process and the browsers it launched, shard timings and a
 * correctness check: the build must end approved with exactly one snapshot per story, otherwise
 * the row is marked `valid: false`, a warning goes to stderr and the exit code is 1. Needs the
 * built `dist/` of core, db-sqlite, storage-local and runner-playwright (`nubx turbo build`).
 *
 * A Storybook to point it at can be generated with `scripts/bench-fixture.mjs` (see there).
 *
 * `pages` is the Playwright page concurrency of one render call. A sharded run with `workers: W`
 * has W render calls at once, so `workers x pages` is the pages the host runs in total.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (path) => await import(pathToFileURL(join(root, path)).href);
const core = createRequire(join(root, "packages/core/package.json"));
const AdmZip = core("adm-zip");
const execFileAsync = promisify(execFile);

const { createSqliteDatabase } = await load("packages/db-sqlite/dist/index.mjs");
const { createLocalStorage } = await load("packages/storage-local/dist/index.mjs");
const { createPlaywrightCaptureRunner } = await load("packages/runner-playwright/dist/index.mjs");
const { createCaptureConsumer, createDatabaseCaptureQueue } = await load(
  "packages/core/dist/capture.mjs",
);
const { BuildModel, ProjectModel, CaptureShardModel, SnapshotModel } = await load(
  "packages/core/dist/models.mjs",
);
const { storybookZipPath } = await load("packages/core/dist/utils.mjs");
const { createShelfLogger } = await load("packages/core/dist/logger.mjs");

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const all = (name) => args.flatMap((value, at) => (value === name ? [args[at + 1]] : []));
const storybookDir = resolve(flag("--storybook") ?? "");
const repeat = Number(flag("--repeat") ?? 2);
const outFile = flag("--out");
const only = all("--scenario");

/** name, workers (render calls at once), pages (per render call), shardSize (undefined = unsharded). */
const SCENARIOS = [
  { name: "unsharded", workers: 1, pages: 8 },
  { name: "sharded-w1", workers: 1, pages: 8, shardSize: 100 },
  { name: "sharded-w2-same-pages", workers: 2, pages: 4, shardSize: 100 },
  { name: "sharded-w4-same-pages", workers: 4, pages: 2, shardSize: 100 },
  { name: "scaleout-w2", workers: 2, pages: 8, shardSize: 100 },
  { name: "scaleout-w4", workers: 4, pages: 8, shardSize: 100 },
  // Two builds in a row on one database: the second plans from the first one's timings.
  { name: "ordering-w4", workers: 4, pages: 2, shardSize: 60, twice: true },
];

function tablesOf(db) {
  const t = db.tables;
  return {
    projects: t.projects,
    builds: t.builds,
    buildLabels: t.buildLabels,
    snapshots: t.snapshots,
    baselines: t.baselines,
    notificationChannels: t.notificationChannels,
    captureAttempts: t.captureAttempts,
    captureLogs: t.captureLogs,
    captureShards: t.captureShards,
  };
}

/** Resident memory (MB) of this process and everything it launched (the browsers), from `ps`. */
async function residentMb() {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,rss="]);
  const rows = stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter((cols) => cols.length === 3 && cols.every(Number.isFinite));
  const mine = new Set([process.pid]);
  // `ps` lists parents in no particular order, so grow the set until nothing new joins it.
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (mine.has(ppid) && !mine.has(pid)) {
        mine.add(pid);
        grew = true;
      }
    }
  }
  return rows.filter(([pid]) => mine.has(pid)).reduce((kb, [, , rss]) => kb + rss, 0) / 1024;
}

/**
 * Peak resident memory over one build. Asynchronous and one `ps` at a time, so sampling does not
 * block the event loop of the process under test (it does cost a little CPU for the `ps` itself).
 */
function samplePeak(everyMs = 1000) {
  const peak = { mb: 0, busy: false };
  const timer = setInterval(async () => {
    if (peak.busy) return;
    peak.busy = true;
    try {
      peak.mb = Math.max(peak.mb, await residentMb());
    } finally {
      peak.busy = false;
    }
  }, everyMs);
  return { stop: () => (clearInterval(timer), peak.mb) };
}

/** Story entries in a built Storybook: the number of snapshots a one-viewport capture must make. */
function countStories(dir) {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  return Object.values(index.entries ?? index.stories ?? {}).filter(
    (entry) => entry.type === undefined || entry.type === "story",
  ).length;
}

async function waitForBuild(db, buildId, timeoutMs) {
  const builds = new BuildModel(db, tablesOf(db));
  const started = performance.now();
  for (;;) {
    const build = await builds.get(buildId);
    if (build && build.status !== "pending" && build.status !== "capturing") {
      return build;
    }
    if (performance.now() - started > timeoutMs) {
      throw new Error(`build ${buildId} still ${build?.status} after ${timeoutMs}ms`);
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function seedBuild(db, storage, project, sha) {
  const build = await new BuildModel(db, tablesOf(db)).create(project.id, {
    gitSha: sha,
    gitBranch: "main",
    isDefault: true,
  });
  const zip = new AdmZip();
  zip.addLocalFolder(storybookDir);
  await storage.write(storybookZipPath(project.id, build.id), zip.toBuffer());
  return build;
}

async function runBuild(setup, build) {
  const { queue, db } = setup;
  const sampler = samplePeak();
  const started = performance.now();
  await queue.enqueue({ buildId: build.id });
  let finished;
  try {
    finished = await waitForBuild(db, build.id, 20 * 60_000);
  } finally {
    setup.peakMb = sampler.stop();
  }
  const wallMs = performance.now() - started;
  const snapshots = await new SnapshotModel(db, tablesOf(db)).listByBuild(build.id);
  const shards = await new CaptureShardModel(db).renderShards(build.id);
  const durations = shards.map((row) => JSON.parse(row.result ?? "{}").durationMs ?? 0);
  const unique = new Set(snapshots.map((row) => `${row.storyId}|${row.viewportName}`)).size;
  const expected = countStories(storybookDir);
  return {
    wallMs: Math.round(wallMs),
    status: finished.status,
    snapshots: snapshots.length,
    uniqueStories: unique,
    expectedStories: expected,
    valid: finished.status === "approved" && snapshots.length === expected && unique === expected,
    shards: shards.length,
    shardMinMs: durations.length ? Math.min(...durations) : null,
    shardMaxMs: durations.length ? Math.max(...durations) : null,
    peakRssMb: Math.round(setup.peakMb),
  };
}

async function runScenario(scenario, runIndex) {
  const dir = join(root, ".tmp/bench-run", `${scenario.name}-${runIndex}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const db = createSqliteDatabase(join(dir, "shelf.db"));
  await db.lifecycle?.setup?.();
  const storage = createLocalStorage(dir);
  const logger = createShelfLogger({ level: "silent" });
  const runner = createPlaywrightCaptureRunner({ concurrency: scenario.pages });
  const project = await new ProjectModel(db, tablesOf(db)).create({ name: "Bench" });

  // The database queue and the consumer the app runs, with one attempt per job.
  const queue = createDatabaseCaptureQueue(db, { retries: 0 });
  const consumer = createCaptureConsumer({
    queue,
    capture: {
      db,
      storage,
      runner,
      scratchDir: join(dir, "scratch"),
      shardSize: scenario.shardSize,
      notifiers: [],
    },
    config: { concurrency: scenario.workers, maxRetries: 0 },
    logger,
  });
  const consuming = consumer.start();
  const setup = { queue, db, peakMb: 0 };

  const results = [];
  try {
    for (const sha of scenario.twice ? ["a", "b"] : ["a"]) {
      const build = await seedBuild(db, storage, project, sha);
      results.push(await runBuild(setup, build));
    }
  } finally {
    await consumer.stop();
    await consuming;
    await queue.lifecycle.teardown();
    await runner.lifecycle?.teardown?.();
    await db.lifecycle?.teardown?.();
  }
  return results;
}

const selected = SCENARIOS.filter((s) => only.length === 0 || only.includes(s.name));
const report = [];
for (const scenario of selected) {
  for (let run = 1; run <= repeat; run += 1) {
    const results = await runScenario(scenario, run);
    for (const [index, result] of results.entries()) {
      const row = { scenario: scenario.name, run, build: index + 1, ...scenario, ...result };
      report.push(row);
      console.log(JSON.stringify(row));
      if (!row.valid) {
        console.error(
          `INVALID: ${scenario.name} run ${run} build ${index + 1} ended ${row.status} with ` +
            `${row.snapshots}/${row.expectedStories} snapshots`,
        );
        process.exitCode = 1;
      }
    }
  }
}
if (outFile) {
  writeFileSync(outFile, JSON.stringify(report, null, 2));
}
