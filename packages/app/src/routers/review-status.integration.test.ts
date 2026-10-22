import type {
  CheckStatus,
  GitHostAdapter,
  GitHostProvider,
} from "@storyshelf/core/adapter/git-host";
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino, type Logger } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkForTransition } from "../git-status.ts";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const T1 = "2026-01-01T00:00:00.000Z";
const SHA = "b".repeat(40);

interface StatusCall {
  context: string;
  gitSha: string;
  status: CheckStatus;
}

function fakeProvider(calls: StatusCall[]): GitHostProvider {
  const base: GitHostProvider = {
    metadata: {
      name: "Fake",
      version: "0.0.0",
      kind: "fake-host",
      category: "git-host",
      schema: z.object({ owner: z.string(), repo: z.string() }),
    },
    create(_opts: { config: unknown; token: string; logger?: Logger }): GitHostAdapter {
      return {
        metadata: base.metadata,
        setStatus: async (opts): Promise<void> => {
          calls.push({ context: opts.context, gitSha: opts.gitSha, status: opts.status });
          await Promise.resolve();
        },
      };
    },
  };
  return base;
}

const project: Project = {
  id: "p1",
  name: "Gate",
  slug: "gate",
  gitRepository: "acme/widgets",
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: T1,
  updatedAt: T1,
};

const build = {
  id: "f1",
  projectId: "p1",
  gitSha: SHA,
  gitBranch: "feature/x",
  isDefault: false,
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status: "reviewing",
  snapshotCount: 0,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  affectedOnly: true,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  createdAt: T1,
  updatedAt: T1,
} as Build;

async function setup(storyCount = 2) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const calls: StatusCall[] = [];
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, build);
  await Promise.all(
    Array.from({ length: storyCount }, async (_, index) => {
      objects.set(`shots/${index}.png`, Buffer.from("png"));
      await db.insert(db.tables.snapshots, {
        id: `s${index}`,
        projectId: "p1",
        buildId: "f1",
        storyId: `story-${index}`,
        storyName: `Story ${index}`,
        storyTitle: "T",
        viewportName: "desktop",
        screenshotPath: `shots/${index}.png`,
        status: "changed",
        baselineId: null,
        baselineVersion: "none",
        createdAt: T1,
        updatedAt: T1,
      });
    }),
  );
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    config: { secret: "test-secret" },
    gitHosts: [fakeProvider(calls)],
    logger: pino({ level: "silent" }),
  });
  const created = await app.request("/api/v1/projects/gate/status-configs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "fake-host",
      config: { owner: "acme", repo: "widgets" },
      token: "t",
    }),
  });
  expect(created.status).toBe(201);
  const post = async (path: string) =>
    await app.request(`/api/v1/projects/gate/builds/f1/${path}`, { method: "POST" });
  return { post, calls };
}

describe("git status after a human review", () => {
  it("posts success once every snapshot is approved, not before", async () => {
    const { post, calls } = await setup();

    await post("snapshots/s0/approve");
    expect(calls).toEqual([]);

    await post("snapshots/s1/approve");
    expect(calls).toEqual([{ context: "storyshelf/gate", gitSha: SHA, status: "success" }]);
  });

  it("posts failure when a snapshot is rejected and the review completes", async () => {
    const { post, calls } = await setup();
    await post("snapshots/s0/approve");
    await post("snapshots/s1/reject");
    expect(calls.map((call) => call.status)).toEqual(["failure"]);
  });

  it("posts success for approve-all and a shared story/mode approval", async () => {
    const all = await setup();
    await all.post("approve-all");
    expect(all.calls.map((call) => call.status)).toEqual(["success"]);

    const grouped = await setup(1);
    await grouped.post("stories/story-0/modes/desktop/approve");
    expect(grouped.calls.map((call) => call.status)).toEqual(["success"]);
  });

  it("does not re-post when the outcome did not change", async () => {
    const { post, calls } = await setup(1);
    await post("snapshots/s0/approve");
    await post("snapshots/s0/approve").catch(() => null);
    expect(calls).toHaveLength(1);
  });
});

describe("checkForTransition", () => {
  it("maps terminal outcomes and re-opened reviews, ignoring no-ops", () => {
    expect(checkForTransition("reviewing", "approved")).toBe("success");
    expect(checkForTransition("reviewing", "rejected")).toBe("failure");
    expect(checkForTransition("approved", "reviewing")).toBe("pending");
    expect(checkForTransition("rejected", "approved")).toBe("success");
    expect(checkForTransition("reviewing", "reviewing")).toBeNull();
    expect(checkForTransition("approved", "approved")).toBeNull();
    expect(checkForTransition("capturing", "reviewing")).toBeNull();
  });
});
