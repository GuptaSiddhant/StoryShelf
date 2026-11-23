/**
 * Diff the screenshots of two capture sets with the runner's image engine at threshold 0.
 *
 *   node --conditions=source bench/engine-diff.ts <out dir>   (reads stock-N/ and fw-N/ under it)
 *
 * Prints, per story, the pixels that differ for: stock vs stock (noise), fw vs fw (noise), stock vs fw.
 */
/* oxlint-disable eslint/no-await-in-loop, eslint/no-console, eslint/id-length, eslint/sort-vars, eslint/prefer-named-capture-group -- a sequential benchmark CLI: timings must not overlap, and printing is its output */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { diffImages } from "../src/images/engine.ts";

const out = path.resolve(process.argv[2] ?? "");
const dirs = readdirSync(out)
  .filter((name) => /^(stock|fw)-\d+$/u.test(name))
  .toSorted();
const stock = dirs.filter((d) => d.startsWith("stock-"));
const fw = dirs.filter((d) => d.startsWith("fw-"));
if (stock.length === 0 || fw.length === 0) {
  throw new Error(
    `need stock-N/ and fw-N/ capture sets under ${out} (found ${stock.length} stock, ${fw.length} fw)`,
  );
}
const options = { threshold: 0, maxDiffRatio: 0, failOnSizeChange: true } as Parameters<
  typeof diffImages
>[2];
const ids = readdirSync(path.join(out, stock[0] ?? "", "pass-1")).filter((f) => f.endsWith(".png"));
const read = (dir: string, id: string): Buffer => readFileSync(path.join(out, dir, "pass-1", id));

async function maxDiff(pairs: [string, string][], id: string): Promise<number> {
  let worst = 0;
  for (const [a, b] of pairs) {
    const result = await diffImages(read(a, id), read(b, id), options);
    if (result.sizeChanged) return -1;
    worst = Math.max(worst, result.diffPixels);
  }
  return worst;
}
const within = (set: string[]): [string, string][] => set.slice(1).map((d) => [set[0] ?? "", d]);
const across = stock.flatMap((s) => fw.map((f): [string, string] => [s, f]));
const rows: string[] = [];
let bad = 0;
for (const id of ids) {
  const [s, f, x] = [
    await maxDiff(within(stock), id),
    await maxDiff(within(fw), id),
    await maxDiff(across, id),
  ];
  if (x !== 0) bad += 1;
  rows.push(`| ${id.replace(/\.png$/u, "")} | ${s} | ${f} | ${x} |`);
}
console.log(
  "| story | stock vs stock (px) | fw vs fw (px) | stock vs fw, all pairs (px) |\n|---|---|---|---|",
);
console.log(rows.join("\n"));
console.log(
  `\n${ids.length} stories, ${bad} with any stock-vs-fw difference (${stock.length} stock x ${fw.length} fw runs; -1 = size changed)`,
);
