import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { managerEntries } from "./preset.ts";
import { isLegacyStorybook } from "./storybook-version.ts";

async function projectWith(version: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "addon-preset-"));
  if (version !== null) {
    const pkg = join(dir, "node_modules", "storybook");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "storybook", version }));
  }
  return dir;
}

describe("isLegacyStorybook", () => {
  it("is true for 8.x and false for 9 and later", async () => {
    expect(isLegacyStorybook(await projectWith("8.6.19"))).toBe(true);
    expect(isLegacyStorybook(await projectWith("9.1.21"))).toBe(false);
    expect(isLegacyStorybook(await projectWith("10.6.5"))).toBe(false);
  });

  it("assumes a current Storybook when it cannot tell", async () => {
    expect(isLegacyStorybook(await projectWith(null))).toBe(false);
  });
});

describe("managerEntries", () => {
  it("adds the modern manager file after the entries already there", async () => {
    const entries = managerEntries(["other.js"], { configDir: await projectWith("9.1.21") });
    expect(entries[0]).toBe("other.js");
    expect(entries[1]).toMatch(/[\\/]manager\.(?:mjs|ts)$/u);
    expect(entries[1]).not.toMatch(/legacy/u);
  });

  it("adds the legacy manager file for Storybook 8", async () => {
    const [entry] = managerEntries([], { configDir: await projectWith("8.6.19") });
    expect(entry).toMatch(/legacy[\\/]manager\.mjs$/u);
  });

  it("works without arguments", () => {
    expect(managerEntries()).toHaveLength(1);
  });
});
