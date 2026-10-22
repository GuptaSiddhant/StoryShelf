import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { NotificationChannelModel, ProjectModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeFakeStateNotifier,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { setupBuildState } from "./build-state-setup.ts";
import { createJobQueue } from "./job-queue.ts";
import { resolveRuntime } from "./runtime.ts";

const SECRET = "test-server-secret-32-chars-long!!";
const logger = createShelfLogger({ level: "silent" });

function recordingMessageProvider(sent: unknown[]): NotifierProvider {
  const metadata = {
    name: "chat",
    version: "0.0.0",
    kind: "chat",
    category: "notifier" as const,
    schema: {} as never,
  };
  return {
    metadata,
    create: () => ({
      metadata,
      // oxlint-disable-next-line eslint/require-await -- send is async by contract
      send: async (input: unknown) => {
        sent.push(input);
      },
    }),
  };
}

async function world(options: { testing?: boolean; review?: boolean } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const git = makeFakeStateNotifier();
  const sent: unknown[] = [];
  const shelf = {
    database: db,
    storage,
    logger,
    config: { secret: SECRET, publicBaseUrl: "https://shelf.example.com" },
    testing: options.testing === false ? undefined : { runner: {} },
    notifications: { notifiers: [git.provider, recordingMessageProvider(sent)] },
  } as unknown as ShelfOptions;
  const runtime = resolveRuntime(shelf);
  const project = await createTestProject(db, db.tables);
  await new ProjectModel(db).update(project.id, { reviewEnabled: options.review ?? true });
  const build = await createTestBuild(db, db.tables, project.id);
  const channels = new NotificationChannelModel(db, undefined, SECRET);
  const git1 = await channels.create({
    projectId: project.id,
    provider: "fake-git",
    config: {},
    secret: "token",
  });
  return { db, shelf, runtime, project, build, channels, git, git1, sent };
}

function contexts(calls: { target: { kind: string; context?: string } }[]): string[] {
  return calls.flatMap((call) =>
    call.target.kind === "status" && call.target.context !== undefined ? [call.target.context] : [],
  );
}

describe("setupBuildState", () => {
  it("delivers inline when the host polls no notify queue (serverless)", async () => {
    const w = await world();
    const wiring = setupBuildState(w.shelf, w.runtime, null);
    expect(wiring.handler).toBeNull();
    await wiring.publisher.request(w.build.id);
    expect(w.git.calls.map((call) => call.target.kind)).toEqual(["status", "status", "comment"]);
    expect(w.git.calls[0]?.url).toBe(
      `https://shelf.example.com/projects/${w.project.slug}/builds/${w.build.id}`,
    );
  });

  it("queues one notify job per git channel when the host consumes the queue", async () => {
    const w = await world();
    const jobs = createJobQueue(w.shelf, ["notify"], 4);
    const wiring = setupBuildState(w.shelf, w.runtime, jobs);
    expect(wiring.handler?.run).toBeTypeOf("function");
    await wiring.publisher.request(w.build.id);
    await wiring.publisher.request(w.build.id);
    expect(w.git.calls).toHaveLength(0);
    const job = await jobs.get().poll();
    expect(job).toMatchObject({
      kind: "notify",
      buildId: w.build.id,
      maxAttempts: 5,
      data: { channelId: w.git1.id },
    });
    expect(await jobs.get().poll()).toBeNull();
  });

  it("shows only the Storybook status without testing and review", async () => {
    const w = await world({ testing: false, review: false });
    await setupBuildState(w.shelf, w.runtime, null).publisher.request(w.build.id);
    expect(contexts(w.git.calls)).toEqual(["storyshelf/storybook"]);
  });

  it("shows the review gate and the Storybook status without testing, with review on", async () => {
    const w = await world({ testing: false, review: true });
    await setupBuildState(w.shelf, w.runtime, null).publisher.request(w.build.id);
    expect(contexts(w.git.calls)).toEqual(["storyshelf/review", "storyshelf/storybook"]);
  });

  it("keeps testing as the only gate with testing on, whatever the review switch says", async () => {
    const w = await world({ testing: true, review: true });
    await setupBuildState(w.shelf, w.runtime, null).publisher.request(w.build.id);
    expect(contexts(w.git.calls)).toEqual(["storyshelf/testing", "storyshelf/storybook"]);
  });

  it("raises sys:notify-failed to the site-wide channels when a delivery is given up", async () => {
    const w = await world();
    const jobs = createJobQueue(w.shelf, ["notify"], 4);
    setupBuildState(w.shelf, w.runtime, jobs);
    await w.channels.create({ projectId: null, provider: "chat", config: {}, events: [] });

    await jobs.exhausted.notify?.(
      { buildId: w.build.id, kind: "notify", data: { channelId: w.git1.id } } as never,
      "HTTP 401: Bad credentials",
    );

    const channel = await w.channels.get(w.git1.id);
    expect(channel?.lastError).toBe("HTTP 401: Bad credentials");
    expect(w.sent).toHaveLength(1);
    expect(JSON.stringify(w.sent[0])).toContain("sys:notify-failed");
  });
});
