import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectStorybookMeta,
} from "./defaults.ts";

let dir: string;

/** Variables a git hook or worktree exports; they would point git at that checkout instead of `dir`. */
const GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] as const;
const savedGitEnv = new Map<string, string | undefined>();

function isolateGitEnv(): void {
  for (const name of GIT_REDIRECTS) {
    savedGitEnv.set(name, process.env[name]);
    Reflect.deleteProperty(process.env, name);
  }
}

function restoreGitEnv(): void {
  for (const [name, value] of savedGitEnv) {
    if (value !== undefined) {
      process.env[name] = value;
    }
  }
  savedGitEnv.clear();
}

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
  // Keep git from finding a checkout above the temp directory (e.g. a tmpdir inside a worktree).
  vi.stubEnv("GIT_CEILING_DIRECTORIES", dirname(dir));
  isolateGitEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  restoreGitEnv();
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

  it("returns null for invalid JSON", async () => {
    writeFileSync(join(dir, "package.json"), "{ nope");
    await expect(detectPackageName(dir)).resolves.toBeNull();
  });

  it.each([[{ name: 42 }], [{ name: "" }], [{}]])("returns null for %j", async (pkg) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
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

  it("falls back to the current branch when origin/HEAD is not set", () => {
    const git = (...args: string[]): void => {
      const config = [
        "user.name=t",
        "user.email=t@example.com",
        "commit.gpgSign=false",
        `core.hooksPath=${join(dir, "no-hooks")}`,
      ].flatMap((setting) => ["-c", setting]);
      execFileSync("git", [...config, ...args], { cwd: dir, stdio: "ignore" });
    };
    git("init", "-q", "-b", "trunk");
    git("commit", "-q", "--allow-empty", "-m", "init");
    expect(detectGitDefaultBranch(dir)).toBe("trunk");
  });
});
