import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { storybookDir, storybookZipPath } from "../utils/paths.ts";
import { executeCaptureJob } from "./orchestrator.ts";

function tables(db: DatabaseAdapter) {
  return {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    baselines: db.tables.baselines,
    projects: db.tables.projects,
    captureAttempts: db.tables.captureAttempts,
    captureLogs: db.tables.captureLogs,
  };
}

const STORY_ID = "components-button--primary";

function zipWithIndex(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 4,
        entries: {
          [STORY_ID]: {
            id: STORY_ID,
            name: "Primary",
            title: "Components/Button",
            importPath: "./Button.stories.tsx",
            type: "story",
          },
        },
      }),
    ),
  );
  return zip.toBuffer();
}

function pngBytes(): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, Buffer.alloc(100)]);
}

function fakeRunner(overrides: Partial<CaptureRunner> = {}): {
  runner: CaptureRunner;
  render: ReturnType<typeof vi.fn>;
} {
  const result: RenderResult = {
    captures: [
      {
        story: {
          id: STORY_ID,
          title: "Components/Button",
          name: "Primary",
          importPath: "./Button.stories.tsx",
          type: "story",
        },
        viewportName: "desktop",
        screenshot: pngBytes(),
      },
    ],
    failures: [],
  };
  const render =
    overrides.render ??
    vi.fn(async () => {
      await Promise.resolve();
      return result;
    });
  const cancel =
    overrides.cancel ??
    vi.fn(async () => {
      await Promise.resolve();
    });
  const runner: CaptureRunner = {
    metadata: { name: "Fake Runner", version: "0.0.0", kind: "fake", category: "capture-runner" },
    render,
    cancel,
  };
  return { runner, render: render as ReturnType<typeof vi.fn> };
}

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-orch-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function setupBrowsers(projectPatch: Record<string, unknown>): Promise<{
  db: DatabaseAdapter;
  buildId: string;
  render: ReturnType<typeof vi.fn>;
  options: Parameters<typeof executeCaptureJob>[1];
}> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db, tables(db)).create({ name: "Browsers" });
  await db.update(db.tables.projects, project.id, projectPatch);
  const build = await new BuildModel(db, tables(db)).create(project.id, {
    gitSha: "sha-browsers",
    gitBranch: "main",
    isDefault: true,
  });
  await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
  const { runner, render } = fakeRunner();
  return {
    db,
    buildId: build.id,
    render,
    options: { db, tables: tables(db), storage, runner, scratchDir },
  };
}

