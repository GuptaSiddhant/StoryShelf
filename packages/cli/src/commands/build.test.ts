import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBuild } from "./build.ts";

let dir: string;

/** A build command that materializes a valid Storybook output dir. */
function fakeBuildCommand(outDir: string): string {
  const index = join(outDir, "index.json");
  return `node -e 'require("node:fs").mkdirSync(${JSON.stringify(outDir)}, { recursive: true }); require("node:fs").writeFileSync(${JSON.stringify(index)}, "{}")'`;
}

function seedValidOutput(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.json"), "{}");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-build-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("runBuild", () => {
  it("skips the build when the output dir already has an index", async () => {
    const outDir = join(dir, "storybook-static");
    seedValidOutput(outDir);
    await expect(runBuild({ cwd: dir, buildCommand: "exit 1" })).resolves.toBeUndefined();
  });

  it("builds when the output dir is missing", async () => {
    const outDir = join(dir, "storybook-static");
    await runBuild({
      cwd: dir,
      buildDir: "storybook-static",
      buildCommand: fakeBuildCommand(outDir),
    });
    await expect(runBuild({ cwd: dir, buildDir: "storybook-static" })).resolves.toBeUndefined();
  });

  it("rebuilds when forceBuild is set", async () => {
    const outDir = join(dir, "storybook-static");
    seedValidOutput(outDir);
    writeFileSync(join(outDir, "stale.txt"), "stale");
    await runBuild({
      cwd: dir,
      buildDir: "storybook-static",
      buildCommand: fakeBuildCommand(outDir),
      forceBuild: true,
    });
    await expect(runBuild({ cwd: dir, buildDir: "storybook-static" })).resolves.toBeUndefined();
  });

  it("throws when buildCommand and buildScriptName are both set", async () => {
    await expect(
      runBuild({ cwd: dir, buildCommand: "echo hi", buildScriptName: "build-storybook" }),
    ).rejects.toThrow("mutually exclusive");
  });

  it("throws when the output lacks index.json", async () => {
    const outDir = join(dir, "storybook-static");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "other.txt"), "not an index");
    await expect(runBuild({ cwd: dir, buildDir: "storybook-static" })).rejects.toThrow(
      "Build output incomplete",
    );
  });

  it("propagates a failing build command", async () => {
    await expect(
      runBuild({ cwd: dir, buildDir: "storybook-static", buildCommand: "exit 1" }),
    ).rejects.toThrow();
  });

  it("resolves buildDir from the config file", async () => {
    const outDir = join(dir, "custom-out");
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", buildDir: "custom-out" }),
    );
    await runBuild({ cwd: dir, buildCommand: fakeBuildCommand(outDir) });
    await expect(runBuild({ cwd: dir })).resolves.toBeUndefined();
  });
});
