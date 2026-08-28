import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storybookZipPath, type BuildStatus, type DatabaseAdapter, type StorageAdapter } from "@storyshelf/core";
import { BuildModel } from "@storyshelf/core/models/build";
import { ProjectModel } from "@storyshelf/core/models/project";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";

import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

const playwright = vi.hoisted(() => {
  const pendingGotos: ((error: Error) => void)[] = [];
  let closed = false;
  const page = {
    goto: async (): Promise<void> => {
      if (closed) {
        throw new Error("Browser closed by cancel");
      }
      await new Promise<void>((_target, reject) => {
        pendingGotos.push(reject);
      });
    },
    waitForSelector: async (): Promise<unknown> => {
      await Promise.resolve();
      return null;
    },
    screenshot: async (): Promise<Buffer> => {
      await Promise.resolve();
      return Buffer.from([0]);
    },
    close: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
  const browser = {
    newPage: async (): Promise<typeof page> => {
      await Promise.resolve();
      return page;
    },
    close: async (): Promise<void> => {
      closed = true;
      for (const reject of pendingGotos.splice(0)) {
        reject(new Error("Browser closed by cancel"));
      }
      await Promise.resolve();
    },
  };
  return {
    browser,
    chromium: {
      launch: async (): Promise<typeof browser> => {
        closed = false;
        await Promise.resolve();
        return browser;
      },
    },
  };
});

vi.mock("playwright", () => ({ chromium: playwright.chromium }));

let tmp: string;
let dataDir: string;
let db: DatabaseAdapter;
let storage: StorageAdapter;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "storyshelf-cancel-"));
  dataDir = join(tmp, "data");
  await mkdir(dataDir, { recursive: true });
  db = createSqliteDatabase(join(tmp, "shelf.db"));
  await db.migrate();
  storage = createLocalStorage(dataDir);
});

afterEach(async () => {
  await db.close();
  await rm(tmp, { recursive: true, force: true });
});

async function seedBuild(): Promise<{ projectId: string; buildId: string }> {
  const project = await new ProjectModel(db).create({ name: "Cancel Smoke" });
  const build = await new BuildModel(db).create(project.id, { gitSha: "abc123", gitBranch: "main" });
  const zip = new AdmZip();
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        "v": 4,
        entries: {
          "components-button--primary": {
            id: "components-button--primary",
            name: "Primary",
            title: "Components/Button",
            importPath: "./Button.stories.tsx",
            type: "story",
          },
        },
      }),
    ),
  );
  await storage.write(storybookZipPath(project.id, build.id), zip.toBuffer());
  return { projectId: project.id, buildId: build.id };
}

async function waitForStatus(
  buildId: string,
  status: BuildStatus,
  deadline = Date.now() + 10_000,
): Promise<void> {
  const build = await new BuildModel(db).get(buildId);
  if (build?.status === status) {
    return;
  }
  if (Date.now() >= deadline) {
    throw new Error(`Timed out waiting for build ${buildId} to reach ${status}`);
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
  return waitForStatus(buildId, status, deadline);
}

describe("createPlaywrightCaptureRunner cancel", () => {
  it("closes the in-flight browser and leaves the build in a terminal failed state", async () => {
    const { buildId } = await seedBuild();
    const runner = createPlaywrightCaptureRunner({ db, storage, dataDir });

    const runPromise = runner.run(buildId);
    await waitForStatus(buildId, "capturing");
    await expect(runner.cancel(buildId)).resolves.toBeUndefined();
    await runPromise;

    const build = await new BuildModel(db).get(buildId);
    expect(build?.status).toBe("failed");
  }, 30_000);

  it("resolves for builds that are not running", async () => {
    const runner = createPlaywrightCaptureRunner({ db, storage, dataDir });
    await expect(runner.cancel("does-not-exist")).resolves.toBeUndefined();
  });
});