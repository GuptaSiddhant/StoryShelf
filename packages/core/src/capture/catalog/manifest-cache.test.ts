import { describe, expect, it, vi } from "vitest";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { forgetManifest, loadManifest, MANIFEST_CACHE_SIZE } from "./manifest-cache.ts";

const manifestAt = (dir: string): string => `${dir}/manifest.json`;

describe("loadManifest", () => {
  it("reads a manifest once, however many files ask for it", async () => {
    const { storage, objects } = makeStorage();
    objects.set(manifestAt("a"), Buffer.from('{"x.js":"h"}'));
    const read = vi.spyOn(storage, "read");
    await Promise.all([loadManifest(storage, "a"), loadManifest(storage, "a")]);
    expect((await loadManifest(storage, "a"))?.get("x.js")).toBe("h");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("never serves one build's manifest for another", async () => {
    const { storage, objects } = makeStorage();
    objects.set(manifestAt("a"), Buffer.from('{"x.js":"one"}'));
    objects.set(manifestAt("b"), Buffer.from('{"x.js":"two"}'));
    expect((await loadManifest(storage, "a"))?.get("x.js")).toBe("one");
    expect((await loadManifest(storage, "b"))?.get("x.js")).toBe("two");
  });

  it("keeps caches of different storage adapters apart", async () => {
    const first = makeStorage();
    const second = makeStorage();
    first.objects.set(manifestAt("a"), Buffer.from('{"x.js":"one"}'));
    second.objects.set(manifestAt("a"), Buffer.from('{"x.js":"two"}'));
    await loadManifest(first.storage, "a");
    expect((await loadManifest(second.storage, "a"))?.get("x.js")).toBe("two");
  });

  it("does not cache a missing manifest, so a build still publishing gets one later", async () => {
    const { storage, objects } = makeStorage();
    expect(await loadManifest(storage, "a")).toBeNull();
    objects.set(manifestAt("a"), Buffer.from('{"x.js":"h"}'));
    expect((await loadManifest(storage, "a"))?.get("x.js")).toBe("h");
  });

  it("does not cache an unreadable or malformed manifest", async () => {
    const { storage, objects } = makeStorage();
    objects.set(manifestAt("a"), Buffer.from("not json"));
    expect(await loadManifest(storage, "a")).toBeNull();
    objects.set(manifestAt("a"), Buffer.from("[1]"));
    expect(await loadManifest(storage, "a")).toBeNull();
  });

  it("ignores non-string entries and inherited keys", async () => {
    const { storage, objects } = makeStorage();
    objects.set(manifestAt("a"), Buffer.from('{"x.js":"h","bad":1}'));
    const manifest = await loadManifest(storage, "a");
    expect(manifest?.has("bad")).toBe(false);
    expect(manifest?.get("constructor")).toBeUndefined();
  });

  it("evicts the least recently used manifest past the bound, and on forget", async () => {
    const { storage, objects } = makeStorage();
    const dirs = Array.from({ length: MANIFEST_CACHE_SIZE + 1 }, (_, i) => `d${i}`);
    for (const dir of dirs) objects.set(manifestAt(dir), Buffer.from("{}"));
    await Promise.all(dirs.map(async (dir) => await loadManifest(storage, dir)));
    const read = vi.spyOn(storage, "read");
    await loadManifest(storage, `d${MANIFEST_CACHE_SIZE}`);
    expect(read).not.toHaveBeenCalled();
    await loadManifest(storage, "d0");
    expect(read).toHaveBeenCalledTimes(1);
    forgetManifest(storage, "d0");
    await loadManifest(storage, "d0");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
