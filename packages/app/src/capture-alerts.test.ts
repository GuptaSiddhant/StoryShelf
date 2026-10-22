import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { alreadyAlerted, notifyCaptureFailed } from "./capture-alerts.ts";

describe("alreadyAlerted", () => {
  it("lets only the first of several settles of one failed build through", () => {
    const build = { id: "b-alert", updatedAt: "2026-10-19T10:00:00.000Z" };
    expect(alreadyAlerted(build)).toBe(false);
    // Every other shard of the same failed build settles against the same build row.
    expect(alreadyAlerted(build)).toBe(true);
    expect(alreadyAlerted({ ...build })).toBe(true);
  });

  it("alerts again when a retry fails the build anew", () => {
    expect(alreadyAlerted({ id: "b-retry", updatedAt: "2026-10-19T10:00:00.000Z" })).toBe(false);
    expect(alreadyAlerted({ id: "b-retry", updatedAt: "2026-10-19T11:30:00.000Z" })).toBe(false);
  });
});

async function buildWith(status: "failed" | "capturing" | "cancelled") {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db).create({ name: `Alerts ${status}` });
  const builds = new BuildModel(db);
  const build = await builds.create(project.id, { gitSha: "sha", gitBranch: "feature/x" });
  await builds.setStatus(build.id, status);
  return { db, build };
}

describe("notifyCaptureFailed", () => {
  const logger = createShelfLogger({ level: "silent" });

  it("alerts once for a failed build", async () => {
    const { db, build } = await buildWith("failed");
    const notifier = {
      metadata: { name: "n", version: "0", kind: "n", category: "notifier" },
      send: vi.fn(async () => ({ ok: true })),
    };
    const options = { database: db, notifications: { notifiers: [notifier] } } as never;
    await notifyCaptureFailed(options, {}, logger, build.id);
    const fresh = await new BuildModel(db).get(build.id);
    expect(alreadyAlerted(fresh as never)).toBe(true);
    // A second settle of the same failed build is a no-op.
    await expect(notifyCaptureFailed(options, {}, logger, build.id)).resolves.toBeUndefined();
  });

  it("stays quiet for a build a user cancelled", async () => {
    const { db, build } = await buildWith("cancelled");
    const send = vi.fn(async () => ({ ok: true }));
    const notifier = {
      metadata: { name: "n", version: "0", kind: "n", category: "notifier" },
      send,
    };
    const options = { database: db, notifications: { notifiers: [notifier] } } as never;
    await notifyCaptureFailed(options, {}, logger, build.id);
    expect(send).not.toHaveBeenCalled();
    expect(alreadyAlerted((await new BuildModel(db).get(build.id)) as never)).toBe(false);
  });

  it("stays quiet for a build that did not fail, or is gone", async () => {
    const { db, build } = await buildWith("capturing");
    const options = { database: db } as never;
    await notifyCaptureFailed(options, {}, logger, build.id);
    await notifyCaptureFailed(options, {}, logger, "missing");
    const fresh = await new BuildModel(db).get(build.id);
    expect(alreadyAlerted(fresh as never)).toBe(false);
  });
});
