import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle } from "../../adapters/database.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/index.ts";
import { dropUploadZip } from "./drop-zip.ts";

const A = "a".repeat(64);
const target = { projectId: "p1", buildId: "b1" };
const ZIP = "p1/builds/b1/storybook.zip";
const MANIFEST = "p1/builds/b1/storybook/manifest.json";

function world(refused: string[] = []) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const record = vi.fn(async (..._args: unknown[]) => await Promise.resolve(refused));
  (db as { buildReferenceLifecycle?: unknown }).buildReferenceLifecycle = {
    recordContentUses: record,
  } as unknown as BuildReferenceLifecycle;
  objects.set(ZIP, Buffer.from("zip"));
  return { db, storage, objects, record, warn: vi.fn() };
}

describe("dropUploadZip", () => {
  it("deletes the zip once the manifest is committed, its uses are recorded and its blobs stored", async () => {
    const w = world();
    w.objects.set(MANIFEST, Buffer.from(JSON.stringify({ "a.js": A })));
    w.objects.set(`content/${A}`, Buffer.from("a"));
    expect(await dropUploadZip(w, target)).toBe("dropped");
    expect(w.objects.has(ZIP)).toBe(false);
    expect(w.record).toHaveBeenCalledOnce();
    expect(w.objects.has(MANIFEST)).toBe(true);
    expect(await dropUploadZip(w, target)).toBe("no-zip");
  });

  it("keeps the zip without a manifest (a retry of the publish still extracts from it)", async () => {
    const w = world();
    expect(await dropUploadZip(w, target)).toBe("no-manifest");
    w.objects.set(MANIFEST, Buffer.from("not json"));
    expect(await dropUploadZip(w, target)).toBe("no-manifest");
    w.objects.set(MANIFEST, Buffer.from("[]"));
    expect(await dropUploadZip(w, target)).toBe("no-manifest");
    expect(w.objects.has(ZIP)).toBe(true);
    expect(w.record).not.toHaveBeenCalled();
  });

  it("keeps the zip when a collector holds a blob, or a blob is already gone", async () => {
    const held = world([A]);
    held.objects.set(MANIFEST, Buffer.from(JSON.stringify({ "a.js": A })));
    expect(await dropUploadZip({ ...held, logger: { warn: held.warn } as never }, target)).toBe(
      "kept",
    );
    expect(held.warn).toHaveBeenCalledOnce();
    expect(held.objects.has(ZIP)).toBe(true);

    const gone = world();
    gone.objects.set(MANIFEST, Buffer.from(JSON.stringify({ "a.js": A })));
    expect(await dropUploadZip(gone, target)).toBe("kept");
    expect(gone.objects.has(ZIP)).toBe(true);
  });

  it("works without the lifecycle capability (nothing is ever collected)", async () => {
    const w = world();
    delete (w.db as { buildReferenceLifecycle?: unknown }).buildReferenceLifecycle;
    w.objects.set(MANIFEST, Buffer.from(JSON.stringify({ "a.js": A })));
    w.objects.set(`content/${A}`, Buffer.from("a"));
    expect(await dropUploadZip(w, target)).toBe("dropped");
  });

  it("propagates a storage failure", async () => {
    const w = world();
    w.objects.set(MANIFEST, Buffer.from(JSON.stringify({})));
    w.storage.delete = async () => {
      throw new Error("down");
    };
    await expect(dropUploadZip(w, target)).rejects.toThrow("down");
  });
});
