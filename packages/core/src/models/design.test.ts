import { describe, expect, it, vi } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { InvalidDesignUrlError } from "../utils/figma-url.ts";
import { DesignModel } from "./design.ts";

const SECRET = "test-secret-00000000";
const A = "https://www.figma.com/design/AAA/Kit?node-id=1-2";
const B = "https://www.figma.com/design/BBB/Other";

function setup(): DesignModel {
  const { db } = makeDatabase();
  return new DesignModel(db, undefined, SECRET);
}

describe("DesignModel links", () => {
  it("adds project links and rejects non-Figma urls", async () => {
    const model = setup();
    await model.addProjectLink("p1", { label: " Kit ", url: A });
    await expect(
      model.addProjectLink("p1", { label: "x", url: "https://x.com" }),
    ).rejects.toBeInstanceOf(InvalidDesignUrlError);
    const links = await model.projectLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: "Kit", importPath: null });
    await expect(model.projectLinks("p2")).resolves.toEqual([]);
  });

  it("upserts component mappings by normalized path", async () => {
    const model = setup();
    await model.setComponentLink("p1", "./src/A.stories.tsx", A);
    await model.setComponentLink("p1", "src/A.stories.tsx", B);
    const links = await model.componentLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ importPath: "src/A.stories.tsx", url: B });
    await expect(model.projectLinks("p1")).resolves.toEqual([]);
  });

  it("removes links scoped to the project", async () => {
    const model = setup();
    await model.setComponentLink("p1", "a.tsx", A);
    const [link] = await model.componentLinks("p1");
    await model.removeLink("p2", link?.id ?? "");
    expect(await model.componentLinks("p1")).toHaveLength(1);
    await model.removeLink("p1", link?.id ?? "");
    expect(await model.componentLinks("p1")).toHaveLength(0);
  });
});

describe("DesignModel token", () => {
  it("encrypts, rotates, tracks health and removes", async () => {
    const model = setup();
    expect(await model.tokenInfo("p1")).toBeNull();
    expect(await model.getToken("p1")).toBeNull();
    await model.recordTokenStatus("p1", "ok");
    await model.setToken("p1", "figd_one");
    const first = await model.tokenInfo("p1");
    expect(first?.tokenEncrypted).not.toContain("figd_one");
    expect(await model.getToken("p1")).toBe("figd_one");
    await model.recordTokenStatus("p1", "unauthorized");
    expect(await model.tokenInfo("p1")).toMatchObject({ status: "unauthorized" });
    await model.setToken("p1", "figd_two");
    expect(await model.getToken("p1")).toBe("figd_two");
    expect(await model.tokenInfo("p1")).toMatchObject({ id: first?.id, status: "unknown" });
    await model.removeToken("p1");
    expect(await model.tokenInfo("p1")).toBeNull();
    await model.removeToken("p1");
  });
});

describe("DesignModel token age", () => {
  it("keeps the rotation clock through status writes and restarts it on a new token", async () => {
    const model = setup();
    await model.setToken("p1", "figd_one");
    const first = await model.tokenInfo("p1");
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    await model.recordTokenStatus("p1", "ok");
    await model.recordTokenStatus("p1", "forbidden");
    await model.recordTokenStatus("p1", "ok");
    const after = await model.tokenInfo("p1");
    expect(after?.createdAt).toBe(first?.createdAt);
    expect(after?.updatedAt).toBe(first?.updatedAt);
    expect(after?.checkedAt).not.toBeNull();

    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    await model.setToken("p1", "figd_two");
    const rotated = await model.tokenInfo("p1");
    expect((rotated?.createdAt ?? "") > (first?.createdAt ?? "")).toBe(true);
  });
});

/** Make the first insert into `table` lose a race: a competing row lands, then the insert fails. */
function loseFirstInsert(
  db: ReturnType<typeof makeDatabase>["db"],
  competitor: () => Promise<void>,
) {
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

describe("DesignModel concurrent writes", () => {
  it("converges a lost component-mapping insert onto one updated row", async () => {
    const { db } = makeDatabase();
    const model = new DesignModel(db, undefined, SECRET);
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
    const { db } = makeDatabase();
    const model = new DesignModel(db, undefined, SECRET);
    vi.spyOn(db, "insert").mockRejectedValue(new Error("disk full"));
    await expect(model.setComponentLink("p1", "a.tsx", A)).rejects.toThrow("disk full");
    await expect(model.setToken("p1", "figd_x")).rejects.toThrow("disk full");
  });

  it("converges a lost token insert onto one rotated row", async () => {
    const { db } = makeDatabase();
    const model = new DesignModel(db, undefined, SECRET);
    const rival = new DesignModel(db, undefined, SECRET);
    const real = db.insert.bind(db);
    loseFirstInsert(db, async () => {
      const insert = db.insert;
      db.insert = real;
      await rival.setToken("p1", "figd_rival");
      db.insert = insert;
    });
    await model.setToken("p1", "figd_mine");
    expect(await model.getToken("p1")).toBe("figd_mine");
    expect(await db.count(db.tables.designTokens)).toBe(1);
  });
});
