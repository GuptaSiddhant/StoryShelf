import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBuildCommand } from "./storybook-build.ts";

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
    ["deno", "deno.lock", "deno task build-storybook --output-dir storybook-static"],
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
