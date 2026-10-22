import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const T1 = "2026-01-01T00:00:00.000Z";
const SHA = "b".repeat(40);

interface StatusCall {
  context: string;
  gitSha: string;
  status: string;
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
  inheritedCount: 0,
  affectedOnly: true,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  createdAt: T1,
  updatedAt: T1,
} as Build;

/** A log sink and the promise of the boot replay's log line. */
function bootReplayWatch(): {
  promise: Promise<boolean>;
  logSink: { write: (line: string) => void };
} {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  return {
    promise,
    logSink: {
      write: (line) => {
        if (line.includes("re-requested the git state of open builds")) {
          resolve(true);
        }
      },
    },
  };
}

async function setup(storyCount = 2) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const git = makeFakeStateNotifier("fake-host");
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
  // The boot replay (ADR 0014, decision 11) asks for the state of this open build once adapters
  // are ready; let it finish before the channel exists, so it adds no status to the ones counted.
  const { promise: bootReplay, logSink } = bootReplayWatch();
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    config: { secret: "test-secret", publicBaseUrl: "https://shelf.example.com" },
    notifications: { notifiers: [git.provider] },
    logger: pino({ level: "info" }, logSink),
  });
  await bootReplay;
  const created = await app.request("/api/v1/projects/gate/notification-channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "fake-host",
      config: { owner: "acme", repo: "widgets" },
      secret: "t",
    }),
  });
  expect(created.status).toBe(201);
  const post = async (path: string) =>
    await app.request(`/api/v1/projects/gate/builds/f1/${path}`, { method: "POST" });
  /** The commit statuses shown so far (the comment writes are not part of this gate). */
  const statuses = (): StatusCall[] =>
    git.calls.flatMap((call) =>
      call.target.kind === "status"
        ? [{ context: call.target.context, gitSha: call.target.sha, status: call.state }]
        : [],
    );
  return { post, statuses };
}

/** The states shown on `<prefix>/testing`, once delivery caught up with `count` of them. */
async function testingStates(statuses: () => StatusCall[], count: number): Promise<string[]> {
  await vi.waitFor(() => {
    expect(statuses().filter((call) => call.context === "storyshelf/testing")).toHaveLength(count);
  });
  return statuses()
    .filter((call) => call.context === "storyshelf/testing")
    .map((call) => call.status);
}

describe("git status after a human review", () => {
  it("shows success once every snapshot is approved, pending while review is open", async () => {
    const { post, statuses } = await setup();

    await post("snapshots/s0/approve");
    expect(await testingStates(statuses, 1)).toEqual(["pending"]);

    await post("snapshots/s1/approve");
    expect(await testingStates(statuses, 2)).toEqual(["pending", "success"]);
    expect(statuses().every((call) => call.gitSha === SHA)).toBe(true);
  });

  it("shows failure when a snapshot is rejected and the review completes", async () => {
    const { post, statuses } = await setup();
    await post("snapshots/s0/approve");
    await post("snapshots/s1/reject");
    expect(await testingStates(statuses, 2)).toEqual(["pending", "failure"]);
  });

  it("shows success for approve-all and a shared story/mode approval", async () => {
    const all = await setup();
    await all.post("approve-all");
    expect(await testingStates(all.statuses, 1)).toEqual(["success"]);

    const grouped = await setup(1);
    await grouped.post("stories/story-0/modes/desktop/approve");
    expect(await testingStates(grouped.statuses, 1)).toEqual(["success"]);
  });

  it("shows the Storybook status beside the review status", async () => {
    const { post, statuses } = await setup(1);
    await post("snapshots/s0/approve");
    await testingStates(statuses, 1);
    expect(statuses().map((call) => call.context)).toContain("storyshelf/storybook");
  });
});
