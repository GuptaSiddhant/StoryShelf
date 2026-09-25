import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStorybookConfig, schemaReference, writeStorybookConfig } from "./config.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-schema-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

/** Config keys the parser accepts (mirrors `StorybookConfig`). */
const CONFIG_KEYS = [
  "slug",
  "url",
  "buildDir",
  "buildCommand",
  "buildScriptName",
  "skip",
  "affectedOnly",
  "untraced",
] as const;

async function loadSchema(): Promise<{
  required: unknown;
  properties: Record<string, { type?: unknown }>;
  additionalProperties: unknown;
}> {
  const schemaPath = fileURLToPath(new URL("../schema/storyshelf-config.json", import.meta.url));
  const raw = await readFile(schemaPath, "utf8");
  return JSON.parse(raw) as {
    required: unknown;
    properties: Record<string, { type?: unknown }>;
    additionalProperties: unknown;
  };
}

function configRoot(): string {
  return join(dir, "proj", ".storybook");
}

/** Normalize separators for cross-platform path assertions. */
function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("storyshelf-config.json parity", () => {
  it("covers every StorybookConfig key with matching types", async () => {
    const schema = await loadSchema();
    expect(schema.required).toEqual(["slug"]);
    expect(schema.additionalProperties).toBe(true);
    for (const key of CONFIG_KEYS) {
      expect(schema.properties[key], `missing schema property: ${key}`).toBeDefined();
    }
    expect(schema.properties["slug"]?.type).toBe("string");
    expect(schema.properties["url"]?.type).toBe("string");
    expect(schema.properties["affectedOnly"]?.type).toBe("boolean");
    expect(schema.properties["untraced"]?.type).toBe("array");
  });

  it("parses the documented example shape", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({
        slug: "demo",
        url: "https://shelf.example.com",
        buildDir: "storybook-static",
        affectedOnly: true,
        untraced: ["**/*.generated.ts"],
      }),
    );
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
      buildDir: "storybook-static",
      affectedOnly: true,
      untraced: ["**/*.generated.ts"],
    });
  });
});

describe("schemaReference", () => {
  function fakeInstall(): { moduleUrl: string; configDir: string } {
    const distFile = join(dir, "fake-cli", "dist", "config.js");
    mkdirSync(join(dir, "fake-cli", "dist"), { recursive: true });
    mkdirSync(join(dir, "fake-cli", "schema"), { recursive: true });
    writeFileSync(distFile, "export {};\n");
    writeFileSync(join(dir, "fake-cli", "schema", "storyshelf-config.json"), "{}\n");
    mkdirSync(configRoot(), { recursive: true });
    return { moduleUrl: pathToFileURL(distFile).href, configDir: configRoot() };
  }

  it("prefers a path relative to the config directory", () => {
    const { moduleUrl, configDir } = fakeInstall();
    const expected = toPosix(
      relative(configDir, join(dir, "fake-cli", "schema", "storyshelf-config.json")),
    );
    const ref = schemaReference(configDir, { moduleUrl });
    expect(ref).toBe(expected.startsWith(".") ? expected : `./${expected}`);
    expect(ref.endsWith("schema/storyshelf-config.json")).toBe(true);
  });

  it("falls back to a versioned unpkg URL without a local schema", () => {
    mkdirSync(configRoot(), { recursive: true });
    const missing = pathToFileURL(join(dir, "nowhere", "dist", "config.js")).href;
    expect(schemaReference(configRoot(), { moduleUrl: missing, version: "1.2.3" })).toBe(
      "https://unpkg.com/storyshelf@1.2.3/schema/storyshelf-config.json",
    );
  });

  it("falls back to the unversioned URL without a known version", () => {
    vi.stubGlobal("__PKG_VERSION__", "0.0.0");
    mkdirSync(configRoot(), { recursive: true });
    const missing = pathToFileURL(join(dir, "nowhere", "dist", "config.js")).href;
    expect(schemaReference(configRoot(), { moduleUrl: missing })).toBe(
      "https://unpkg.com/storyshelf/schema/storyshelf-config.json",
    );
  });
});

describe("writeStorybookConfig $schema handling", () => {
  async function readRaw(): Promise<Record<string, unknown>> {
    const raw = await readFile(join(dir, ".storybook", "storyshelf.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it("stamps $schema on request", async () => {
    await writeStorybookConfig({ slug: "demo" }, dir, undefined, { stampSchema: true });
    const raw = await readRaw();
    expect(typeof raw["$schema"]).toBe("string");
    expect(String(raw["$schema"])).toContain("schema/storyshelf-config.json");
    await expect(loadStorybookConfig(dir)).resolves.toEqual({ slug: "demo" });
  });

  it("preserves an existing $schema without stamping", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ $schema: "https://example.com/schema.json", slug: "demo" }),
    );
    await writeStorybookConfig({ slug: "demo", url: "https://shelf.example.com" }, dir);
    expect(await readRaw()).toMatchObject({
      $schema: "https://example.com/schema.json",
      slug: "demo",
    });
  });

  it("adds no $schema when absent and unstamped", async () => {
    await writeStorybookConfig({ slug: "demo" }, dir);
    expect(await readRaw()).toEqual({ slug: "demo" });
  });
});
