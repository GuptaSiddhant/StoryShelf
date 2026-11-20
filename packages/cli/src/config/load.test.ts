import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStorybookMain,
  findStorybookMain,
  loadStorybookConfig,
  writeStorybookConfig,
} from "./load.ts";

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

  it("loads the affectedOnly flag", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", affectedOnly: false }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      affectedOnly: false,
    });
  });

  it("returns null for a non-boolean affectedOnly", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", affectedOnly: "yes" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("loads the skipUnchanged flag and rejects a non-boolean", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    const file = join(dir, ".storybook", "storyshelf.json");
    writeFileSync(file, JSON.stringify({ slug: "demo", skipUnchanged: true }));
    await expect(loadStorybookConfig(dir)).resolves.toEqual({ slug: "demo", skipUnchanged: true });
    writeFileSync(file, JSON.stringify({ slug: "demo", skipUnchanged: "yes" }));
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("loads the buildStats flag and rejects a non-boolean", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    const file = join(dir, ".storybook", "storyshelf.json");
    writeFileSync(file, JSON.stringify({ slug: "demo", buildStats: false }));
    await expect(loadStorybookConfig(dir)).resolves.toEqual({ slug: "demo", buildStats: false });
    writeFileSync(file, JSON.stringify({ slug: "demo", buildStats: "no" }));
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("loads the untraced list", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", untraced: ["**/*.generated.ts"] }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      untraced: ["**/*.generated.ts"],
    });
  });

  it("returns null for a non-array untraced", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", untraced: "**/*.ts" }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("returns null for a non-string untraced entry", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", untraced: ["**/*.ts", 42] }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toBeNull();
  });

  it("strips the legacy affected object", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", affected: { untraced: ["**/*.ts"] } }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({ slug: "demo" });
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
