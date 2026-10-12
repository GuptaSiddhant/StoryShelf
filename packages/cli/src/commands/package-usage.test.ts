import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPackageUsage } from "./package-usage.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ss-usage-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function writeStorybook(modules: unknown[]): void {
  const buildDir = join(dir, "storybook-static");
  writeJson(join(buildDir, "index.json"), {
    entries: { a: { id: "a", importPath: "src/Card.stories.tsx" } },
  });
  writeJson(join(buildDir, "preview-stats.json"), { modules });
}

const options = () => ({ cwd: dir, buildDir: "storybook-static" });

describe("collectPackageUsage", () => {
  it("records installed version for a node_modules package (separate repos)", async () => {
    writeJson(join(dir, "package.json"), { dependencies: { "@acme/ds": "^2.0.0", react: "18" } });
    writeJson(join(dir, "node_modules/@acme/ds/package.json"), { version: "2.4.0" });
    writeStorybook([
      {
        id: "src/Card.stories.tsx",
        importedIds: ["src/Card.tsx"],
      },
      { id: "src/Card.tsx", importedIds: ["node_modules/@acme/ds/dist/Button.js"] },
    ]);
    expect(await collectPackageUsage(options())).toEqual([
      {
        storyImportPath: "src/Card.stories.tsx",
        packageName: "@acme/ds",
        modulePath: "node_modules/@acme/ds/dist/Button.js",
        version: "2.4.0",
      },
    ]);
  });

  it("matches a workspace-linked package by its real source directory (monorepo)", async () => {
    writeJson(join(dir, "package.json"), { dependencies: { "@acme/ds": "workspace:*" } });
    writeJson(join(dir, "packages/ds/package.json"), { version: "3.1.0" });
    mkdirSync(join(dir, "node_modules/@acme"), { recursive: true });
    symlinkSync(join(dir, "packages/ds"), join(dir, "node_modules/@acme/ds"));
    writeStorybook([{ id: "src/Card.stories.tsx", importedIds: ["packages/ds/src/Button.tsx"] }]);
    expect(await collectPackageUsage(options())).toEqual([
      {
        storyImportPath: "src/Card.stories.tsx",
        packageName: "@acme/ds",
        modulePath: "packages/ds/src/Button.tsx",
        version: "3.1.0",
      },
    ]);
  });

  it("finds hoisted installs above the working directory", async () => {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeJson(join(dir, "app/package.json"), { devDependencies: { "@acme/ds": "*" } });
    writeJson(join(dir, "node_modules/@acme/ds/package.json"), { version: "1.0.0" });
    writeJson(join(dir, "app/storybook-static/index.json"), {
      entries: { a: { id: "a", importPath: "src/Card.stories.tsx" } },
    });
    writeJson(join(dir, "app/storybook-static/preview-stats.json"), {
      modules: [
        {
          id: "src/Card.stories.tsx",
          importedIds: ["../node_modules/@acme/ds/dist/Button.js"],
        },
      ],
    });
    const usage = await collectPackageUsage({
      cwd: join(dir, "app"),
      buildDir: "storybook-static",
    });
    expect(usage[0]).toMatchObject({ packageName: "@acme/ds", version: "1.0.0" });
  });

  it("returns nothing without declared dependencies, stats, or an index", async () => {
    expect(await collectPackageUsage(options())).toEqual([]);
    writeJson(join(dir, "package.json"), { dependencies: { react: "18" } });
    expect(await collectPackageUsage(options())).toEqual([]);
  });

  it("keeps a package with a null version when it is not installed", async () => {
    writeJson(join(dir, "package.json"), { dependencies: { "@acme/ds": "*" } });
    writeStorybook([
      { id: "src/Card.stories.tsx", importedIds: ["node_modules/@acme/ds/dist/Button.js"] },
    ]);
    expect((await collectPackageUsage(options()))[0]?.version).toBeNull();
  });
});
