// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Sharded-capture benchmark (ADR 0031 phase 5).
 *
 *   node scripts/bench-shards.mjs --storybook <built storybook dir> [--scenario <name>]...
 *                                 [--repeat 2] [--out results.json]
 *
 * Runs a real capture (db-sqlite, local storage, Playwright, the in-memory queue) of one built
 * Storybook under several configurations and reports wall-clock from enqueue to a finished build,
 * peak resident memory across this process and its browsers, shard timings and a correctness check
 * (every story captured exactly once). Needs the built `dist/` of core, db-sqlite, storage-local
 * and runner-playwright (`nubx turbo build`).
 *
 * `pages` is the Playwright page concurrency of one render call. A sharded run with `workers: W`
 * has W render calls at once, so `workers x pages` is the pages the host runs in total.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (path) => await import(pathToFileURL(join(root, path)).href);
const core = createRequire(join(root, "packages/core/package.json"));
const AdmZip = core("adm-zip");

const { createSqliteDatabase } = await load("packages/db-sqlite/dist/index.mjs");
const { createLocalStorage } = await load("packages/storage-local/dist/index.mjs");
const { createPlaywrightCaptureRunner } = await load("packages/runner-playwright/dist/index.mjs");
const { InMemoryCaptureQueue, createDispatchJob } = await load("packages/core/dist/capture.mjs");
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
    projectStatusConfigs: t.projectStatusConfigs,
    captureAttempts: t.captureAttempts,
    captureLogs: t.captureLogs,
    captureShards: t.captureShards,
  };
}

/** Resident memory (MB) of this process and every Playwright browser process. */
function residentMb() {
  const out = execFileSync("ps", ["-A", "-o", "pid=,rss=,command="], { encoding: "utf8" });
  let kb = 0;
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (match && (Number(match[1]) === process.pid || /ms-playwright/u.test(match[3]))) {
      kb += Number(match[2]);
    }
  }
  return kb / 1024;
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
  const { queue, db, peak } = setup;
  const started = performance.now();
  await queue.enqueue({ buildId: build.id });
  const finished = await waitForBuild(db, build.id, 20 * 60_000);
  const wallMs = performance.now() - started;
  const snapshots = await new SnapshotModel(db, tablesOf(db)).listByBuild(build.id);
  const shards = await new CaptureShardModel(db).renderShards(build.id);
  const durations = shards.map((row) => JSON.parse(row.result ?? "{}").durationMs ?? 0);
  return {
    wallMs: Math.round(wallMs),
    status: finished.status,
    snapshots: snapshots.length,
    uniqueStories: new Set(snapshots.map((row) => `${row.storyId}|${row.viewportName}`)).size,
    shards: shards.length,
    shardMinMs: durations.length ? Math.min(...durations) : null,
    shardMaxMs: durations.length ? Math.max(...durations) : null,
    peakRssMb: Math.round(peak.max),
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
  const peak = { max: 0 };
  const sampler = setInterval(() => {
    peak.max = Math.max(peak.max, residentMb());
  }, 500);

  const jobOptions = {
    db,
    tables: tablesOf(db),
    storage,
    runner,
    scratchDir: join(dir, "scratch"),
    logger,
    shardSize: scenario.shardSize,
  };
  let queue;
  jobOptions.enqueue = async (job) => await queue.enqueue(job);
  const runJob = createDispatchJob({
    db,
    tables: tablesOf(db),
    jobOptions,
    gitHosts: [],
    secret: undefined,
    logger,
    maxRetries: 0,
  });
  queue = new InMemoryCaptureQueue({ concurrency: scenario.workers, runJob, logger });
  const setup = { queue, db, peak };

  const results = [];
  try {
    for (const sha of scenario.twice ? ["a", "b"] : ["a"]) {
      const build = await seedBuild(db, storage, project, sha);
      results.push(await runBuild(setup, build));
    }
  } finally {
    clearInterval(sampler);
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
    }
  }
}
if (outFile) {
  writeFileSync(outFile, JSON.stringify(report, null, 2));
}
