import { describe, expect, it } from "vitest";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { storybookDir } from "../../utils/paths.ts";
import { readPublishedFile, readPublishedFileInfo } from "./read.ts";

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
});
