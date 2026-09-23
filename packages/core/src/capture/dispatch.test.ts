import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baselines,
  buildLabels,
  builds,
  captureAttempts,
  captureLogs,
  projects,
  projectStatusConfigs,
  snapshots,
} from "../../../db-sqlite/src/schema/index.ts";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import { createShelfLogger } from "../logger.ts";
import { BuildModel } from "../models/build.ts";
import { CaptureAttemptModel } from "../models/capture-attempt.ts";
import { CaptureLogModel } from "../models/capture-log.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { createDispatchJob, type DispatchDeps } from "./dispatch.ts";

function tables() {
  return {
    projects: projects as unknown as never,
    builds: builds as unknown as never,
    buildLabels: buildLabels as unknown as never,
    snapshots: snapshots as unknown as never,
    baselines: baselines as unknown as never,
    projectStatusConfigs: projectStatusConfigs as unknown as never,
    captureAttempts: captureAttempts as unknown as never,
    captureLogs: captureLogs as unknown as never,
  };
}

function zipWithIndex(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 4,
        entries: {
          "s-1": {
            id: "s-1",
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

function fakeRunner(render: CaptureRunner["render"]): CaptureRunner {
  return {
    metadata: { name: "Fake Runner", version: "0.0.0", kind: "fake", category: "capture-runner" },
    render,
    cancel: async () => {},
  };
}

function successRender(): CaptureRunner["render"] {
  return vi.fn(async () => {
    await Promise.resolve();
    return {
      captures: [
        {
          story: {
            id: "s-1",
            title: "Components/Button",
            name: "Primary",
            importPath: "./Button.stories.tsx",
            type: "story" as const,
          },
          viewportName: "desktop",
          screenshot: Buffer.from([0, 1, 2]),
        },
      ],
      failures: [],
    };
  });
}

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-dispatch-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function seedBuild(db: ReturnType<typeof makeDatabase>["db"]) {
  const project = await new ProjectModel(db, tables()).create({ name: "Dispatch" });
  const build = await new BuildModel(db, tables()).create(project.id, {
    gitSha: "sha-1",
    gitBranch: "feature/x",
  });
  return { project, build };
}

function depsFor(
  db: ReturnType<typeof makeDatabase>["db"],
  storage: ReturnType<typeof makeStorage>["storage"],
  runner: CaptureRunner,
): DispatchDeps {
  return {
    db,
    tables: tables(),
    jobOptions: {
      db,
      tables: tables(),
      storage,
      runner,
      scratchDir,
      logger: createShelfLogger({ level: "silent" }),
    },
    gitHosts: [],
    secret: undefined,
    logger: createShelfLogger({ level: "silent" }),
  };
}

describe("createDispatchJob attempt history", () => {
  it("records one completed attempt with logs per run", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const runJob = createDispatchJob(depsFor(db, storage, fakeRunner(successRender())));

    await runJob({ buildId: build.id, reqId: "req-1" });
    await runJob({ buildId: build.id, reqId: "req-2" });

    const attempts = await new CaptureAttemptModel(db, tables()).listByBuild(build.id);
    expect(attempts.map((row) => row.attemptNo)).toEqual([1, 2]);
    expect(attempts.every((row) => row.status === "completed")).toBe(true);
    expect(attempts[0]?.reqId).toBe("req-1");
    expect(attempts[0]?.storyCount).toBe(1);

    const logs = new CaptureLogModel(db, tables());
    const first = await logs.listByAttempt(attempts[0]?.id ?? "");
    const second = await logs.listByAttempt(attempts[1]?.id ?? "");
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first.map((row) => row.message)).toContain("capture completed");
    expect(first.map((row) => row.seq)).toEqual(first.map((_, index) => index + 1));
  });

  it("records a failed attempt with the full error text", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { project, build } = await seedBuild(db);
    await storage.write(storybookZipPath(project.id, build.id), zipWithIndex());
    const render = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("renderer exploded");
    });
    const runJob = createDispatchJob(depsFor(db, storage, fakeRunner(render)));

    await expect(runJob({ buildId: build.id })).rejects.toThrow("renderer exploded");

    const attempts = await new CaptureAttemptModel(db, tables()).listByBuild(build.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.error).toContain("renderer exploded");
    const logs = await new CaptureLogModel(db, tables()).listByAttempt(attempts[0]?.id ?? "");
    expect(logs.map((row) => row.message)).toContain("capture failed");
  });
});
