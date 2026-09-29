import { describe, expect, it } from "vitest";
import { makeDatabase } from "./fake-database.ts";

const now = "2026-01-01T00:00:00.000Z";

async function seedProject(db: ReturnType<typeof makeDatabase>["db"], id = "p1"): Promise<void> {
  await db.insert(db.tables.projects, {
    id,
    name: `Project ${id}`,
    slug: `slug-${id}`,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
}

describe("makeDatabase transact", () => {
  it("commits writes and returns the callback value", async () => {
    const { db } = makeDatabase();
    const result = await db.transact?.(async (tx) => {
      await tx.insert(db.tables.projects, {
        id: "p1",
        name: "Tx",
        slug: "tx",
        gitDefaultBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
      return "done";
    });
    expect(result).toBe("done");
    expect(await db.get(db.tables.projects, "p1")).not.toBeNull();
  });

  it("rolls back writes when the callback throws", async () => {
    const { db } = makeDatabase();
    await seedProject(db, "keep");
    await expect(
      db.transact?.(async (tx) => {
        await tx.insert(db.tables.projects, {
          id: "p2",
          name: "Doomed",
          slug: "doomed",
          gitDefaultBranch: "main",
          createdAt: now,
          updatedAt: now,
        });
        await tx.remove(db.tables.projects, "keep");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.get(db.tables.projects, "p2")).toBeNull();
    expect(await db.get(db.tables.projects, "keep")).not.toBeNull();
  });
});
