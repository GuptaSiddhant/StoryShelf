// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Content GC live-manifest scan benchmark (ADR 0039, #684).
 *
 *   node scripts/bench-content-gc.mjs [--builds 5000] [--entries 400] [--shared 0.9]
 *                                     [--latency 0] [--runs 3]
 *
 * Seeds a SQLite database with `--builds` live builds (db-sqlite, local storage), each with a
 * manifest of `--entries` files (`--shared` of them common to all builds, like a real design
 * system's assets), then runs `collectUnreferencedContent` `--runs` times over 50 candidate hashes
 * that no manifest names. That is the worst case: the scan only stops early once no candidate is
 * left, so it reads every manifest. The lifecycle is a stub, so a pass is the scan plus the removal of the candidates.
 *
 * `--latency <ms>` adds that delay to every storage `exists`, `read` and `delete`, to stand in for a
 * remote store (S3, GCS, Azure; a manifest costs one `exists` and one `read`, a removed blob a `delete`); local disk is the floor. Prints one JSON line per run (pass time) and one for memory.
 * Needs the built `dist/` of core, db-sqlite and storage-local (`nubx turbo build`). Not wired
 * into CI: run it by hand to re-measure after a change to `retention/content-gc.ts`.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (path) => await import(pathToFileURL(join(root, path)).href);
const { createSqliteDatabase } = await load("packages/db-sqlite/dist/index.mjs");
const { createLocalStorage } = await load("packages/storage-local/dist/index.mjs");
const { collectUnreferencedContent } = await load("packages/core/dist/retention.mjs");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
}
const BUILDS = option("builds", 5000);
const ENTRIES = option("entries", 400);
const SHARED = option("shared", 0.9);
const LATENCY_MS = option("latency", 0);
const RUNS = option("runs", 3);

const dir = mkdtempSync(join(tmpdir(), "gc-bench-"));
const db = createSqliteDatabase(join(dir, "db.sqlite"));
await db.lifecycle.setup();
const storage = createLocalStorage(join(dir, "data"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const now = new Date().toISOString();

let sampler;
try {
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Bench",
    slug: "bench",
    gitRepository: null,
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: now,
    updatedAt: now,
  });

  const shared = Array.from({ length: Math.floor(ENTRIES * SHARED) }, (_, i) =>
    hash(`shared-${i}`),
  );
  let started = performance.now();
  for (let b = 0; b < BUILDS; b += 1) {
    const id = `B${String(b).padStart(25, "0")}`;
    const manifest = {};
    shared.forEach((h, i) => (manifest[`assets/f${i}.js`] = h));
    for (let i = shared.length; i < ENTRIES; i += 1) {
      manifest[`assets/u${b}-${i}.js`] = hash(`u-${b}-${i}`);
    }
    await db.insert(db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: "s",
      gitBranch: "main",
      isDefault: true,
      authorEmail: null,
      authorName: null,
      message: null,
      public: false,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      inheritedCount: 0,
      affectedOnly: true,
      baselineSha: null,
      changedFiles: null,
      affectedImportPaths: null,
      createdAt: now,
      updatedAt: now,
    });
    await storage.write(
      `p1/builds/${id}/storybook/manifest.json`,
      Buffer.from(JSON.stringify(manifest)),
    );
  }
  console.error(
    `seeded ${BUILDS} builds x ${ENTRIES} entries in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );

  // Candidates no live manifest names: the pass has to read every manifest to be sure.
  const candidates = Array.from({ length: 50 }, (_, i) => hash(`orphan-${i}`));
  const lifecycle = {
    claimContent: async () => candidates,
    abandonContentClaim: async () => {},
    holdsContentClaim: async () => true,
    finishContentCollection: async () => {},
  };

  let requests = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  if (LATENCY_MS > 0) {
    // A remote store answers `exists` (a HEAD), `read` (a GET) and `delete` in a round trip each.
    // A manifest costs one `exists` and one `read`; each removed blob costs `delete` calls.
    for (const method of ["exists", "read", "delete"]) {
      const real = storage[method].bind(storage);
      storage[method] = async (key) => {
        requests += 1;
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
        inFlight -= 1;
        return await real(key);
      };
    }
  }

  const rssStart = process.memoryUsage().rss;
  let rssPeak = rssStart;
  sampler = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  }, 5);
  for (let run = 1; run <= RUNS; run += 1) {
    for (const hashValue of candidates) {
      await storage.write(`content/${hashValue}`, Buffer.from("x"));
    }
    started = performance.now();
    const removed = await collectUnreferencedContent({ db, storage, lifecycle });
    console.log(
      JSON.stringify({
        run,
        builds: BUILDS,
        entries: ENTRIES,
        latencyMs: LATENCY_MS,
        removed,
        passMs: Math.round(performance.now() - started),
      }),
    );
  }
  console.log(
    JSON.stringify({
      rssStartMB: Math.round(rssStart / 1e6),
      rssPeakMB: Math.round(Math.max(rssPeak, process.memoryUsage().rss) / 1e6),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1e6),
      ...(LATENCY_MS > 0 ? { slowRequests: requests, peakInFlight } : {}),
    }),
  );
} finally {
  // A failed seed or pass still stops the sampler, closes the database and removes the data.
  if (sampler) clearInterval(sampler);
  await db.lifecycle.teardown();
  rmSync(dir, { recursive: true, force: true });
}
