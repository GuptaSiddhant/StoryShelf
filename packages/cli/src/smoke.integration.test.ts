/**
 * Smoke test of the *built* CLI, gated on `RUN_SMOKE=1` (CI runs it after the build). Unit tests
 * exercise sources; this exercises what users get: the built CLI launched through a `.bin`-style
 * symlink, as `npx` does. (The scaffold's own smoke test lives in `create-storyshelf`.)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const enabled = process.env["RUN_SMOKE"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");
const scratchRoot = join(repoRoot, ".tmp");
/** The CLI runs under the same Node as the test (the pipeline's default Node). */
const nodeBin = process.execPath;
const cliDist = join(repoRoot, "packages/cli/dist/index.js");

/** Scratch dir inside the repo so generated projects resolve root node_modules (@types/node). */
function makeScratch(prefix: string): string {
  mkdirSync(scratchRoot, { recursive: true });
  return mkdtempSync(join(scratchRoot, prefix));
}

describe.skipIf(!enabled)("runtime under test", () => {
  it("is the Node major the run asked for (SMOKE_NODE_MAJOR)", () => {
    const expected = process.env["SMOKE_NODE_MAJOR"];
    const actual = spawnSync(nodeBin, ["--version"], { encoding: "utf8" }).stdout.trim();
    if (expected) {
      expect(actual.startsWith(`v${expected}.`)).toBe(true);
    }
    expect(actual).toMatch(/^v\d+\./u);
  });
});

describe.skipIf(!enabled)("built CLI", () => {
  it("runs when launched through a .bin symlink (npx)", () => {
    expect(existsSync(cliDist)).toBe(true);
    const dir = makeScratch("smoke-bin-");
    const link = join(dir, "storyshelf");
    symlinkSync(cliDist, link);

    const help = spawnSync(nodeBin, [link, "-h"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: storyshelf");

    const version = spawnSync(nodeBin, [link, "--version"], { encoding: "utf8" });
    const pkg = JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")) as {
      version: string;
    };
    expect(version.stdout.trim()).toBe(pkg.version);
  });
});
