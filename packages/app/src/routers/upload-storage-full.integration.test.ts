import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createHash } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { isOutOfSpace } from "./upload-storage-errors.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function diskFull(): Error {
  return Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
}

describe("upload to a full storage volume", () => {
  it("answers 507 with a message and logs the cause instead of a bare 500", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    vi.spyOn(storage, "write").mockRejectedValue(diskFull());
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
    const errorLog = vi.spyOn(logger, "error");
    const app = createShelfApp({ database: db, storage, logger });

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

  it("recognizes ENOSPC and EDQUOT, also as a cause, and nothing else", () => {
    expect(isOutOfSpace(diskFull())).toBe(true);
    expect(isOutOfSpace(Object.assign(new Error("q"), { code: "EDQUOT" }))).toBe(true);
    expect(isOutOfSpace(new Error("wrapped", { cause: diskFull() }))).toBe(true);
    expect(isOutOfSpace(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(false);
    expect(isOutOfSpace("ENOSPC")).toBe(false);
  });
});