describe("executeCaptureJob", () => {
  it("loads the target, extracts, renders, and persists the capture end to end", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, tables(db)).create({ name: "Orchestrator" });
    const build = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: "sha-abc",
      gitBranch: "main",
      isDefault: true,
    });
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const { runner, render } = fakeRunner();

    await executeCaptureJob(
      { buildId: build.id },
      { db, tables: tables(db), storage, runner, scratchDir },
    );

    const updatedBuild = await db.get(db.tables.builds, build.id);
    expect(updatedBuild?.status).toBe("approved");
    expect(render).toHaveBeenCalledTimes(1);
    const rows = await db.list(db.tables.snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["Primary"]);
  });

  describe("modes", () => {
    const MODES = { Dark: { theme: "dark" }, Wide: { viewport: 1600 } };
    const DEFAULT_EXTRACTED = { [STORY_ID]: { modes: MODES } };

    async function setup(
      projectPatch: Record<string, unknown> = {},
      extracted: Record<string, unknown> = DEFAULT_EXTRACTED,
    ): Promise<{
      db: DatabaseAdapter;
      buildId: string;
      render: ReturnType<typeof vi.fn>;
      options: Parameters<typeof executeCaptureJob>[1];
    }> {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const project = await new ProjectModel(db, tables(db)).create({ name: "Modes" });
      await db.update(db.tables.projects, project.id, projectPatch);
      const build = await new BuildModel(db, tables(db)).create(project.id, {
        gitSha: "sha-modes",
        gitBranch: "main",
        isDefault: true,
      });
      await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
      const base = fakeRunner();
      const runner: CaptureRunner = {
        ...base.runner,
        extractParameters: vi.fn(async () => {
          await Promise.resolve();
          return extracted as never;
        }),
      };
      return {
        db,
        buildId: build.id,
        render: base.render,
        options: { db, tables: tables(db), storage, runner, scratchDir },
      };
    }

    it("passes mode-enriched stories to the renderer", async () => {
      const { buildId, render, options } = await setup();
      await executeCaptureJob({ buildId }, options);
      const request = render.mock.calls[0]?.[0] as {
        stories: { parameters?: { modes?: unknown } }[];
      };
      expect(request.stories[0]?.parameters?.modes).toEqual(MODES);
    });

    it("applies the project's mode allowlist", async () => {
      const { buildId, render, options } = await setup({ modesAllowlist: '["dark"]' });
      await executeCaptureJob({ buildId }, options);
      const request = render.mock.calls[0]?.[0] as {
        stories: { parameters?: { modes?: unknown } }[];
      };
      expect(request.stories[0]?.parameters?.modes).toEqual({ Dark: { theme: "dark" } });
    });

    it("fails the build before rendering when a story exceeds the mode cap", async () => {
      const many = Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`m${i}`, { theme: `t${i}` }]),
      );
      const { db, buildId, render, options } = await setup({}, { [STORY_ID]: { modes: many } });
      await expect(executeCaptureJob({ buildId }, options)).rejects.toThrow(
        /expands to 10 captures/u,
      );
      expect(render).not.toHaveBeenCalled();
      expect((await new BuildModel(db, tables(db)).get(buildId))?.status).toBe("failed");
    });

    it("falls back to index parameters when extraction throws", async () => {
      const { buildId, render, options } = await setup();
      (options.runner as { extractParameters: unknown }).extractParameters = vi.fn(async () => {
        await Promise.resolve();
        throw new Error("no preview");
      });
      await executeCaptureJob({ buildId }, options);
      const request = render.mock.calls[0]?.[0] as { stories: { parameters?: unknown }[] };
      expect(request.stories[0]?.parameters).toBeUndefined();
    });
  });

  describe("browsers", () => {
    it("renders each engine sequentially and persists per-engine snapshots", async () => {
      const { db, buildId, render, options } = await setupBrowsers({
        browsers: '["chromium","firefox"]',
      });
      await executeCaptureJob({ buildId }, options);

      expect(render).toHaveBeenCalledTimes(2);
      const engines = render.mock.calls.map((call) => (call[0] as { browser: string }).browser);
      expect(engines).toEqual(["chromium", "firefox"]);
      const rows = await db.list(db.tables.snapshots);
      expect(rows.map((row) => row.browser)).toEqual(
        expect.arrayContaining(["chromium", "firefox"]),
      );
      expect(rows).toHaveLength(2);
    });

    it("fails the build for a browser the runner does not support", async () => {
      const { db, buildId, render, options } = await setupBrowsers({
        browsers: '["chromium","firefox"]',
      });
      (options.runner.metadata as { supportedBrowsers?: string[] }).supportedBrowsers = [
        "chromium",
      ];
      await expect(executeCaptureJob({ buildId }, options)).rejects.toThrow(/firefox/u);
      expect(render).not.toHaveBeenCalled();
      expect((await new BuildModel(db, tables(db)).get(buildId))?.status).toBe("failed");
    });

    it("rejects more than three engines", async () => {
      const { buildId, options } = await setupBrowsers({
        browsers: '["chromium","firefox","webkit","chrome"]',
      });
      await expect(executeCaptureJob({ buildId }, options)).rejects.toThrow(/At most 3/u);
    });
  });

  it("marks the build failed when the renderer rejects", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, tables(db)).create({ name: "Orchestrator" });
    const build = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: "sha-abc",
      gitBranch: "main",
    });
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const { runner } = fakeRunner({
      render: vi.fn(async () => {
        await Promise.resolve();
        throw new Error("browser exploded");
      }),
    });

    await expect(
      executeCaptureJob(
        { buildId: build.id },
        { db, tables: tables(db), storage, runner, scratchDir },
      ),
    ).rejects.toThrow("browser exploded");

    const updatedBuild = await db.get(db.tables.builds, build.id);
    expect(updatedBuild?.status).toBe("failed");
  });

  it("cancels the runner and fails the build when render times out", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, tables(db)).create({ name: "Orchestrator" });
    const build = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: "sha-abc",
      gitBranch: "main",
    });
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const cancel = vi.fn(async () => {
      await Promise.resolve();
    });
    const hanging = new Promise<RenderResult>(() => {});
    const { runner } = fakeRunner({
      render: vi.fn(async () => await hanging),
      cancel,
    });

    await expect(
      executeCaptureJob(
        { buildId: build.id },
        { db, tables: tables(db), storage, runner, scratchDir, renderTimeoutMs: 50 },
      ),
    ).rejects.toThrow("timed out");

    expect(cancel).toHaveBeenCalledWith(build.id);
    const timedOut = await db.get(db.tables.builds, build.id);
    expect(timedOut?.status).toBe("failed");
  });

  it("persists statics before render so preview survives render failure", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, tables(db)).create({ name: "Orchestrator" });
    const build = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: "sha-abc",
      gitBranch: "main",
    });
    const zip = new AdmZip();
    zip.addFile("iframe.html", Buffer.from("<html>preview</html>"));
    zip.addFile(
      "index.json",
      Buffer.from(
        JSON.stringify({
          v: 4,
          entries: {
            story: {
              id: "story",
              name: "Story",
              title: "Title",
              importPath: "./Story.stories.tsx",
              type: "story",
            },
          },
        }),
      ),
    );
    await storage.write(storybookZipPath(project.id, build.id), zip.toBuffer());
    const { runner } = fakeRunner({
      render: vi.fn(async () => {
        await Promise.resolve();
        throw new Error("browser exploded");
      }),
    });

    await expect(
      executeCaptureJob(
        { buildId: build.id },
        { db, tables: tables(db), storage, runner, scratchDir },
      ),
    ).rejects.toThrow("browser exploded");

    expect(await storage.exists(`${storybookDir(project.id, build.id)}/iframe.html`)).toBe(true);
    const failedBuild = await db.get(db.tables.builds, build.id);
    expect(failedBuild?.status).toBe("failed");
  });

  it("throws when the build does not exist", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await expect(
      executeCaptureJob(
        { buildId: "missing" },
        { db, tables: tables(db), storage, runner: fakeRunner().runner, scratchDir },
      ),
    ).rejects.toThrow("Build not found");
  });

  it("blocks path traversal in the streamed extract", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, tables(db)).create({ name: "Orchestrator" });
    const build = await new BuildModel(db, tables(db)).create(project.id, {
      gitSha: "sha-abc",
      gitBranch: "main",
    });
    const evil = new AdmZip();
    evil.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries: {} })));
    evil.addFile("placeholder.txt", Buffer.from("escape"));
    const evilEntry = evil.getEntries().find((entry) => entry.entryName === "placeholder.txt");
    if (!evilEntry) {
      throw new Error("test setup failed: placeholder entry missing");
    }
    // AdmZip sanitizes traversal on write; rename post-hoc to craft the attack.
    evilEntry.entryName = "../../evil.txt";
    await storage.write(storybookZipPath(project.id, build.id), evil.toBuffer());
    const { runner } = fakeRunner();

    await expect(
      executeCaptureJob(
        { buildId: build.id },
        { db, tables: tables(db), storage, runner, scratchDir },
      ),
    ).rejects.toThrow("path traversal");

    const updatedBuild = await db.get(db.tables.builds, build.id);
    expect(updatedBuild?.status).toBe("failed");
  });
});
