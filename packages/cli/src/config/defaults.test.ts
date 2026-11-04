import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectStorybookMeta,
} from "./defaults.ts";

let dir: string;

/** The user's and the system's git config files: pointed at the null device so they define nothing. */
const GIT_CONFIG_FILES = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"] as const;
const savedGitEnv = new Map<string, string | undefined>();
/** The `GIT_*` variables this process started with, which every restore must leave as they were. */
const OUTER_GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")),
);

/**
 * Clear every inherited `GIT_*` variable, so a git hook, a worktree or a `GIT_CONFIG_COUNT` override
 * cannot point git at another checkout or define `remote.origin.url` for the fixture, and use no
 * user or system git config.
 */
function isolateGitEnv(ceiling: string): void {
  for (const name of Object.keys(process.env).filter((key) => key.startsWith("GIT_"))) {
    if (!savedGitEnv.has(name)) {
      savedGitEnv.set(name, process.env[name]);
    }
    Reflect.deleteProperty(process.env, name);
  }
  for (const name of GIT_CONFIG_FILES) {
    process.env[name] = devNull;
  }
  // Keep git from finding a checkout above the fixture (e.g. a tmpdir inside a worktree).
  process.env["GIT_CEILING_DIRECTORIES"] = ceiling;
}

function restoreGitEnv(): void {
  for (const name of Object.keys(process.env).filter((key) => key.startsWith("GIT_"))) {
    Reflect.deleteProperty(process.env, name);
  }
  for (const [name, value] of savedGitEnv) {
    if (value !== undefined) {
      process.env[name] = value;
    }
  }
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
  isolateGitEnv(dirname(dir));
});

afterAll(() => {
  const now = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")),
  );
  expect(now).toEqual(OUTER_GIT_ENV);
});

afterEach(() => {
  restoreGitEnv();
  savedGitEnv.clear();
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
  it("ignores git config overrides inherited through GIT_CONFIG_COUNT", () => {
    restoreGitEnv();
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "remote.origin.url");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "https://github.com/inherited/override.git");
    isolateGitEnv(dirname(dir));
    expect(detectGitRepository(dir)).toBeNull();
  });

  it("replaces the inherited git ceiling during the fixture and restores it afterwards", () => {
    expect(process.env["GIT_CEILING_DIRECTORIES"]).toBe(dirname(dir));
    restoreGitEnv();
    expect(process.env["GIT_CEILING_DIRECTORIES"]).toBe(OUTER_GIT_ENV["GIT_CEILING_DIRECTORIES"]);
  });

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
