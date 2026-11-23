import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
/**
 * Capture every story of a built Storybook with the runner, once per pass, and record timings.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=<dir> [SHELF_BENCH_CORE_ENTRY=<file URL>] \
 *   node --conditions=source --import ./bench/engine-register.mjs bench/engine-capture.ts \
 *     <storybook-static> <out dir> <passes> [concurrency]
 *
 * Writes <out>/pass-N/<story>.png and <out>/result.json. With SHELF_BENCH_CORE_ENTRY set the runner's
 * `playwright-core` import resolves to that module (Flashwright); without it, stock playwright-core.
 */
/* oxlint-disable eslint/no-await-in-loop, eslint/no-console, eslint/id-length, eslint/sort-vars, eslint/prefer-named-capture-group -- a sequential benchmark CLI: timings must not overlap, and printing is its output */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { createCaptureRunner } from "../src/capture-runner.ts";

const [staticDir = "", outDir = "", passArg = "3", concArg = "1"] = process.argv.slice(2);
const index = JSON.parse(readFileSync(path.join(staticDir, "index.json"), "utf8")) as {
  entries: Record<
    string,
    { id: string; title: string; name: string; type: string; subtype?: string; parent?: string }
  >;
};
const entries = Object.values(index.entries).filter((entry) => entry.type === "story");
const toStory = (entry: (typeof entries)[number]): StoryEntry => ({
  id: entry.id,
  title: entry.title,
  name: entry.name,
  type: "story" as const,
  ...(entry.parent ? { parentId: entry.parent } : {}),
});
const stories = entries.filter((entry) => entry.subtype !== "test").map((entry) => toStory(entry));
const tests = entries.filter((entry) => entry.subtype === "test").map((entry) => toStory(entry));
const viewports = [{ name: "desktop", width: 1280, height: 720 }];

const passes: unknown[] = [];
for (let pass = 1; pass <= Number(passArg); pass += 1) {
  const dir = path.join(outDir, `pass-${pass}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const runner = createCaptureRunner({ concurrency: Number(concArg) });
  const started = performance.now();
  const result = await runner.render({
    buildId: `bench-${pass}`,
    storybookDir: staticDir,
    stories,
    viewports,
    runA11y: true,
  });
  const wallMs = performance.now() - started;
  for (const capture of result.captures) {
    writeFileSync(path.join(dir, `${capture.story.id}.png`), capture.screenshot);
  }
  const testRuns =
    tests.length > 0 && runner.runTests
      ? await runner.runTests({ buildId: `bench-t-${pass}`, storybookDir: staticDir, tests })
      : undefined;
  passes.push({
    pass,
    tests: testRuns
      ? JSON.parse(JSON.stringify(testRuns, (k, v) => (k === "durationMs" ? undefined : v)))
      : null,
    wallMs,
    captures: result.captures.length,
    failures: result.failures.map((failure) => ({ id: failure.storyId, error: failure.error })),
    perStoryMs: Object.fromEntries(result.captures.map((c) => [c.story.id, c.durationMs ?? null])),
    a11y: Object.fromEntries(result.captures.map((c) => [c.story.id, c.a11y ?? []])),
    pngBytes: result.captures.reduce((sum, c) => sum + c.screenshot.length, 0),
  });
  await runner.lifecycle.teardown();
}
writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify(
    {
      cpus: availableParallelism(),
      entry: process.env["SHELF_BENCH_CORE_ENTRY"] ?? "playwright-core",
      passes,
    },
    null,
    1,
  ),
);
console.log(`wrote ${outDir}/result.json (${passes.length} passes, ${stories.length} stories)`);
