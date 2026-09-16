import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStorybookMain,
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectPackageRunner,
  detectStorybookMeta,
  findStorybookMain,
  installCommand,
  loadStorybookConfig,
  startCommand,
  writeStorybookConfig,
} from "./config.ts";

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

describe("findStorybookMain", () => {
  it("finds main.ts in an empty project", async () => {
    writeMain();
    await expect(findStorybookMain(dir)).resolves.toBe(join(dir, ".storybook", "main.ts"));
  });

  it("returns null without a storybook setup", async () => {
    await expect(findStorybookMain(dir)).resolves.toBeNull();
  });
});

describe("assertStorybookMain", () => {
  it("throws without a storybook setup", async () => {
    await expect(assertStorybookMain(dir)).rejects.toThrow(".storybook/main.* not found");
  });

  it("passes with a storybook setup", async () => {
    writeMain();
    await expect(assertStorybookMain(dir)).resolves.toBeUndefined();
  });
});

describe("loadStorybookConfig", () => {
  it("returns null when no config exists", async () => {
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("loads a valid config", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({
        slug: "demo",
        url: "https://shelf.example.com",
        buildDir: "dist-storybook",
      }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
      buildDir: "dist-storybook",
    });
  });

  it("returns null for invalid JSON", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(join(dir, ".storybook", "storyshelf.json"), "{not json");
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("returns null when the slug is missing", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ url: "https://shelf.example.com" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("returns null for a non-http URL", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", url: "not a url" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("returns null for empty-string fields", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", buildDir: "" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("returns null when buildCommand and buildScriptName are both set", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", buildCommand: "a", buildScriptName: "b" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("strips unknown keys", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", future: "x" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({ slug: "demo" });
  });
});

describe("writeStorybookConfig", () => {
  it("round-trips a config", async () => {
    const written = await writeStorybookConfig(
      { slug: "demo", url: "https://shelf.example.com" },
      dir,
    );
    expect(written).toBe(join(dir, ".storybook", "storyshelf.json"));
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
    });
  });

  it("merges with an existing config", async () => {
    await writeStorybookConfig({ slug: "demo", buildDir: "keep-me" }, dir);
    await writeStorybookConfig({ slug: "demo", url: "https://shelf.example.com" }, dir);
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
      buildDir: "keep-me",
    });
  });

  it("throws for an invalid config", async () => {
    await expect(writeStorybookConfig({ slug: "" }, dir)).rejects.toThrow(
      "Invalid storybook config",
    );
  });
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
    ["deno@2.0.0", "deno"],
    ["nub@0.7.5", "nub"],
  ])("reads the packageManager field %s as %s", async (field, expected) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: field }));
    await expect(detectPackageRunner(dir)).resolves.toBe(expected);
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
    ["deno.lock", "deno"],
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
    ["deno", "deno install", "deno task start"],
    ["nub", "nub install", "nub run start"],
  ] as const)("maps %s to install/start commands", (runner, install, start) => {
    expect(installCommand(runner)).toBe(install);
    expect(startCommand(runner)).toBe(start);
  });
});
