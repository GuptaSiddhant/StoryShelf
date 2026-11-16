import { describe, expect, it, vi } from "vitest";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { storybookDir } from "../../utils/paths.ts";
import { openPublishedFile, readPublishedFile, readPublishedFileInfo } from "./read.ts";

/** A well-formed content hash (64 lowercase hex digits). */
const HASH = "1".repeat(64);

describe("readPublishedFile", () => {
  it("reads through the manifest to the content-addressed file", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "b")}/manifest.json`, Buffer.from(`{"index.json":"${HASH}"}`));
    objects.set(`content/${HASH}`, Buffer.from("from content"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe(
      "from content",
    );
    expect(await readPublishedFileInfo(storage, "p", "b", "index.json")).toEqual({
      bytes: Buffer.from("from content"),
      contentHash: HASH,
    });
  });

  it("falls back to the per-build copy when the manifest does not list the file", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "b")}/manifest.json`, Buffer.from("{}"));
    objects.set(`${storybookDir("p", "b")}/index.json`, Buffer.from("legacy"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe("legacy");
    expect(await readPublishedFileInfo(storage, "p", "b", "index.json")).toEqual({
      bytes: Buffer.from("legacy"),
    });
  });

  it("falls back to the per-build copy when the manifest lists a malformed hash", async () => {
    const { storage, objects } = makeStorage();
    objects.set(
      `${storybookDir("p", "b")}/manifest.json`,
      Buffer.from('{"index.json":"not-a-hash"}'),
    );
    // Planted where a naive lookup of the malformed hash would find it.
    objects.set("content/not-a-hash", Buffer.from("shared"));
    objects.set(`${storybookDir("p", "b")}/index.json`, Buffer.from("per-build"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe(
      "per-build",
    );
  });

  it("falls back when the manifest is unreadable, and is null when the file is gone", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "b")}/manifest.json`, Buffer.from("not json"));
    expect(await readPublishedFile(storage, "p", "b", "index.json")).toBeNull();
    objects.set(`${storybookDir("p", "b")}/index.json`, Buffer.from("ok"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe("ok");
  });

  it("costs one storage read per warm file and never calls exists", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "w")}/manifest.json`, Buffer.from(`{"a.js":"${HASH}"}`));
    objects.set(`content/${HASH}`, Buffer.from("body"));
    await readPublishedFile(storage, "p", "w", "a.js");
    const read = vi.spyOn(storage, "read");
    const exists = vi.spyOn(storage, "exists");
    await readPublishedFile(storage, "p", "w", "a.js");
    expect(read).toHaveBeenCalledTimes(1);
    expect(exists).not.toHaveBeenCalled();
  });

  it("opens a stream of the content-addressed file, and null when it is gone", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "s")}/manifest.json`, Buffer.from(`{"a.js":"${HASH}"}`));
    expect(await openPublishedFile(storage, "p", "s", "a.js", "stream")).toBeNull();
    objects.set(`content/${HASH}`, Buffer.from("body"));
    const opened = await openPublishedFile(storage, "p", "s", "a.js", "stream");
    expect(opened?.contentHash).toBe(HASH);
    expect(await new Response(opened?.stream as never).text()).toBe("body");
  });

  it("throws a storage failure that is not a not-found", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "f")}/index.json`, Buffer.from("x"));
    vi.spyOn(storage, "read").mockImplementation(async (path) => {
      if (path.endsWith("manifest.json"))
        throw Object.assign(new Error("nope"), { code: "ENOENT" });
      throw new Error("denied");
    });
    await expect(readPublishedFile(storage, "p", "f", "index.json")).rejects.toThrow("denied");
  });
});
