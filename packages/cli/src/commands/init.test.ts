import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStorybookConfig } from "../config.ts";
import { runInit } from "./init.ts";

let dir: string;

function setupStorybook(): void {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(join(dir, ".storybook", "main.ts"), "export default {};\n");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-init-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  it("fails without a storybook setup", async () => {
    await expect(runInit({ cwd: dir })).rejects.toThrow(".storybook/main.* not found");
  });

  it("writes the config when url and slug are provided", async () => {
    setupStorybook();
    await runInit({
      url: "https://shelf.example.com",
      slug: "demo",
      buildDir: "dist-storybook",
      cwd: dir,
    });
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
      buildDir: "dist-storybook",
    });
  });

  it("merges with an existing config", async () => {
    setupStorybook();
    await runInit({ url: "https://a.example.com", slug: "demo", cwd: dir });
    await runInit({ url: "https://b.example.com", slug: "demo", cwd: dir });
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://b.example.com",
    });
  });

  // NOTE: the missing-slug path prompts interactively and is not covered here.
});
