import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const NOW = "2026-01-01T00:00:00.000Z";

async function setup() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Review settings",
    slug: "review-settings",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "a".repeat(40),
    gitBranch: "feature/x",
    status: "pending",
    createdAt: NOW,
    updatedAt: NOW,
  });
  const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
  const send = async (method: string, path: string, body: unknown) =>
    await app.request(`/api/v1/projects/review-settings${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { send };
}

describe("project review settings", () => {
  it("PATCH turns review off and sets the required approvals", async () => {
    const { send } = await setup();
    const off = await send("PATCH", "", { reviewEnabled: false, reviewApprovals: 2 });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ reviewEnabled: false, reviewApprovals: 2 });
  });

  it("rejects fewer than one required approval", async () => {
    const { send } = await setup();
    expect((await send("PATCH", "", { reviewApprovals: 0 })).status).toBe(400);
    expect((await send("PATCH", "", { reviewApprovals: 1.5 })).status).toBe(400);
  });
});

describe("comment anchors", () => {
  it("anchors a comment to a story and refuses a story and a snapshot together", async () => {
    const { send } = await setup();
    const story = await send("POST", "/builds/b1/comments", {
      body: "Check this",
      storyId: "a--x",
    });
    expect(story.status).toBe(201);
    expect(await story.json()).toMatchObject({ storyId: "a--x", snapshotId: null });
    const both = await send("POST", "/builds/b1/comments", {
      body: "x",
      storyId: "a--x",
      snapshotId: "s1",
    });
    expect(both.status).toBe(400);
  });
});
