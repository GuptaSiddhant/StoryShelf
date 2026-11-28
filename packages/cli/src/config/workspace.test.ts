import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceStorybooks, monorepoHint, pnpmPackages } from "./workspace.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-workspace-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A workspace package at `rel` with a Storybook main file. */
function storybookAt(rel: string): void {
  mkdirSync(join(dir, rel, ".storybook"), { recursive: true });
  writeFileSync(join(dir, rel, ".storybook", "main.ts"), "export default {};\n");
}

function rootPackageJson(workspaces: unknown): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root", workspaces }));
}

describe("pnpmPackages", () => {
  it("reads the quoted and bare items under packages:", () => {
    const yaml = [
      "packages:",
      '  - "apps/*"',
      "  - packages/ui",
      "  - '!packages/old'",
      "",
      "onlyBuiltDependencies:",
      "  - esbuild",
    ].join("\n");
    expect(pnpmPackages(yaml)).toEqual(["apps/*", "packages/ui", "!packages/old"]);
  });
});

describe("findWorkspaceStorybooks", () => {
  it("finds a package under a package.json workspace glob", async () => {
    rootPackageJson(["packages/*"]);
    storybookAt("packages/ui");
    mkdirSync(join(dir, "packages", "api"), { recursive: true });
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual(["packages/ui"]);
  });

  it("reads the packages list of an object-form workspaces field", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ workspaces: { packages: ["libs/*"] } }),
    );
    storybookAt("libs/kit");
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual(["libs/kit"]);
  });

  it("finds a package named by pnpm-workspace.yaml, with no package.json at all", async () => {
    writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/app"\n');
    storybookAt("packages/app");
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual(["packages/app"]);
  });

  it("does not crawl a glob deeper than one level", async () => {
    rootPackageJson(["apps/**"]);
    storybookAt("apps/web");
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual([]);
  });

  it("skips node_modules and hidden directories under a glob", async () => {
    rootPackageJson(["packages/*"]);
    storybookAt("packages/.cache");
    storybookAt("packages/node_modules");
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual([]);
  });

  it("returns nothing when the root declares no workspace", async () => {
    storybookAt("packages/ui");
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual([]);
  });

  it("ignores a package.json that is not valid JSON", async () => {
    writeFileSync(join(dir, "package.json"), "{ not json");
    await expect(findWorkspaceStorybooks(dir)).resolves.toEqual([]);
  });
});

describe("monorepoHint", () => {
  it("names the one package to run from, and points at the CI working-directory", async () => {
    rootPackageJson(["packages/*"]);
    storybookAt("packages/ui");
    const hint = await monorepoHint(dir);
    expect(hint).toContain("found packages/ui/.storybook: run this from packages/ui");
    expect(hint).toContain("working-directory");
    expect(hint).toContain("Storybook in a monorepo package");
  });

  it("lists every package when more than one holds a Storybook", async () => {
    rootPackageJson(["packages/*"]);
    storybookAt("packages/ui");
    storybookAt("packages/app");
    const hint = await monorepoHint(dir);
    expect(hint).toContain("found packages/app/.storybook, packages/ui/.storybook");
    expect(hint).toContain("the package you upload");
  });

  it("is undefined when no workspace package has a Storybook", async () => {
    rootPackageJson(["packages/*"]);
    await expect(monorepoHint(dir)).resolves.toBeUndefined();
  });
});
