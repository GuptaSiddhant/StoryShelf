import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createHash } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function diskFull(): Error {
  return Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
}

async function seeded() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "proj",
    gitRepository: null,
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    storybookMeta: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    runA11y: false,
    browser: "chromium",
    viewports: null,
    automigrate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha1",
    gitBranch: "feature",
    isDefault: false,
    authorEmail: null,
    authorName: null,
    message: null,
    public: true,
    status: "pending",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const logger = pino({ level: "silent" });
  const app = createShelfApp({ database: db, storage, logger });
  return { app, storage, logger };
}

describe("upload to a full storage volume", () => {
  it("answers 507 with a message and logs the cause instead of a bare 500", async () => {
    const { app, storage, logger } = await seeded();
    vi.spyOn(storage, "write").mockRejectedValue(diskFull());
    const errorLog = vi.spyOn(logger, "error");

    const form = new FormData();
    form.set(sha256("hello"), new File([Buffer.from("hello")], "a"));
    const res = await app.request("/api/v1/projects/proj/builds/b1/content", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(507);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("storage is full");
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "b1", step: "content" }),
      expect.stringContaining("out of space"),
    );
  });

  it("gives the manifest claim back when its write fails, so a retry succeeds", async () => {
    const { app, storage } = await seeded();
    const form = new FormData();
    form.set(sha256("hello"), new File([Buffer.from("hello")], "a"));
    await app.request("/api/v1/projects/proj/builds/b1/content", { method: "POST", body: form });
    const write = storage.write.bind(storage);
    const spy = vi.spyOn(storage, "write").mockRejectedValue(diskFull());
    const manifest = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ rel: "index.html", hash: sha256("hello"), size: 5 }] }),
    };
    const refused = await app.request("/api/v1/projects/proj/builds/b1/manifest", manifest);
    expect(refused.status).toBe(507);
    spy.mockImplementation(write);
    const retried = await app.request("/api/v1/projects/proj/builds/b1/manifest", manifest);
    expect(retried.status).toBe(200);
  });

  it("answers 507 when the zip does not fit", async () => {
    const { app, storage } = await seeded();
    vi.spyOn(storage, "writeStream").mockRejectedValue(diskFull());
    const res = await app.request("/api/v1/projects/proj/builds/b1/zip", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array([80, 75, 5, 6]),
    });
    expect(res.status).toBe(507);
  });
});
