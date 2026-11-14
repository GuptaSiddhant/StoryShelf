// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Performance benchmark on `fixtures/storybook-9` (issue #853). Run: `nub run bench`.
 *
 * Starts the real app (SQLite, local storage, Playwright at 2 pages, jobs at concurrency 1), uploads
 * the fixture with the built CLI three times (first, unchanged, one file changed; every upload is `--full`, so "unchanged" is a full capture of an unchanged build, the row ADR 0052's gate measures) and reports
 * storage, capture, published serving, database work and app pages. One warm-up run is dropped,
 * then the median of `--runs` (default 3) runs is printed as a table and as one JSON line.
 * Needs the built `dist/` of the app, cli, core, db-sqlite, storage-local and runner-playwright
 * (`nubx turbo build`), a built `fixtures/storybook-9` and Chromium; it is not part of `turbo verify`.
 *
 *   nub run bench [-- --runs 3] [--out results.json]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./harness.mjs";
import { render } from "./report.mjs";
import { FIXTURE, runOnce } from "./run.mjs";
import { medianOf } from "./stats.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const runs = Number(flag("--runs", 3));
const out = flag("--out", undefined);

if (!existsSync(join(FIXTURE, "index.json"))) {
  console.error(
    "fixtures/storybook-9 is not built: (cd fixtures/storybook-9 && pnpm install && pnpm run build-storybook)",
  );
  process.exit(2);
}
const scratch = join(root, ".tmp/bench");
mkdirSync(scratch, { recursive: true });

const samples = [];
for (let at = 0; at <= runs; at += 1) {
  const label = at === 0 ? "warm-up (dropped)" : `run ${at}/${runs}`;
  console.error(`bench: ${label}`);
  const result = await runOnce(join(scratch, `data-${at}`), scratch);
  if (at > 0) samples.push(result);
}
rmSync(scratch, { recursive: true, force: true });

const summary = {
  fixture: "fixtures/storybook-9",
  runs,
  concurrency: { pages: 2, jobs: 1 },
  node: process.version,
  ...medianOf(samples),
};
console.log(render(summary));
console.log(JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
