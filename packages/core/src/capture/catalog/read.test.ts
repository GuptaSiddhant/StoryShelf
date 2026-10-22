import { describe, expect, it } from "vitest";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { storybookDir } from "../../utils/paths.ts";
import { readPublishedFile } from "./read.ts";

describe("readPublishedFile", () => {
  it("reads through the manifest to the content-addressed file", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "b")}/manifest.json`, Buffer.from('{"index.json":"h1"}'));
    objects.set("content/h1", Buffer.from("from content"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe(
      "from content",
    );
  });

  it("falls back to the per-build copy when the manifest does not list the file", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "b")}/manifest.json`, Buffer.from("{}"));
    objects.set(`${storybookDir("p", "b")}/index.json`, Buffer.from("legacy"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe("legacy");
  });

  it("falls back when the manifest is unreadable, and is null when the file is gone", async () => {
    const { storage, objects } = makeStorage();
    objects.set(`${storybookDir("p", "b")}/manifest.json`, Buffer.from("not json"));
    expect(await readPublishedFile(storage, "p", "b", "index.json")).toBeNull();
    objects.set(`${storybookDir("p", "b")}/index.json`, Buffer.from("ok"));
    expect((await readPublishedFile(storage, "p", "b", "index.json"))?.toString()).toBe("ok");
  });
});
