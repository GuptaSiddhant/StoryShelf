/** A default-branch claim through the whole capture job (#910): baselines, build status, git status. */
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { statusesForBuild } from "../adapters/notifier/build-state.ts";
import type { StateNotifierProvider } from "../adapters/notifier/provider.ts";
import { gitLogNotifier } from "../integrations/git/log.ts";
import { BuildModel } from "../models/build.ts";
import { NotificationChannelModel } from "../models/notification-channel.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { createUrlBuilder } from "../urls.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { executeCaptureJob } from "./orchestrator.ts";

const SECRET = "s3cret-s3cret-s3cret";
const STORY = {
  id: "button--primary",
  name: "Primary",
  title: "Button",
  importPath: "./Button.stories.tsx",
  type: "story",
} as const;

function zip(): Buffer {
  const archive = new AdmZip();
  archive.addFile(
    "index.json",
    Buffer.from(JSON.stringify({ v: 4, entries: { [STORY.id]: STORY } })),
  );
  return archive.toBuffer();
}

function runner(): CaptureRunner {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
    render: vi.fn(async () => {
      await Promise.resolve();
      return {
        captures: [
          {
            story: STORY,
            viewportName: "desktop",
            screenshot: Buffer.concat([header, Buffer.alloc(64)]),
          },
        ],
        failures: [],
      };
    }),
    cancel: vi.fn(async () => {
      await Promise.resolve();
    }),
  };
}

/** A GitHub-like host whose answer the test sets. */
function host(answer: { current: () => Promise<boolean> }): StateNotifierProvider {
  const metadata = { ...gitLogNotifier.metadata, kind: "github" };
  return {
    metadata,
    create: () => ({
      metadata,
      setState: async () => {
        await Promise.resolve();
      },
      commitOnBranch: async () => await answer.current(),
    }),
  };
}

let scratchDir: string;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-claim-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function capture(options: { answer?: () => Promise<boolean>; require?: boolean }): Promise<{
  db: DatabaseAdapter;
  build: Build;
  rerun: () => Promise<Build>;
  answer: { current: () => Promise<boolean> };
}> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({
    name: "Claims",
    ...(options.require === undefined ? {} : { requireVerifiedDefault: options.require }),
  });
  const answer = { current: options.answer ?? (async () => await Promise.resolve(true)) };
  if (options.answer !== undefined) {
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: project.id,
      provider: "github",
      config: { owner: "acme", repo: "web" },
      secret: "ghp_token",
    });
  }
  const builds = new BuildModel(db);
  const created = await builds.create(project.id, {
    gitSha: "abc123",
    gitBranch: "main",
    isDefault: true,
  });
  await storage.write(storybookZipPath(project.id, created.id), zip());
  const run = async (): Promise<Build> => {
    await executeCaptureJob(
      { buildId: created.id },
      {
        db,
        tables: db.tables,
        storage,
        runner: runner(),
        scratchDir,
        secret: SECRET,
        notifiers: [host(answer)],
      },
    );
    return (await builds.get(created.id)) ?? created;
  };
  const build = await run();
  const rerun = async (): Promise<Build> => {
    await builds.resetStatus(created.id, "pending");
    return await run();
  };
  return { db, build, rerun, answer };
}

/** The `<prefix>/testing` status a git channel would show. */
function testingStatus(build: Build): { state: string; description: string } | undefined {
  return statusesForBuild({
    build,
    projectSlug: "claims",
    prefix: "storyshelf",
    urls: createUrlBuilder("https://shelf.example"),
    flags: { testing: true, review: false },
    publishing: "success",
  }).statuses.find((status) => status.name === "testing");
}

const said = (value: boolean) => async (): Promise<boolean> => await Promise.resolve(value);
const down = async (): Promise<boolean> => {
  await Promise.resolve();
  throw new Error("HTTP 503");
};

describe("a default-branch claim in the capture job", () => {
  it("behaves as before when the git host confirms the commit is on the branch", async () => {
    const { db, build } = await capture({ answer: said(true) });
    expect(build).toMatchObject({
      status: "approved",
      isDefault: true,
      branchVerified: "verified",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(1);
    expect(testingStatus(build)?.state).toBe("success");
  });

  it("does not auto-approve, move baselines or post a passing status for a commit not on the branch", async () => {
    const { db, build } = await capture({ answer: said(false) });
    expect(build).toMatchObject({
      status: "reviewing",
      isDefault: false,
      branchVerified: "refused",
    });
    expect((await db.list(db.tables.snapshots)).map((row) => row["status"])).toEqual(["new"]);
    expect(await db.list(db.tables.baselines)).toHaveLength(0);
    expect(testingStatus(build)).toEqual(
      expect.objectContaining({
        state: "pending",
        description: "Commit is not on main: 1 change to review",
      }),
    );
  });

  it("fails closed when the host cannot answer, and a re-check after it recovers counts the build", async () => {
    const { db, build, rerun, answer } = await capture({ answer: down });
    expect(build).toMatchObject({
      status: "reviewing",
      isDefault: false,
      branchVerified: "unreachable",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(0);
    expect(testingStatus(build)?.description).toBe(
      "Git host could not confirm main: 1 change to review",
    );
    answer.current = said(true);
    const rechecked = await rerun();
    expect(rechecked).toMatchObject({
      status: "approved",
      isDefault: true,
      branchVerified: "verified",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(1);
  });

  it("refuses an unverified claim with no git channel by default", async () => {
    const { db, build } = await capture({});
    expect(build).toMatchObject({
      status: "reviewing",
      isDefault: false,
      branchVerified: "unverified",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(0);
    expect(testingStatus(build)?.description).toBe(
      "Default branch not verified: 1 change to review",
    );
  });

  it("counts an unverified claim as before when the project turned verification off", async () => {
    const { db, build } = await capture({ require: false });
    expect(build).toMatchObject({
      status: "approved",
      isDefault: true,
      branchVerified: "unverified",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(1);
    expect(testingStatus(build)?.state).toBe("success");
  });
});
