import { makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vite-plus/test";
import { isStoredObject, migrateStorage } from "./migrate.ts";

function seeded() {
  const from = makeStorage();
  const to = makeStorage();
  const files: Record<string, string> = {
    "p1/content/aa.png": "png-a",
    "p1/builds/b1/storybook/index.json": "{}",
    "p1/baselines/x.png": "png-x",
    "shelf.db": "sqlite",
    "shelf.db-wal": "wal",
    "shelf.db-shm": "shm",
    ".storyshelf-scratch/job1/file": "scratch",
    "p1/content/.aa.png.0f3c.tmp": "half-written",
  };
  for (const [key, text] of Object.entries(files)) {
    from.objects.set(key, Buffer.from(text));
  }
  return { from, to };
}

describe("isStoredObject", () => {
  it.each([
    ["p1/content/aa.png", true],
    ["p1/builds/b1/shelf.db.txt", true],
    ["shelf.db", false],
    ["shelf.db-wal", false],
    ["shelf.db-shm", false],
    [".storyshelf-scratch/x/y", false],
    ["p1/content/.aa.png.uuid.tmp", false],
  ])("%s -> %s", (key, expected) => {
    expect(isStoredObject(key)).toBe(expected);
  });
});

describe("migrateStorage", () => {
  it("copies the stored objects under the same keys, and leaves the database and scratch files", async () => {
    const { from, to } = seeded();
    const result = await migrateStorage(from.storage, to.storage);
    expect(result.copied.toSorted()).toEqual([
      "p1/baselines/x.png",
      "p1/builds/b1/storybook/index.json",
      "p1/content/aa.png",
    ]);
    expect(result.ignored).toHaveLength(5);
    expect([...to.objects.keys()].toSorted()).toEqual(result.copied.toSorted());
    expect(to.objects.get("p1/content/aa.png")?.toString()).toBe("png-a");
    expect(from.objects.size).toBe(8);
  });

  it("is idempotent and resumes: an existing key is skipped, not rewritten", async () => {
    const { from, to } = seeded();
    to.objects.set("p1/content/aa.png", Buffer.from("already-there"));
    const first = await migrateStorage(from.storage, to.storage);
    expect(first.skipped).toEqual(["p1/content/aa.png"]);
    expect(first.copied).toHaveLength(2);
    expect(to.objects.get("p1/content/aa.png")?.toString()).toBe("already-there");
    const again = await migrateStorage(from.storage, to.storage);
    expect(again.copied).toEqual([]);
    expect(again.skipped).toHaveLength(3);
  });

  it("writes nothing on a dry run, but reports what it would copy", async () => {
    const { from, to } = seeded();
    const result = await migrateStorage(from.storage, to.storage, { dryRun: true });
    expect(result.copied).toHaveLength(3);
    expect(to.objects.size).toBe(0);
  });

  it("copies nothing from an empty volume", async () => {
    const result = await migrateStorage(makeStorage().storage, makeStorage().storage);
    expect(result).toEqual({ copied: [], skipped: [], ignored: [] });
  });
});
