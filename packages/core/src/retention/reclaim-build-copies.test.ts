import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { SiteSettingsModel } from "../models/site-settings.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { storybookDir } from "../utils/paths.ts";
import {
  RECLAIM_COPIES_KEY,
  RECLAIM_COPIES_PAGE,
  reclaimBuildCopies,
} from "./reclaim-build-copies.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";

function world(withLifecycle = true) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const record = vi.fn(async (..._args: unknown[]) => await Promise.resolve([] as string[]));
  if (withLifecycle) {
    (db as { buildReferenceLifecycle?: unknown }).buildReferenceLifecycle = {
      recordContentUses: record,
    } as unknown as BuildReferenceLifecycle;
  }
  const info = vi.fn();
  const logger = { info, warn: vi.fn() } as unknown as Logger;

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
    const dir = storybookDir("p1", id);
    if (manifest !== null) {
      const body = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
      objects.set(`${dir}/manifest.json`, Buffer.from(body));
    }
    return dir;
  }
  const run = async () => await reclaimBuildCopies({ db, storage, logger });
  return { db, objects, record, info, build, run };
}

describe("reclaimBuildCopies", () => {
  it("deletes copies whose blob exists and keeps the manifest and copies without a blob", async () => {
    const w = world();
    const dir = await w.build("b1", { "a.js": A, "sub/b.js": B });
    w.objects.set(`${dir}/a.js`, Buffer.from("a"));
    w.objects.set(`${dir}/sub/b.js`, Buffer.from("b"));
    w.objects.set(`content/${A}`, Buffer.from("a"));

    const result = await w.run();

    expect(result).toMatchObject({ done: true, builds: 1, reclaimed: 1, kept: 1 });
    expect(w.objects.has(`${dir}/a.js`)).toBe(false);
    expect(w.objects.has(`${dir}/sub/b.js`)).toBe(true);
    expect(w.objects.has(`${dir}/manifest.json`)).toBe(true);
    expect(w.objects.has(`content/${A}`)).toBe(true);
    expect(JSON.stringify(w.info.mock.calls)).not.toContain("sub/b.js");
  });

  it("never touches a build without a manifest (legacy) or one being deleted", async () => {
    const w = await Promise.resolve(world());
    const legacy = await w.build("b1", null);
    const deleting = await w.build("b2", { "a.js": A }, "deleting");
    w.objects.set(`${legacy}/a.js`, Buffer.from("a"));
    w.objects.set(`${deleting}/a.js`, Buffer.from("a"));
    w.objects.set(`content/${A}`, Buffer.from("a"));

    await w.run();

    expect(w.objects.has(`${legacy}/a.js`)).toBe(true);
    expect(w.objects.has(`${deleting}/a.js`)).toBe(true);
  });

  it("skips a build with an unreadable manifest or a collector-held blob", async () => {
    const w = world();
    const bad = await w.build("b1", "not json");
    const held = await w.build("b2", { "a.js": A });
    w.objects.set(`${bad}/a.js`, Buffer.from("a"));
    w.objects.set(`${held}/a.js`, Buffer.from("a"));
    w.objects.set(`content/${A}`, Buffer.from("a"));
    w.record.mockResolvedValueOnce([A]);

    const result = await w.run();

    expect(result.skipped).toBe(2);
    expect(w.objects.has(`${bad}/a.js`)).toBe(true);
    expect(w.objects.has(`${held}/a.js`)).toBe(true);
  });

  it("records uses before deleting, and ignores unsafe or malformed entries", async () => {
    const w = world();
    const dir = await w.build("b1", { "a.js": A, "../x": A, "manifest.json": A, "n.js": 3 });
    w.objects.set(`${dir}/a.js`, Buffer.from("a"));
    w.objects.set(`content/${A}`, Buffer.from("a"));

    await w.run();

    expect(w.record).toHaveBeenCalledWith("p1", "b1", [A], expect.any(String));
    expect(w.objects.has(`${dir}/a.js`)).toBe(false);
    expect(w.objects.has(`${dir}/manifest.json`)).toBe(true);
  });

  it("works without the lifecycle capability", async () => {
    const w = world(false);
    const dir = await w.build("b1", { "a.js": A });
    w.objects.set(`${dir}/a.js`, Buffer.from("a"));
    w.objects.set(`content/${A}`, Buffer.from("a"));
    expect((await w.run()).reclaimed).toBe(1);
  });

  it("resumes from the cursor page by page and is a no-op once done", async () => {
    const w = world();
    const total = RECLAIM_COPIES_PAGE + 1;
    const ids = Array.from({ length: total }, (_, index) => `b${String(index).padStart(3, "0")}`);
    const dirs = await Promise.all(ids.map(async (id) => await w.build(id, { "a.js": A })));
    for (const dir of dirs) w.objects.set(`${dir}/a.js`, Buffer.from("a"));
    w.objects.set(`content/${A}`, Buffer.from("a"));

    const first = await w.run();
    expect(first).toMatchObject({ done: false, builds: RECLAIM_COPIES_PAGE });
    const second = await w.run();
    expect(second).toMatchObject({ done: true, builds: 1, reclaimed: 1 });
    const again = await w.run();
    expect(again).toMatchObject({ done: true, builds: 0, reclaimed: 0 });
    expect(await new SiteSettingsModel(w.db).get(RECLAIM_COPIES_KEY)).toBe('{"done":true}');
  });

  it("restarts safely from unreadable progress and stops on abort", async () => {
    const w = world();
    const dir = await w.build("b1", { "a.js": A });
    w.objects.set(`${dir}/a.js`, Buffer.from("a"));
    w.objects.set(`content/${A}`, Buffer.from("a"));
    await new SiteSettingsModel(w.db).set(RECLAIM_COPIES_KEY, "{oops");
    const controller = new AbortController();
    controller.abort();
    const stopped = await reclaimBuildCopies({
      db: w.db,
      storage: (await import("../test-helpers/index.ts")).makeStorage().storage,
      signal: controller.signal,
    });
    expect(stopped.builds).toBe(0);
    expect((await w.run()).reclaimed).toBe(1);
  });
});
