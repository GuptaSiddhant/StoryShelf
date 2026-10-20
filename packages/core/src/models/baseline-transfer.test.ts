import { describe, expect, it, vi } from "vitest";
import type { Baseline } from "../schema/baseline.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { BASELINE_ARCHIVE_LIMITS, BaselineArchiveError } from "./baseline-archive.ts";
import { BaselineTransferModel } from "./baseline-transfer.ts";
import { BaselineModel } from "./baseline.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (tag: string): Buffer => Buffer.concat([PNG_SIGNATURE, Buffer.from(tag)]);

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) {
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function seeded() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const baselines = new BaselineModel(db, undefined, storage);
  const seeds = [
    ["button--primary", "desktop", "main", "chromium"],
    ["button--primary", "mobile", "main", "chromium"],
    ["button--primary", "desktop", "main", "firefox"],
    ["button--primary", "desktop", "feature/x", "chromium"],
  ] as const;
  await Promise.all(
    seeds.map(async ([storyId, viewport, branch, browser]) => {
      const tag = `${storyId}:${viewport}:${branch}:${browser}`;
      await storage.write(`src/${tag}`, png(tag));
      await baselines.upsert("p1", storyId, viewport, branch, "snap", `src/${tag}`, "infra-1", {
        browser,
        mode: viewport === "mobile" ? '{"viewport":"mobile"}' : null,
      });
    }),
  );
  return { db, storage, objects, baselines, transfer: new BaselineTransferModel(db, storage) };
}

const strip = ({ id: _id, snapshotId: _snapshotId, ...rest }: Baseline) => rest;

describe("BaselineTransferModel", () => {
  it("round-trips: export -> wipe -> import restores identical baselines", async () => {
    const { db, objects, baselines, transfer } = await seeded();
    const before = (await baselines.list("p1")).map((row) => strip(row));
    const archive = await collect(await transfer.export("p1", { project: "demo" }));

    await Promise.all(
      (await baselines.list("p1")).map(async (row) => {
        objects.delete(row.screenshotPath);
        await db.remove(db.tables.baselines, row.id);
      }),
    );
    expect(await baselines.list("p1")).toEqual([]);

    expect(await transfer.import("p1", archive)).toEqual({ imported: 4, created: 4, updated: 0 });
    const after = (await baselines.list("p1")).map((row) => strip(row));
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(expect.arrayContaining(before));
    const resolved = await baselines.resolve(
      "p1",
      "button--primary",
      "desktop",
      "feature/x",
      "main",
    );
    expect((await baselines.read(resolved!)).toString("latin1")).toContain("feature/x");
  });

  it("imports into another project, overwriting existing baselines", async () => {
    const { transfer, baselines, storage } = await seeded();
    const archive = await collect(await transfer.export("p1", { branch: "main" }));
    await storage.write("src/old", png("old"));
    await baselines.upsert("p2", "button--primary", "desktop", "main", "s", "src/old");

    expect(await transfer.import("p2", archive)).toEqual({ imported: 3, created: 2, updated: 1 });
    const row = await baselines.getFor("p2", "button--primary", "desktop", "main");
    expect(row?.snapshotId).toBeNull();
    expect(row?.screenshotPath).toMatch(/^p2\/content\/[0-9a-f]{64}\.png$/u);
    expect((await baselines.read(row!)).toString("latin1")).toContain(":main:chromium");
    expect(await baselines.getFor("p2", "button--primary", "desktop", "feature/x")).toBeNull();
  });

  it("holds a content reuse claim while it reuses existing images", async () => {
    const { storage, objects, transfer } = await seeded();
    const archive = await collect(await transfer.export("p1", { project: "demo" }));
    const claimed = (): boolean => [...objects.keys()].some((key) => key.includes("/.claims/"));
    const seen: boolean[] = [];
    // Every image already exists, so each one is reused (the write is skipped).
    vi.spyOn(storage, "exists").mockImplementation(async (path) => {
      seen.push(claimed());
      return objects.has(path);
    });
    await transfer.import("p1", archive);
    expect(seen).toHaveLength(4);
    expect(seen.every(Boolean)).toBe(true);
    expect(claimed()).toBe(false);
  });

  it("is idempotent", async () => {
    const { transfer } = await seeded();
    const archive = await collect(await transfer.export("p1"));
    expect(await transfer.import("p1", archive)).toEqual({ imported: 4, created: 0, updated: 4 });
  });

  it("serializes concurrent imports so no duplicate rows are created", async () => {
    const { transfer, baselines } = await seeded();
    const archive = await collect(await transfer.export("p1"));
    const results = await Promise.all([
      transfer.import("p2", archive),
      transfer.import("p2", archive),
    ]);
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(4);
    expect(await baselines.list("p2")).toHaveLength(4);
  });

  it("applies the archive's createdAt when overwriting an existing baseline", async () => {
    const { transfer, baselines, storage } = await seeded();
    const archive = await collect(await transfer.export("p1", { branch: "main" }));
    await storage.write("src/old", png("old"));
    await baselines.upsert("p2", "button--primary", "desktop", "main", "s", "src/old");
    await transfer.import("p2", archive);
    const source = (await baselines.list("p1")).find(
      (row) =>
        row.branch === "main" && row.viewportName === "desktop" && row.browser === "chromium",
    );
    const row = await baselines.getFor("p2", "button--primary", "desktop", "main");
    expect(row?.createdAt).toBe(source?.createdAt);
  });

  it("reports skipped baselines whose image is missing, and aborts on other storage errors", async () => {
    const { transfer, baselines, storage, objects } = await seeded();
    const [victim] = await baselines.list("p1");
    objects.delete(victim!.screenshotPath);
    const onSkipped = vi.fn();
    const archive = await collect(await transfer.export("p1", { onSkipped }));
    expect(onSkipped).toHaveBeenCalledTimes(1);
    expect(archive.toString("latin1")).toContain('"skipped"');

    const read = vi.spyOn(storage, "read").mockRejectedValueOnce(new Error("S3 503"));
    await expect(collect(await transfer.export("p1"))).rejects.toThrow("S3 503");
    read.mockRestore();
  });

  it("keeps archive file names unique when two identities share a mode segment", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const baselines = new BaselineModel(db, undefined, storage);
    await storage.write("src/a", png("a"));
    await baselines.upsert("p1", "s--1", "a~firefox", "main", "snap", "src/a", null, {
      browser: "chromium",
    });
    await baselines.upsert("p1", "s--1", "a", "main", "snap", "src/a", null, {
      browser: "firefox",
    });
    const transfer = new BaselineTransferModel(db, storage);
    const archive = await collect(await transfer.export("p1"));
    expect(await transfer.import("p2", archive)).toEqual({ imported: 2, created: 2, updated: 0 });
  });

  it("fails an export that would outgrow the shared archive limit", async () => {
    const { transfer } = await seeded();
    const limits = BASELINE_ARCHIVE_LIMITS as { maxArchiveBytes: number };
    const original = limits.maxArchiveBytes;
    limits.maxArchiveBytes = BASELINE_ARCHIVE_LIMITS.maxManifestBytes + 100;
    try {
      await expect(collect(await transfer.export("p1"))).rejects.toThrow(BaselineArchiveError);
    } finally {
      limits.maxArchiveBytes = original;
    }
  });
});
