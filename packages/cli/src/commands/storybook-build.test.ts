import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBuildDir, resolveBuildCommand } from "./storybook-build.ts";

const exec = vi.hoisted(() => ({ execSync: vi.fn() }));
vi.mock("node:child_process", () => exec);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-storybook-build-"));
  vi.stubEnv("npm_config_user_agent", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveBuildCommand", () => {
  it("prefers an explicit buildCommand", async () => {
    await expect(
      resolveBuildCommand(dir, "storybook-static", "make storybook", "build-storybook"),
    ).resolves.toBe("make storybook");
  });

  it.each([
    ["npm", "package-lock.json", "npm run build-storybook -- --output-dir storybook-static"],
    ["pnpm", "pnpm-lock.yaml", "pnpm run build-storybook --output-dir storybook-static"],
    ["yarn", "yarn.lock", "yarn build-storybook --output-dir storybook-static"],
    ["bun", "bun.lockb", "bun run build-storybook --output-dir storybook-static"],
    ["nub", "nub.lock", "nub run build-storybook --output-dir storybook-static"],
  ])("builds a %s command from its lockfile", async (_runner, lockfile, expected) => {
    writeFileSync(join(dir, lockfile), "");
    await expect(resolveBuildCommand(dir, "storybook-static")).resolves.toBe(expected);
  });

  it("uses the custom script name with the detected runner", async () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    await expect(resolveBuildCommand(dir, "dist-storybook", undefined, "build:sb")).resolves.toBe(
      "pnpm run build:sb --output-dir dist-storybook",
    );
  });

  it("detects pnpm from the invoking agent", async () => {
    writeFileSync(join(dir, "package-lock.json"), "");
    vi.stubEnv("npm_config_user_agent", "pnpm/9.12.1 npm/? node/v22.9.0 linux x64");
    await expect(resolveBuildCommand(dir, "storybook-static")).resolves.toBe(
      "pnpm run build-storybook --output-dir storybook-static",
    );
  });
});

const RUNNERS = [
  ["npm", "package-lock.json", "npm run build-storybook -- --output-dir out --stats-json"],
  ["pnpm", "pnpm-lock.yaml", "pnpm run build-storybook --output-dir out --stats-json"],
  ["yarn", "yarn.lock", "yarn build-storybook --output-dir out --stats-json"],
  ["bun", "bun.lockb", "bun run build-storybook --output-dir out --stats-json"],
  ["nub", "nub.lock", "nub run build-storybook --output-dir out --stats-json"],
] as const;

describe("resolveBuildCommand stats", () => {
  it.each(RUNNERS)("adds --stats-json for %s", async (_runner, lockfile, expected) => {
    writeFileSync(join(dir, lockfile), "");
    await expect(resolveBuildCommand(dir, "out", undefined, undefined, true)).resolves.toBe(
      expected,
    );
    await expect(resolveBuildCommand(dir, "out")).resolves.toBe(
      expected.replace(" --stats-json", ""),
    );
  });

  it("never modifies a custom buildCommand", async () => {
    await expect(resolveBuildCommand(dir, "out", "make sb", undefined, true)).resolves.toBe(
      "make sb",
    );
  });
});

const run = (extra: Record<string, unknown>): Promise<void> =>
  ensureBuildDir({ cwd: dir, buildDir: "out", ...extra });
const commandRun = (): string => String(exec.execSync.mock.calls[0]?.[0]);

describe("ensureBuildDir stats", () => {
  let stderr: string[];

  beforeEach(() => {
    exec.execSync.mockReset();
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      stderr.push(chunk);
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for stats when affected capture is on", async () => {
    await run({ affected: true });
    expect(commandRun()).toBe("pnpm run build-storybook --output-dir out --stats-json");
  });

  it.each([
    ["--full", { affected: false }],
    ["buildStats: false", { affected: true, buildStats: false }],
    ["a custom buildCommand", { affected: true, buildCommand: "make sb" }],
  ])("leaves the command alone with %s", async (_name, extra) => {
    await run(extra);
    expect(commandRun()).not.toContain("--stats-json");
  });

  it("warns once when a custom build leaves no stats file", async () => {
    await run({ affected: true, buildCommand: "make sb" });
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("--stats-json");
  });

  it("does not warn when the stats file exists or affected capture is off", async () => {
    exec.execSync.mockImplementation(() => {
      mkdirSync(join(dir, "out"), { recursive: true });
      writeFileSync(join(dir, "out", "preview-stats.json"), "{}");
    });
    await run({ affected: true });
    await run({ affected: false, force: true });
    expect(stderr).toEqual([]);
  });

  it("looks for the configured stats file", async () => {
    writeFileSync(join(dir, "stats.json"), "{}");
    await run({ affected: true, statsFile: "stats.json" });
    expect(stderr).toEqual([]);
  });

  it("does not warn when nothing was built", async () => {
    mkdirSync(join(dir, "out"));
    writeFileSync(join(dir, "out", "index.json"), "{}");
    await run({ affected: true });
    expect(exec.execSync).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
  });
});
