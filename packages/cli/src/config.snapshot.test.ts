/**
 * Pins what `config.ts` resolves for a table of representative inputs: the validated config (or
 * null) for each storyshelf.json, what `writeStorybookConfig` writes, `$schema` references, the
 * Storybook metadata read from `main.*`, git detection in throwaway repos and the package runner
 * for each environment. A split of the module can then be shown to resolve the same things.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectPackagePath,
  detectPackageRunner,
  detectStorybookMeta,
  findStorybookMain,
  installCommand,
  loadStorybookConfig,
  schemaReference,
  startCommand,
  writeStorybookConfig,
  type PackageRunner,
  type StorybookConfig,
} from "./config.ts";

let dir = "";

/** Variables a git hook or worktree exports; they would point git at that checkout instead of `dir`. */
const GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] as const;
/** The user's and the system's git config, which could define `remote.origin.url` for any directory. */
const GIT_CONFIGS = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"] as const;
const savedGitEnv = new Map<string, string | undefined>();

function isolateGitEnv(): void {
  for (const name of [...GIT_REDIRECTS, ...GIT_CONFIGS]) {
    savedGitEnv.set(name, process.env[name]);
    Reflect.deleteProperty(process.env, name);
  }
  for (const name of GIT_CONFIGS) {
    process.env[name] = devNull;
  }
}

function restoreGitEnv(): void {
  for (const [name, value] of savedGitEnv) {
    Reflect.deleteProperty(process.env, name);
    if (value !== undefined) {
      process.env[name] = value;
    }
  }
  savedGitEnv.clear();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-config-snapshot-"));
  vi.stubEnv("npm_config_user_agent", "");
  isolateGitEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  restoreGitEnv();
  rmSync(dir, { recursive: true, force: true });
});

