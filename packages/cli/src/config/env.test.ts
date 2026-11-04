import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPackageRunner, installCommand, startCommand } from "./env.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-config-"));
  vi.stubEnv("npm_config_user_agent", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("detectPackageRunner", () => {
  it("defaults to npm in an empty directory", async () => {
    await expect(detectPackageRunner(dir)).resolves.toBe("npm");
  });

  it.each([
    ["npm/10.8.2 node/v22.0.0 linux x64 workspaces/false", "npm"],
    ["pnpm/9.12.1 npm/? node/v22.9.0 linux x64", "pnpm"],
    ["yarn/1.22.22 npm/? node/v22.9.0 linux x64", "yarn"],
    ["bun/1.1.38", "bun"],
  ])("reads the invoking agent %s as %s", async (agent, expected) => {
    vi.stubEnv("npm_config_user_agent", agent);
    await expect(detectPackageRunner(dir)).resolves.toBe(expected);
  });

  it("ignores an unrecognized agent", async () => {
    vi.stubEnv("npm_config_user_agent", "corepack/0.31.0");
    await expect(detectPackageRunner(dir)).resolves.toBe("npm");
  });

  it("prefers the agent over lockfiles", async () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    vi.stubEnv("npm_config_user_agent", "npm/10.8.2 node/v22.0.0 linux x64");
    await expect(detectPackageRunner(dir)).resolves.toBe("npm");
  });

  it.each([
    ["pnpm@9.0.0", "pnpm"],
    ["yarn@4.5.0", "yarn"],
    ["bun@1.1.0", "bun"],
    ["npm@10.0.0", "npm"],
    ["nub@0.7.5", "nub"],
  ])("reads the packageManager field %s as %s", async (field, expected) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: field }));
    await expect(detectPackageRunner(dir)).resolves.toBe(expected);
  });

  it("no longer detects Deno: its packageManager field and lockfile fall back to npm", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "deno@2.0.0" }));
    writeFileSync(join(dir, "deno.lock"), "");
    await expect(detectPackageRunner(dir)).resolves.toBe("npm");
  });

  it("prefers the packageManager field over lockfiles", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
    writeFileSync(join(dir, "yarn.lock"), "# yarn lockfile v1\n");
    await expect(detectPackageRunner(dir)).resolves.toBe("pnpm");
  });

  it.each([
    ["nub.lock", "nub"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ])("reads lockfile %s as %s", async (file, expected) => {
    writeFileSync(join(dir, file), "");
    await expect(detectPackageRunner(dir)).resolves.toBe(expected);
  });
});

describe("installCommand and startCommand", () => {
  it.each([
    ["npm", "npm install", "npm start"],
    ["pnpm", "pnpm install", "pnpm start"],
    ["yarn", "yarn install", "yarn start"],
    ["bun", "bun install", "bun run start"],
    ["nub", "nub install", "nub run start"],
  ] as const)("maps %s to install/start commands", (runner, install, start) => {
    expect(installCommand(runner)).toBe(install);
    expect(startCommand(runner)).toBe(start);
  });
});
