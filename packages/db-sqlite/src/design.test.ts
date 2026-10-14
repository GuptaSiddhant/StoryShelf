import { createShelfLogger } from "@storyshelf/core/logger";
import { DesignModel } from "@storyshelf/core/models";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const URL_A = "https://www.figma.com/design/AAA/Kit?node-id=1-2";
const URL_B = "https://www.figma.com/design/BBB/Kit?node-id=1-2";
const NOW = "2026-01-01T00:00:00.000Z";

async function setup() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return { db, model: new DesignModel(db, undefined, "design-test-secret") };
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

  it("converges concurrent token writes to a single row", async () => {
    const { model } = await setup();
    await Promise.all(
      ["one", "two", "three"].map(async (token) => await model.setToken("p1", `figd_${token}`)),
    );
    expect(await model.getToken("p1")).toMatch(/^figd_/u);
  });
});
