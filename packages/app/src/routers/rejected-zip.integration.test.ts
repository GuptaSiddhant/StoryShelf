import { BuildModel, NotificationChannelModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { announceBuildStatus } from "./builds.handlers.ts";

// Pass-through spy: lets a test see whether a status was announced (git, webhooks, notifications).
vi.mock("./builds.handlers.ts", async (original) => {
  const real = await original<typeof import("./builds.handlers.ts")>();
  return { ...real, announceBuildStatus: vi.fn(real.announceBuildStatus) };
});

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

/** An app with one git channel and a project; `upload` PUTs bytes to a fresh build's zip route. */
async function boot() {
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
  const { uploadUrl, build: row } = (await build.json()) as {
    uploadUrl: string;
    build: { id: string };
  };
  const upload = async (): Promise<Response> =>
    await app.request(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array(Buffer.from("definitely-not-a-zip")),
    });
  return { db, git, buildId: row.id, upload };
}

describe("a rejected inline zip", () => {
  beforeEach(() => {
    vi.mocked(announceBuildStatus).mockClear();
  });

  it("shows a failure on the git channel, not a pending check", async () => {
    const t = await boot();
    expect((await t.upload()).status).toBe(422);
    expect(announceBuildStatus).toHaveBeenCalledWith(t.buildId, "failed", expect.anything());
    await vi.waitFor(() => {
      expect(t.git.calls.at(-1)?.state).toBe("failure");
    });
  });

  it("still answers 422 and keeps the build failed when the announcement throws", async () => {
    const t = await boot();
    vi.mocked(announceBuildStatus).mockRejectedValueOnce(new Error("notifier down"));
    expect((await t.upload()).status).toBe(422);
    expect((await new BuildModel(t.db).get(t.buildId))?.status).toBe("failed");
  });

  it("announces no failure when a cancel lands after the build was read as pending", async () => {
    const t = await boot();
    await new BuildModel(t.db).setStatus(t.buildId, "cancelled");
    t.git.calls.length = 0;
    const read = BuildModel.prototype.get;
    const stale = vi.spyOn(BuildModel.prototype, "get").mockImplementationOnce(async function (
      this: BuildModel,
      id: string,
    ) {
      const row = await read.call(this, id);
      return row === null ? null : { ...row, status: "pending" };
    });
    expect((await t.upload()).status).toBe(422);
    stale.mockRestore();
    expect((await new BuildModel(t.db).get(t.buildId))?.status).toBe("cancelled");
    expect(t.git.calls.some((call) => call.state === "failure")).toBe(false);
    expect(announceBuildStatus).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "approved"] as const)(
    "refuses with 422 but leaves a %s build as it is, and shows no failure on the git channel",
    async (status) => {
      const t = await boot();
      await new BuildModel(t.db).setStatus(t.buildId, status);
      t.git.calls.length = 0;
      expect((await t.upload()).status).toBe(422);
      expect((await new BuildModel(t.db).get(t.buildId))?.status).toBe(status);
      expect(t.git.calls.some((call) => call.state === "failure")).toBe(false);
      expect(announceBuildStatus).not.toHaveBeenCalled();
    },
  );
});
