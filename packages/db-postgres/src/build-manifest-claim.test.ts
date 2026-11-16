import { createShelfLogger } from "@storyshelf/core/logger";
/** `builds.manifest_sha256` claim of write-once published builds, on embedded Postgres (PGlite). */
import { BuildModel } from "@storyshelf/core/models";
import { expect, it, vi } from "vitest";
import { createPgliteDatabase } from "./pglite.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const silent = createShelfLogger({ level: "silent" });
const T0 = "2026-01-01T00:00:00.000Z";

async function seeded() {
  const db = createPgliteDatabase();
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "b1",
    gitBranch: "feature/x",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  return { db, builds: new BuildModel(db) };
}

it("claims a manifest once: the same hash again is a duplicate, another hash a conflict", async () => {
  const { builds } = await seeded();
  const claims = await Promise.all(
    Array.from({ length: 5 }, async () => await builds.claimManifest("b1", "a".repeat(64))),
  );
  expect(claims.filter((claim) => claim === "claimed")).toHaveLength(1);
  expect(claims.filter((claim) => claim === "duplicate")).toHaveLength(4);
  expect(await builds.claimManifest("b1", "b".repeat(64))).toBe("conflict");
  expect(await builds.claimManifest("gone", "a".repeat(64))).toBe("missing");
});

it("releases only the claim it names, so a corrected manifest can be claimed", async () => {
  const { db, builds } = await seeded();
  await builds.claimManifest("b1", "a".repeat(64));
  await builds.releaseManifest("b1", "b".repeat(64));
  expect(await builds.claimManifest("b1", "b".repeat(64))).toBe("conflict");
  await builds.releaseManifest("b1", "a".repeat(64));
  expect(await db.get(db.tables.builds, "b1")).toMatchObject({ manifestSha256: null });
  expect(await builds.claimManifest("b1", "b".repeat(64))).toBe("claimed");
});
