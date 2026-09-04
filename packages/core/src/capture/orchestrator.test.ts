import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { builds, snapshots } from "../schema-tables.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { makeDatabase, makeStorage } from "./fake-adapters.ts";
import { executeCaptureJob } from "./orchestrator.ts";

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

function fakeRunner(overrides: Partial<CaptureRunner> = {}): { runner: CaptureRunner; render: ReturnType<typeof vi.fn> } {
  const result: RenderResult = {
    captures: [
      {
        story: { id: STORY_ID, title: "Components/Button", name: "Primary", importPath: "./Button.stories.tsx", type: "story" },
        viewportName: "desktop",
        screenshot: Buffer.from([0, 1, 2]),
      },
    ],
    failures: [],
  };
  const render = overrides.render ?? vi.fn(async () => {
    await Promise.resolve();
    return result;
  });
  const cancel = overrides.cancel ?? vi.fn(async () => {
    await Promise.resolve();
  });
  const runner: CaptureRunner = { render, cancel };
  return { runner, render: render as ReturnType<typeof vi.fn> };
}

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-orch-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

describe("executeCaptureJob", () => {
  it("loads the target, extracts, renders, and persists the capture end to end", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db).create({ name: "Orchestrator" });
    const build = await new BuildModel(db).create(project.id, { gitSha: "sha-abc", gitBranch: "main", isDefault: true });
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const { runner, render } = fakeRunner();

    await executeCaptureJob(
      { buildId: build.id },
      { db, storage, runner, scratchDir },
    );

    const updatedBuild = await db.get(builds, build.id);
    expect(updatedBuild?.status).toBe("approved");
    expect(render).toHaveBeenCalledTimes(1);
    const rows = await db.list(snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["Primary"]);
  });

  it("marks the build failed when the renderer rejects", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db).create({ name: "Orchestrator" });
    const build = await new BuildModel(db).create(project.id, { gitSha: "sha-abc", gitBranch: "main" });
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const { runner } = fakeRunner({
      render: vi.fn(async () => {
        await Promise.resolve();
        throw new Error("browser exploded");
      }),
    });

    await expect(executeCaptureJob({ buildId: build.id }, { db, storage, runner, scratchDir })).rejects.toThrow(
      "browser exploded",
    );

    const updatedBuild = await db.get(builds, build.id);
    expect(updatedBuild?.status).toBe("failed");
  });

  it("throws when the build does not exist", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await expect(executeCaptureJob({ buildId: "missing" }, { db, storage, runner: fakeRunner().runner, scratchDir })).rejects.toThrow(
      "Build not found",
    );
  });
});
