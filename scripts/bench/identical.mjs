import { execFileSync } from "node:child_process";
// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * How many rendered screenshots are byte-identical to their baseline? (issue #861, measurement only.)
 * Run: `nub run bench:identical [-- --repeats 3]`.
 *
 * Starts the real app like `nub run bench`, uploads `fixtures/storybook-9` as the baseline, then
 * uploads variants of it (every upload is `--full`, so every story renders and can be compared):
 * the unchanged build repeated, a comment-only edit of the shared `Button.tsx`, and a real style
 * edit of it. For each variant it reports, per snapshot, whether the stored screenshot is
 * byte-identical to its baseline's (sha256 of the bytes), and what `diffPixels` said, plus which
 * built assets changed and which stories import the edited file (the affected set).
 * Needs the same builds as `nub run bench`. Variants are rebuilt in `.tmp/identical/`.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root, startApp, upload, waitForBuild } from "./harness.mjs";

const args = process.argv.slice(2);
const repeats = Number(args.includes("--repeats") ? args[args.indexOf("--repeats") + 1] : 3);
const fixture = join(root, "fixtures/storybook-9");
const scratch = join(root, ".tmp/identical");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A rebuilt copy of the fixture with `edit` applied to `src/Button.tsx`. */
function variant(name, edit) {
  const dir = join(scratch, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(fixture, dir, {
    recursive: true,
    filter: (path) => !path.includes("storybook-static") && !path.includes("node_modules/.cache"),
  });
  const file = join(dir, "src/Button.tsx");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
  execFileSync("pnpm", ["run", "build-storybook"], { cwd: dir, stdio: "ignore" });
  return join(dir, "storybook-static");
}

const assetNames = (dir) => new Set(readdirSync(join(dir, "assets")));

/** Capture one build and read every snapshot with the bytes of its screenshot. */
async function capture(system, dir, commit) {
  const id = await upload(system, dir, commit);
  const waited = await waitForBuild(system, id);
  const rows = await system.snapshots.listByBuild(id);
  const out = new Map();
  for (const row of rows) {
    const bytes = await system.storage.read(row.screenshotPath);
    out.set(`${row.storyId}|${row.viewportName}`, { row, hash: sha(bytes) });
  }
  return { id, status: waited.build.status, snapshots: out };
}

function compare(baseline, next, importers) {
  let identical = 0;
  let zeroDiff = 0;
  let diffPassed = 0;
  let inheritedStory = 0;
  const changed = [];
  for (const [key, { row, hash }] of next.snapshots) {
    const before = baseline.snapshots.get(key);
    if (before && before.hash === hash) identical += 1;
    else changed.push(key.split("|")[0]);
    if (row.diffPixels === 0) zeroDiff += 1;
    if (row.diffPassed) diffPassed += 1;
    if (importers && !importers.has(row.storyImportPath)) inheritedStory += 1;
  }
  const total = next.snapshots.size;
  const affected = importers
    ? [...next.snapshots.values()].filter(({ row }) => importers.has(row.storyImportPath))
    : [];
  const affectedIdentical = affected.filter(({ row, hash }) => {
    const before = baseline.snapshots.get(`${row.storyId}|${row.viewportName}`);
    return before && before.hash === hash;
  }).length;
  return {
    total,
    byteIdentical: identical,
    diffPixelsZero: zeroDiff,
    diffPassed,
    changedStories: changed,
    affectedByImport: importers ? affected.length : null,
    unaffectedByImport: importers ? inheritedStory : null,
    affectedButByteIdentical: importers ? affectedIdentical : null,
  };
}

mkdirSync(scratch, { recursive: true });
const system = await startApp(join(scratch, "data"));
system.storage ??= null;
try {
  const base = join(fixture, "storybook-static");
  const baseAssets = assetNames(base);
  // `startApp` returns the storage through the models only; read through the data dir instead.
  const { createLocalStorage } = await import(
    new URL(`file://${join(root, "packages/core/dist/storage/local.mjs")}`).href
  );
  system.storage = createLocalStorage(system.dir);

  const baseline = await capture(system, base, "0000000");
  const approved = await fetch(
    `${system.base}/api/v1/projects/bench/builds/${baseline.id}/approve-all`,
    { method: "POST", headers: { authorization: "Bearer bench-admin-token" } },
  );
  if (!approved.ok) throw new Error(`approve-all answered ${approved.status}`);
  const report = { fixture: "fixtures/storybook-9", snapshotsPerBuild: baseline.snapshots.size };

  report.unchangedRepeats = [];
  for (let at = 1; at <= repeats; at += 1) {
    const next = await capture(system, base, `a${String(at).padStart(6, "0")}`);
    report.unchangedRepeats.push(compare(baseline, next, null));
  }

  const importers = new Set(
    readdirSync(join(fixture, "src"))
      .filter((name) => name.endsWith(".stories.tsx"))
      .filter((name) => readFileSync(join(fixture, "src", name), "utf8").includes('"./Button"'))
      .map((name) => `./src/${name}`),
  );
  const edits = {
    commentOnly: (src) => `${src}\n// bench: comment-only edit\n`,
    styleChange: (src) => src.replace('"#1d4ed8"', '"#1e40af"'),
  };
  report.edits = {};
  for (const [name, edit] of Object.entries(edits)) {
    const dir = variant(name, edit);
    const changedAssets = [...assetNames(dir)].filter((asset) => !baseAssets.has(asset));
    const next = await capture(system, dir, sha(name).slice(0, 7));
    report.edits[name] = { changedAssets, ...compare(baseline, next, importers) };
  }
  report.importersOfEditedFile = [...importers];
  console.log(JSON.stringify(report, null, 2));
} finally {
  await system.stop();
  rmSync(scratch, { recursive: true, force: true });
}