function put(relative: string, contents: string): void {
  const full = join(dir, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

const CONFIG_FILE = ".storybook/storyshelf.json";

/** storyshelf.json contents → what loadStorybookConfig resolves (null when invalid). */
const LOAD_TABLE: Array<[string, unknown]> = [
  ["minimal", { slug: "demo" }],
  [
    "every key",
    {
      slug: "demo",
      url: "https://shelf.example.com",
      buildDir: "storybook-static",
      skip: "no UI change",
      affectedOnly: true,
      buildStats: false,
      untraced: ["**/*.md"],
      buildCommand: "pnpm build-storybook",
    },
  ],
  ["build script name", { slug: "demo", buildScriptName: "sb:build" }],
  ["with $schema and an unknown key", { $schema: "./x.json", slug: "demo", extra: 1 }],
  ["legacy affected object", { slug: "demo", affected: { enabled: true } }],
  ["missing slug", { url: "https://shelf.example.com" }],
  ["empty slug", { slug: "" }],
  ["slug that is not a string", { slug: 3 }],
  ["non-http url", { slug: "demo", url: "ftp://shelf.example.com" }],
  ["empty string field", { slug: "demo", buildDir: "" }],
  ["both build command and script", { slug: "demo", buildCommand: "a", buildScriptName: "b" }],
  ["non-boolean affectedOnly", { slug: "demo", affectedOnly: "yes" }],
  ["non-array untraced", { slug: "demo", untraced: "x" }],
  ["non-string untraced entry", { slug: "demo", untraced: ["a", 1] }],
  ["not an object", [1, 2]],
  ["null", null],
];

/** Partial config → the file writeStorybookConfig produces over an optional existing file. */
const WRITE_TABLE: Array<
  [string, StorybookConfig, unknown, { stampSchema?: boolean } | undefined]
> = [
  ["new file", { slug: "demo" }, undefined, undefined],
  [
    "merges over an existing file",
    { slug: "demo", url: "https://s.example.com" },
    { slug: "old", buildDir: "out" },
    undefined,
  ],
  [
    "keeps an existing $schema",
    { slug: "demo" },
    { $schema: "./keep.json", slug: "old" },
    undefined,
  ],
  [
    "stamps a fresh $schema",
    { slug: "demo" },
    { $schema: "./old.json", slug: "old" },
    { stampSchema: true },
  ],
];

const MAIN_TABLE: Array<[string, string]> = [
  [
    "framework, addons, stories and staticDirs",
    `export default {
  stories: ["../src/**/*.stories.tsx", '../docs/*.mdx'],
  addons: ["@storybook/addon-a11y", '@storybook/addon-docs'],
  staticDirs: ["../public"],
  framework: { name: "@storybook/react-vite", options: {} },
};`,
  ],
  ["framework only", `export default { framework: { name: '@storybook/html-vite' } };`],
  ["no lists", `export default {};`],
  ["empty lists", `export default { stories: [], addons: [] };`],
];

describe("config resolution", () => {
  it.each(LOAD_TABLE)("loads %s", async (_name, contents) => {
    put(CONFIG_FILE, JSON.stringify(contents));
    expect(await loadStorybookConfig(dir)).toMatchSnapshot();
  });

  it("loads null for a missing file, for invalid JSON and from an explicit path", async () => {
    expect(await loadStorybookConfig(dir)).toBeNull();
    put(CONFIG_FILE, "{ not json");
    expect(await loadStorybookConfig(dir)).toBeNull();
    put("custom/sb.json", JSON.stringify({ slug: "custom" }));
    expect(await loadStorybookConfig(dir, "custom/sb.json")).toMatchSnapshot();
  });

  it.each(WRITE_TABLE)("writes %s", async (_name, config, existing, options) => {
    if (existing !== undefined) {
      put(CONFIG_FILE, JSON.stringify(existing));
    }
    const written = await writeStorybookConfig(config, dir, undefined, options);
    const text = (await readFile(written, "utf8")).replaceAll(/"\$schema": "[^"]*"/gu, (match) =>
      // The stamped reference depends on where the CLI is installed: pin its shape, not its value.
      match.includes("keep.json") ? match : '"$schema": "<stamped>"',
    );
    expect({ path: written.replace(dir, "<dir>"), text }).toMatchSnapshot();
  });

  it("refuses to write an invalid merged config", async () => {
    await expect(writeStorybookConfig({ slug: "" }, dir)).rejects.toThrow(
      /Invalid storybook config/u,
    );
  });

  it("builds schema references from version and module location", () => {
    const remote = { moduleUrl: "file:///nowhere/dist/config.mjs" };
    expect({
      versioned: schemaReference(dir, { ...remote, version: "1.2.3" }),
      unversioned: schemaReference(dir, remote),
      badModule: schemaReference(dir, { moduleUrl: "not a url", version: "9.9.9" }),
    }).toMatchSnapshot();
  });

  it("points the default $schema at the schema file shipped in the CLI package", () => {
    // Resolved from this module's own location, so it must not move when the module is split.
    const reference = schemaReference(dir);
    expect(reference.startsWith(".")).toBe(true);
    expect(resolve(dir, reference)).toBe(
      fileURLToPath(new URL("../schema/storyshelf-config.json", import.meta.url)),
    );
    expect(existsSync(resolve(dir, reference))).toBe(true);
  });

  it.each(MAIN_TABLE)("reads Storybook metadata from %s", async (_name, source) => {
    put("packages/web/.storybook/main.ts", source);
    expect(await detectStorybookMeta(join(dir, "packages/web"))).toMatchSnapshot();
  });

  it("locates main.* by candidate order and reports the package path", async () => {
    expect(await findStorybookMain(dir)).toBeNull();
    expect(await detectStorybookMeta(dir)).toEqual({ packagePath: "." });
    put("apps/site/.storybook/main.mjs", "export default {};");
    put("apps/site/.storybook/main.js", "export default {};");
    expect((await findStorybookMain(join(dir, "apps/site")))?.replace(dir, "<dir>")).toBe(
      "<dir>/apps/site/.storybook/main.js",
    );
    // The path from the project root to the directory holding main.*, "." when there is none.
    expect(await detectPackagePath(join(dir, "apps/site"))).toBe(".storybook");
    expect(await detectPackagePath(dir)).toBe(".");
  });

  it("reads the package name", async () => {
    expect(await detectPackageName(dir)).toBeNull();
    put("package.json", JSON.stringify({ name: "@acme/web" }));
    expect(await detectPackageName(dir)).toBe("@acme/web");
    put("package.json", JSON.stringify({ name: "" }));
    expect(await detectPackageName(dir)).toBeNull();
  });
});

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

describe("git detection", () => {
  it.each([
    "git@github.com:acme/shelf.git",
    "git@gitlab.example.com:group/sub.git",
    "https://github.com/acme/shelf.git",
    "https://github.com/acme/shelf",
    "ssh://git@github.com/acme/shelf.git",
  ])("normalizes the origin %s", (url) => {
    git("init", "-q");
    git("remote", "add", "origin", url);
    expect(detectGitRepository(dir)).toMatchSnapshot();
  });

  it("is null outside a repository or without an origin", () => {
    git("init", "-q");
    expect(detectGitRepository(dir)).toBeNull();
    expect(detectGitDefaultBranch(dir)).toBeNull();
  });

  it("reads the default branch from origin/HEAD", () => {
    git("init", "-q");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    expect(detectGitDefaultBranch(dir)).toBe("trunk");
  });
});

describe("package runner", () => {
  it.each(["npm", "pnpm", "yarn", "bun", "nub"] satisfies PackageRunner[])(
    "has install and start commands for %s",
    (runner) => {
      expect({ install: installCommand(runner), start: startCommand(runner) }).toMatchSnapshot();
    },
  );

  const LOCKFILES: Array<[string, string]> = [
    ["nub.lock", "nub"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];

  it.each(LOCKFILES)("detects the runner from %s", async (file, runner) => {
    put(file, "");
    expect(await detectPackageRunner(dir)).toBe(runner);
  });

  it("orders its evidence: agent, then packageManager, then lockfiles, then npm", async () => {
    expect(await detectPackageRunner(dir)).toBe("npm");
    put("yarn.lock", "");
    expect(await detectPackageRunner(dir)).toBe("yarn");
    put("package.json", JSON.stringify({ packageManager: "pnpm@9.1.0" }));
    expect(await detectPackageRunner(dir)).toBe("pnpm");
    vi.stubEnv("npm_config_user_agent", "bun/1.2.0 npm/? node/v24");
    expect(await detectPackageRunner(dir)).toBe("bun");
    vi.stubEnv("npm_config_user_agent", "deno/2.0");
    expect(await detectPackageRunner(dir)).toBe("pnpm");
  });
});
