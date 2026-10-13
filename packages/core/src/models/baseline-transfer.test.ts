import { describe, expect, it } from "vitest";
import type { Baseline } from "../schema/baseline.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { baselinePath } from "../utils/paths.ts";
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
    expect(row?.screenshotPath).toBe(baselinePath("p2", "main", "button--primary", "desktop"));
    expect((await baselines.read(row!)).toString("latin1")).toContain(":main:chromium");
    expect(await baselines.getFor("p2", "button--primary", "desktop", "feature/x")).toBeNull();
  });

  it("is idempotent", async () => {
    const { transfer } = await seeded();
    const archive = await collect(await transfer.export("p1"));
    expect(await transfer.import("p1", archive)).toEqual({ imported: 4, created: 0, updated: 4 });
  });
});
