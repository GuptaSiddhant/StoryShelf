// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * The system under test for the benchmark (issue #853): the real app on a local HTTP port with
 * SQLite and local storage, both wrapped by `instrument`, and a Playwright runner at a fixed page
 * concurrency. Uploads go through the built CLI, as a customer's CI does.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { instrument } from "./instrument.mjs";

export const root = join(import.meta.dirname, "../..");
export const TOKEN = "bench-admin-token";
export const SLUG = "bench";
/** Playwright pages open at once in one render call; fixed so runs compare. */
export const PAGES = 2;
const run = promisify(execFile);
const load = async (path) => await import(pathToFileURL(join(root, path)).href);
const needs = createRequire(join(root, "packages/core/package.json"));

/** Start the app on a free port in `dir`. Returns handles for measuring and `stop()`. */
export async function startApp(dir) {
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}-scratch`, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const [{ serve }, { createShelfApp }, sqlite, local, playwright, models] = await Promise.all([
    load("node_modules/@hono/node-server/dist/index.mjs"),
    load("packages/app/dist/index.mjs"),
    load("packages/db-sqlite/dist/index.mjs"),
    load("packages/storage-local/dist/index.mjs"),
    load("packages/runner-playwright/dist/index.mjs"),
    load("packages/core/dist/models.mjs"),
  ]);
  const rawDb = sqlite.createSqliteDatabase(join(dir, "shelf.db"));
  const dbCalls = [];
  const storageCalls = [];
  const logs = [];
  const logger = needs("pino")(
    { level: "info" },
    { write: (line) => logs.push({ line, at: performance.now() }) },
  );
  const app = createShelfApp({
    database: instrument(rawDb, dbCalls),
    storage: instrument(local.createLocalStorage(dir), storageCalls),
    testing: {
      runner: playwright.createPlaywrightCaptureRunner({ concurrency: PAGES }),
      concurrency: 1,
    },
    logger,
    config: { adminToken: TOKEN, scratchDir: `${dir}-scratch`, serverTiming: true },
  });
  await app.lifecycle.setup();
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((done) => server.once("listening", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ name: SLUG }),
  });
  if (created.status !== 201) throw new Error(`project create answered ${created.status}`);
  const builds = new models.BuildModel(rawDb, rawDb.tables);
  const snapshots = new models.SnapshotModel(rawDb, rawDb.tables);
  return {
    base,
    dir,
    dbCalls,
    storageCalls,
    logs,
    builds,
    snapshots,
    stop: async () => {
      await app.lifecycle.teardown();
      server.close();
    },
  };
}

/** Upload a built Storybook with the CLI; resolves to the new build's id. */
export async function upload(system, buildDir, sha) {
  const { stdout } = await run(process.execPath, [
    join(root, "packages/cli/dist/index.js"),
    "upload",
    "--url",
    system.base,
    "--slug",
    SLUG,
    "--token",
    TOKEN,
    "--sha",
    sha,
    "--branch",
    "main",
    "--build-dir",
    buildDir,
    "--full",
  ]);
  const id = /Build created: (\w+)/u.exec(stdout)?.[1];
  if (!id) throw new Error(`no build id in CLI output: ${stdout}`);
  return id;
}

/** Poll until the build leaves pending/capturing; `onStatus` sees every status seen first. */
export async function waitForBuild(system, buildId, timeoutMs = 120_000) {
  const started = performance.now();
  let captureStart = null;
  for (;;) {
    const build = await system.builds.get(buildId);
    if (build?.status === "capturing" && captureStart === null) captureStart = performance.now();
    if (build && build.status !== "pending" && build.status !== "capturing") {
      return { build, captureStart };
    }
    if (performance.now() - started > timeoutMs) throw new Error(`build ${buildId} timed out`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** Bytes and object count under the data dir, by kind of object. The database file is excluded. */
export function storageReport(dir) {
  const kinds = {
    storybookFiles: [0, 0],
    buildZips: [0, 0],
    screenshots: [0, 0],
    metadata: [0, 0],
  };
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!entry.name.startsWith("shelf.db")) add(full, statSync(full).size);
    }
  };
  const add = (full, size) => {
    const parts = relative(dir, full).split(sep);
    const kind =
      parts[0] === "content"
        ? "storybookFiles"
        : parts.at(-1) === "storybook.zip"
          ? "buildZips"
          : parts.at(-1)?.endsWith(".png")
            ? "screenshots"
            : "metadata";
    kinds[kind][0] += size;
    kinds[kind][1] += 1;
  };
  walk(dir);
  const out = Object.fromEntries(
    Object.entries(kinds).map(([kind, [bytes, objects]]) => [kind, { bytes, objects }]),
  );
  const sum = (field) => Object.values(out).reduce((total, one) => total + one[field], 0);
  return { ...out, total: { bytes: sum("bytes"), objects: sum("objects") } };
}
