import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectStorybookMeta,
} from "./defaults.ts";

let dir: string;

function writeMain(): void {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(
    join(dir, ".storybook", "main.ts"),
    `export default { framework: { name: "@storybook/react-vite" }, stories: ["../src/**/*.stories.tsx"], addons: ["@storybook/addon-essentials"], staticDirs: ["../public"] };\n`,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-config-"));
  vi.stubEnv("npm_config_user_agent", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("detectPackageName", () => {
  it("reads the name from package.json", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-sb" }));
    await expect(detectPackageName(dir)).resolves.toBe("my-sb");
  });

  it("returns null without a package.json", async () => {
    await expect(detectPackageName(dir)).resolves.toBeNull();
  });
});

describe("detectStorybookMeta", () => {
  it("parses framework, addons, stories, and staticDirs", async () => {
    writeMain();
    await expect(detectStorybookMeta(dir)).resolves.toEqual({
      framework: { name: "@storybook/react-vite" },
      addons: ["@storybook/addon-essentials"],
      storiesGlobs: ["../src/**/*.stories.tsx"],
      staticDirs: ["../public"],
      packagePath: ".storybook",
    });
  });

  it("returns a bare packagePath without a storybook setup", async () => {
    await expect(detectStorybookMeta(dir)).resolves.toEqual({ packagePath: "." });
  });
});

describe("detectGitRepository", () => {
  it("returns null outside a git checkout", () => {
    expect(detectGitRepository(dir)).toBeNull();
  });
});

describe("detectGitDefaultBranch", () => {
  it("returns null outside a git checkout", () => {
    expect(detectGitDefaultBranch(dir)).toBeNull();
  });
});
