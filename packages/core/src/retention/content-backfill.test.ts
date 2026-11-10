import { describe, expect, it, vi } from "vite-plus/test";
import type { BuildReferenceLifecycle } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { SiteSettingsModel } from "../models/site-settings.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { storybookDir } from "../utils/paths.ts";
import {
  CONTENT_BACKFILL_KEY,
  CONTENT_BACKFILL_PAGE,
  backfillContentUses,
} from "./content-backfill.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const EVIL = "../p1/builds/b1/storybook/index.html";
const NOW = "2026-01-01T00:00:00.000Z";

function world() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const record = vi.fn(async (..._args: unknown[]) => await Promise.resolve([] as string[]));
  const lifecycle = { recordContentUses: record } as unknown as BuildReferenceLifecycle;
  const warn = vi.fn();
  const info = vi.fn();
  const logger = { warn, info } as unknown as Logger;

  async function build(id: string, manifest: string | object | null, retentionState = "available") {
    await db.insert(db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: id,
      gitBranch: "main",
      status: "approved",
      retentionState,
      createdAt: NOW,
      updatedAt: NOW,
    });
    if (manifest !== null) {
      const body = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
      objects.set(`${storybookDir("p1", id)}/manifest.json`, Buffer.from(body));
    }
  }
  const run = async () => await backfillContentUses({ db, storage, lifecycle, logger });
  const marker = async () => await new SiteSettingsModel(db).get(CONTENT_BACKFILL_KEY);
  return { db, record, warn, info, build, run, marker };
}

describe("backfillContentUses", () => {
  it("records each live build's hashes once, then marks itself done and does nothing on a re-run", async () => {
    const w = world();
    await w.build("b1", { "a.js": A, "b.js": B, "dup.js": A });
    await w.build("b2", { "a.js": A });

    const first = await w.run();

    expect(first).toMatchObject({ done: true, builds: 2, uses: 3, skippedHashes: 0 });
    expect(w.record).toHaveBeenCalledWith("p1", "b1", [A, B]);
    expect(w.record).toHaveBeenCalledWith("p1", "b2", [A]);
    expect(await w.marker()).toBe(JSON.stringify({ done: true }));

    w.record.mockClear();
    expect(await w.run()).toMatchObject({ done: true, builds: 0, uses: 0 });
    expect(w.record).not.toHaveBeenCalled();
  });

  it("skips a value that is not a content hash, records the rest, and never logs the value", async () => {
    const w = world();
    await w.build("b1", { "ok.js": C, "evil.js": EVIL, "short.js": "abc" });

    const result = await w.run();

    expect(result).toMatchObject({ builds: 1, uses: 1, skippedHashes: 2 });
    expect(w.record).toHaveBeenCalledWith("p1", "b1", [C]);
    expect(JSON.stringify([...w.warn.mock.calls, ...w.info.mock.calls])).not.toContain(EVIL);
  });

  it("leaves a build alone that is being deleted, has no manifest, or has an unreadable one", async () => {
    const w = world();
    await w.build("b1", { "a.js": A }, "deleting");
    await w.build("b2", null);
    await w.build("b3", "not json");

    const result = await w.run();

    expect(w.record).not.toHaveBeenCalled();
    expect(result).toMatchObject({ done: true, builds: 2, unreadable: 1 });
  });

  it("records what a collector has not claimed, and repeats the page next run instead of saving it", async () => {
    const w = world();
    await w.build("b1", { "a.js": A, "b.js": B });
    await w.build("b2", { "c.js": C });
    w.record.mockImplementation(async (_project, _build, hashes) => {
      const wanted = hashes as string[];
      return await Promise.resolve(wanted.includes(B) ? [B] : []);
    });

    const first = await w.run();

    expect(first).toMatchObject({ done: false, refused: 1, uses: 2 });
    expect(w.record).toHaveBeenCalledWith("p1", "b1", [A]);
    expect(await w.marker()).toBeNull();

    w.record.mockReset();
    w.record.mockResolvedValue([]);
    expect(await w.run()).toMatchObject({ done: true, refused: 0 });
    expect(w.record).toHaveBeenCalledWith("p1", "b1", [A, B]);
    expect(await w.marker()).toBe(JSON.stringify({ done: true }));
  });

  it("resumes after the saved cursor and visits builds page by page", async () => {
    const w = world();
    await w.build("b1", { "a.js": A });
    await w.build("b2", { "b.js": B });
    await new SiteSettingsModel(w.db).set(CONTENT_BACKFILL_KEY, JSON.stringify({ after: "b1" }));

    const result = await w.run();

    expect(result.builds).toBe(1);
    expect(w.record).toHaveBeenCalledTimes(1);
    expect(w.record).toHaveBeenCalledWith("p1", "b2", [B]);
  });

  it("records every build across more than one page exactly once", async () => {
    const w = world();
    const total = CONTENT_BACKFILL_PAGE + 1;
    for (let index = 0; index < total; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- builds are seeded in id order
      await w.build(`b${String(index).padStart(4, "0")}`, { "a.js": A });
    }

    const result = await w.run();

    expect(result).toMatchObject({ done: true, builds: total });
    const ids = w.record.mock.calls.map((call) => call[1]);
    expect(new Set(ids).size).toBe(total);
    expect(ids).toHaveLength(total);
  });

  it("stops between pages when aborted and keeps its cursor, so the next boot resumes", async () => {
    const w = world();
    await w.build("b1", { "a.js": A });
    const controller = new AbortController();
    controller.abort();
    const { db } = w;
    const { storage } = makeStorage();

    const result = await backfillContentUses({
      db,
      storage,
      lifecycle: { recordContentUses: w.record } as unknown as BuildReferenceLifecycle,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ done: false, builds: 0 });
    expect(await w.marker()).toBeNull();
  });

  it("starts over from the beginning when the saved progress is unreadable", async () => {
    const w = world();
    await w.build("b1", { "a.js": A });
    await new SiteSettingsModel(w.db).set(CONTENT_BACKFILL_KEY, "{broken");

    expect(await w.run()).toMatchObject({ builds: 1, done: true });
  });

  it("fails without marking itself done when a manifest cannot be read", async () => {
    const w = world();
    await w.build("b1", { "a.js": A });
    const failing = makeStorage().storage;
    vi.spyOn(failing, "exists").mockRejectedValue(new Error("storage down"));

    await expect(
      backfillContentUses({
        db: w.db,
        storage: failing,
        lifecycle: { recordContentUses: w.record } as unknown as BuildReferenceLifecycle,
      }),
    ).rejects.toThrow("storage down");
    expect(await w.marker()).toBeNull();
  });
});
