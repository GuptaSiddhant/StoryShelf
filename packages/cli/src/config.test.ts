import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertStorybookMain,
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectStorybookMeta,
  findStorybookMain,
  loadStorybookConfig,
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
});

afterEach(() => {
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
      JSON.stringify({ slug: "demo", url: "https://shelf.example.com", buildDir: "dist-storybook" }),
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

  it("maps the deprecated storybookDir to buildDir", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", storybookDir: "old-dir" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({ slug: "demo", buildDir: "old-dir" });
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
