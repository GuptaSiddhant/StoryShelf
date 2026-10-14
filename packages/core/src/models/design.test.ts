import { describe, expect, it, vi } from "vitest";
import { InvalidDesignUrlError } from "../adapters/design.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { fakeUrl, makeFakeDesign } from "../test-helpers/fake-design.ts";
import { DesignModel } from "./design.ts";

const A = fakeUrl("AAA", "1");
const B = fakeUrl("BBB");

function setup(): { model: DesignModel; db: ReturnType<typeof makeDatabase>["db"] } {
  const { db } = makeDatabase();
  return { db, model: new DesignModel(db, [makeFakeDesign().provider]) };
}

/** Make the first insert lose a race: a competing row lands, then the insert fails. */
function loseFirstInsert(
  db: ReturnType<typeof makeDatabase>["db"],
  competitor: () => Promise<void>,
): void {
  const real = db.insert.bind(db);
  let first = true;
  vi.spyOn(db, "insert").mockImplementation(async (table, values) => {
    if (first) {
      first = false;
      await competitor();
      throw new Error("UNIQUE constraint failed");
    }
    return await real(table, values);
  });
}

describe("DesignModel links", () => {
  it("adds project links and rejects links no provider accepts", async () => {
    const { model } = setup();
    await model.addProjectLink("p1", { label: " Kit ", url: A });
    const error = await model
      .addProjectLink("p1", { label: "x", url: "https://x.com" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidDesignUrlError);
    expect((error as Error).message).toContain("design.test");
    const links = await model.projectLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: "Kit", importPath: null });
    await expect(model.projectLinks("p2")).resolves.toEqual([]);
  });

  it("rejects every link when no provider is configured", async () => {
    const { db } = makeDatabase();
    const model = new DesignModel(db, []);
    await expect(model.setComponentLink("p1", "a.tsx", A)).rejects.toBeInstanceOf(
      InvalidDesignUrlError,
    );
  });

  it("upserts component mappings by normalized path", async () => {
    const { model } = setup();
    await model.setComponentLink("p1", "./src/A.stories.tsx", A);
    await model.setComponentLink("p1", "src/A.stories.tsx", B);
    const links = await model.componentLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ importPath: "src/A.stories.tsx", url: B });
    await expect(model.projectLinks("p1")).resolves.toEqual([]);
  });

  it("removes links scoped to the project", async () => {
    const { model } = setup();
    await model.setComponentLink("p1", "a.tsx", A);
    const [link] = await model.componentLinks("p1");
    await model.removeLink("p2", link?.id ?? "");
    expect(await model.componentLinks("p1")).toHaveLength(1);
    await model.removeLink("p1", link?.id ?? "");
    expect(await model.componentLinks("p1")).toHaveLength(0);
  });

  it("converges a lost component-mapping insert onto one updated row", async () => {
    const { db, model } = setup();
    const real = db.insert.bind(db);
    loseFirstInsert(db, async () => {
      await real(db.tables.designLinks, {
        id: "rival",
        projectId: "p1",
        importPath: "a.tsx",
        label: null,
        url: A,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as never);
    });
    await model.setComponentLink("p1", "./a.tsx", B);
    const links = await model.componentLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "rival", url: B });
  });

  it("rethrows when the insert fails for a reason other than a rival row", async () => {
    const { db, model } = setup();
    vi.spyOn(db, "insert").mockRejectedValue(new Error("disk full"));
    await expect(model.setComponentLink("p1", "a.tsx", A)).rejects.toThrow("disk full");
  });
});
