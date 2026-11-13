import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.ts";
import { SiteSettingsModel } from "../models/site-settings.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { RECLAIM_COPIES_PAGE } from "./reclaim-build-copies.ts";
import { RECLAIM_ZIPS_KEY, reclaimUploadZips } from "./reclaim-upload-zips.ts";

const A = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";

function world() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const info = vi.fn();
  const warn = vi.fn();
  const logger = { info, warn } as unknown as Logger;

  async function build(
    id: string,
    options: { manifest?: boolean; zip?: boolean; status?: string; retentionState?: string } = {},
  ) {
    await db.insert(db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: id,
      gitBranch: "main",
      status: options.status ?? "approved",
      retentionState: options.retentionState ?? "available",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const dir = `p1/builds/${id}`;
    if (options.zip !== false) objects.set(`${dir}/storybook.zip`, Buffer.from("zip"));
    if (options.manifest !== false) {
      objects.set(`${dir}/storybook/manifest.json`, Buffer.from(JSON.stringify({ "a.js": A })));
    }
    return `${dir}/storybook.zip`;
  }
  const run = async (signal?: AbortSignal) =>
    await reclaimUploadZips({ db, storage, logger, ...(signal ? { signal } : {}) });
  return { db, storage, objects, info, warn, build, run };
}

describe("reclaimUploadZips", () => {
  it("deletes the zip of a build with a manifest and stored content, and keeps the others", async () => {
    const w = world();
    const ready = await w.build("b1");
    const noManifest = await w.build("b2", { manifest: false });
    const pending = await w.build("b3", { status: "pending" });
    const deleting = await w.build("b4", { retentionState: "deleting" });
    const noBlob = await w.build("b5");
    await w.build("b6", { zip: false });
    w.objects.set(`content/${A}`, Buffer.from("a"));

    // b5 shares the hash, so give it its own missing one.
    w.objects.set(
      "p1/builds/b5/storybook/manifest.json",
      Buffer.from(JSON.stringify({ "x.js": "b".repeat(64) })),
    );

    const result = await w.run();

    expect(result).toMatchObject({ done: true, builds: 6, dropped: 1, kept: 2 });
    expect(w.objects.has(ready)).toBe(false);
    for (const zip of [noManifest, pending, deleting, noBlob])
      expect(w.objects.has(zip)).toBe(true);
    expect(w.objects.has(`content/${A}`)).toBe(true);
    expect(w.objects.has("p1/builds/b1/storybook/manifest.json")).toBe(true);
    expect(JSON.stringify(w.info.mock.calls)).not.toContain("storybook.zip");
  });

  it("is idempotent and runs under its own key once the first pass is done", async () => {
    const w = world();
    await new SiteSettingsModel(w.db).set(
      "retention.statics-reclaim",
      JSON.stringify({ done: true }),
    );
    const zip = await w.build("b1");
    w.objects.set(`content/${A}`, Buffer.from("a"));
    expect(await w.run()).toMatchObject({ done: true, dropped: 1 });
    expect(w.objects.has(zip)).toBe(false);
    expect(await w.run()).toMatchObject({ done: true, builds: 0, dropped: 0 });
    expect(await new SiteSettingsModel(w.db).get(RECLAIM_ZIPS_KEY)).toBe(
      JSON.stringify({ done: true }),
    );
  });

  it("resumes from its cursor across pages", async () => {
    const w = world();
    w.objects.set(`content/${A}`, Buffer.from("a"));
    const ids = Array.from(
      { length: RECLAIM_COPIES_PAGE + 1 },
      (_, i) => `b${String(i).padStart(3, "0")}`,
    );
    await Promise.all(ids.map(async (id) => await w.build(id)));
    const first = await w.run();
    expect(first).toMatchObject({
      done: false,
      builds: RECLAIM_COPIES_PAGE,
      dropped: RECLAIM_COPIES_PAGE,
    });
    const second = await w.run();
    expect(second).toMatchObject({ done: true, builds: 1, dropped: 1 });
  });

  it("stops between builds when aborted, and a storage failure keeps that zip only", async () => {
    const w = world();
    const zip = await w.build("b1");
    w.objects.set(`content/${A}`, Buffer.from("a"));
    const controller = new AbortController();
    controller.abort();
    expect(await w.run(controller.signal)).toMatchObject({ done: false, builds: 0 });
    expect(w.objects.has(zip)).toBe(true);

    w.storage.delete = async () => {
      throw new Error("down");
    };
    expect(await w.run()).toMatchObject({ done: true, builds: 1, dropped: 0, kept: 1 });
    expect(w.warn).toHaveBeenCalledOnce();
  });
});
