import { NotificationChannelModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";

/** A rejected inline zip ends the build failed, so its git checks resolve instead of staying pending. */
const SECRET = "test-secret";
let scratchDir = "";
/** Every app a test booted, torn down before the scratch dir goes so a failed assertion cannot leave a consumer running. */
const apps: ReturnType<typeof createShelfApp>[] = [];
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-rejected-zip-"));
});
afterEach(async () => {
  try {
    await Promise.allSettled(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

describe("a rejected inline zip", () => {
  it("shows a failure on the git channel, not a pending check", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const git = makeFakeStateNotifier("github", undefined, z.object({}).loose());
    const app = createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      notifications: { notifiers: [git.provider] },
      config: { secret: SECRET, scratchDir, publicBaseUrl: "https://shelf.example" },
    });
    apps.push(app);
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rejected" }),
    });
    const project = (await created.json()) as { slug: string; id: string };
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: project.id,
      provider: "github",
      config: {},
      secret: "token",
    });
    const build = await app.request(`/api/v1/projects/${project.slug}/builds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gitSha: "abc123def456", gitBranch: "main" }),
    });
    const { uploadUrl } = (await build.json()) as { uploadUrl: string };

    const upload = await app.request(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array(Buffer.from("definitely-not-a-zip")),
    });
    expect(upload.status).toBe(422);

    await vi.waitFor(() => {
      const last = git.calls.at(-1);
      expect(last?.state).toBe("failure");
    });
  });
});
