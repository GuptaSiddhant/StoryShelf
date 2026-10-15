import { createShelfLogger } from "@storyshelf/core/logger";
import { DesignCredentialModel, DesignModel } from "@storyshelf/core/models";
import { fakeUrl, makeFakeDesign } from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const URL_A = fakeUrl("AAA", "1:2");
const URL_B = fakeUrl("BBB", "1:2");
const NOW = "2026-01-01T00:00:00.000Z";
const silent = createShelfLogger({ level: "silent" });

async function setup() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return {
    db,
    model: new DesignModel(db, [makeFakeDesign().provider]),
    credentials: new DesignCredentialModel(db, "design-test-secret"),
  };
}

describe("design links on a real database", () => {
  it("enforces one mapping per story file but allows many project-level links", async () => {
    const { db, model } = await setup();
    const row = (id: string, importPath: string | null) =>
      db.insert(db.tables.designLinks, {
        id,
        projectId: "p1",
        importPath,
        label: null,
        url: URL_A,
        createdAt: NOW,
        updatedAt: NOW,
      } as never);
    await row("a", "src/A.stories.tsx");
    await expect(row("b", "src/A.stories.tsx")).rejects.toThrow();
    await row("c", null);
    await row("d", null);
    expect(await model.projectLinks("p1")).toHaveLength(2);
  });

  it("converges concurrent mapping writes to a single row", async () => {
    const { model } = await setup();
    await Promise.all(
      [URL_A, URL_B, URL_A, URL_B, URL_A].map(
        async (url) => await model.setComponentLink("p1", "./src/A.stories.tsx", url),
      ),
    );
    expect(await model.componentLinks("p1")).toHaveLength(1);
  });
});

describe("design credentials on a real database", () => {
  it("converges concurrent writes for one scope to a single row", async () => {
    const { credentials } = await setup();
    await Promise.all(
      ["one", "two", "three"].map(
        async (token) => await credentials.set("p1", "fake", `tok_${token}`),
      ),
    );
    expect(await credentials.get("p1", "fake")).toMatch(/^tok_/u);
  });

  it("allows one credential per project and provider", async () => {
    const { db, credentials } = await setup();
    await credentials.set("p1", "fake", "project-wide");
    await credentials.set("p1", "fake", "rotated");
    await credentials.set("p1", "other", "other-provider");
    expect(await db.count(db.tables.designCredentials)).toBe(2);
    expect(await credentials.get("p1", "fake")).toBe("rotated");
  });
});

describe("legacy Figma tables", () => {
  it("are dropped on setup, and setup stays idempotent", async () => {
    const db = createSqliteDatabase(":memory:");
    await db.all(sql`CREATE TABLE figma_nodes (id TEXT PRIMARY KEY)`);
    await db.all(sql`CREATE TABLE design_tokens (id TEXT PRIMARY KEY)`);
    await db.lifecycle?.setup({ config: {}, logger: silent });
    await db.lifecycle?.setup({ config: {}, logger: silent });
    const rows = await db.all<unknown[]>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('figma_nodes','design_tokens','design_nodes','design_credentials')`,
    );
    expect(rows.map((row) => String(row[0])).toSorted()).toEqual([
      "design_credentials",
      "design_nodes",
    ]);
  });
});
