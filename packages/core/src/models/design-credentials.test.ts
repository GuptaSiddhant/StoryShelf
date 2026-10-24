import { describe, expect, it, vi } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { DesignCredentialModel } from "./design-credentials.ts";

const SECRET = "test-secret-00000000";

function setup(): { model: DesignCredentialModel; db: ReturnType<typeof makeDatabase>["db"] } {
  const { db } = makeDatabase();
  return { db, model: new DesignCredentialModel(db, SECRET) };
}

describe("DesignCredentialModel", () => {
  it("encrypts, rotates, tracks health and removes", async () => {
    const { model } = setup();
    expect(await model.info("p1", "fake")).toBeNull();
    expect(await model.get("p1", "fake")).toBeNull();
    await model.recordStatus("p1", "fake", "ok");
    await model.set("p1", "fake", "tok_one");
    const first = await model.info("p1", "fake");
    expect(first?.tokenEncrypted).not.toContain("tok_one");
    expect(first).toMatchObject({ provider: "fake", status: "unknown" });
    expect(await model.get("p1", "fake")).toBe("tok_one");
    await model.recordStatus("p1", "fake", "unauthorized");
    expect(await model.info("p1", "fake")).toMatchObject({ status: "unauthorized" });
    await model.set("p1", "fake", "tok_two");
    expect(await model.get("p1", "fake")).toBe("tok_two");
    expect(await model.info("p1", "fake")).toMatchObject({ id: first?.id, status: "unknown" });
    await model.remove("p1", "fake");
    expect(await model.info("p1", "fake")).toBeNull();
    await model.remove("p1", "fake");
  });

  it("keeps credentials separate per project and provider", async () => {
    const { model } = setup();
    await model.set("p1", "fake", "project-wide");
    await model.set("p1", "other", "other-provider");
    await model.set("p2", "fake", "other-project");
    expect(await model.get("p1", "fake")).toBe("project-wide");
    expect(await model.get("p1", "other")).toBe("other-provider");
    expect(await model.get("p2", "fake")).toBe("other-project");
    await model.remove("p1", "other");
    expect(await model.get("p1", "other")).toBeNull();
    expect(await model.get("p1", "fake")).toBe("project-wide");
  });

  it("keeps the rotation clock through status writes and restarts it on a new token", async () => {
    const { db, model } = setup();
    await model.set("p1", "fake", "tok_one");
    const first = await model.info("p1", "fake");
    if (!first) throw new Error("credential missing");
    const old = "2020-01-01T00:00:00.000Z";
    await db.update(db.tables.designCredentials, first.id, { createdAt: old, updatedAt: old });
    await model.recordStatus("p1", "fake", "ok");
    await model.recordStatus("p1", "fake", "forbidden");
    await model.recordStatus("p1", "fake", "ok");
    const after = await model.info("p1", "fake");
    expect(after?.createdAt).toBe(old);
    expect(after?.updatedAt).toBe(old);
    expect(after?.checkedAt).not.toBeNull();
    await model.set("p1", "fake", "tok_two");
    const rotated = await model.info("p1", "fake");
    expect((rotated?.createdAt ?? "") > old).toBe(true);
  });

  it("converges a lost insert onto one rotated row, and rethrows other failures", async () => {
    const { db, model } = setup();
    const rival = new DesignCredentialModel(db, SECRET);
    const real = db.insert.bind(db);
    let first = true;
    vi.spyOn(db, "insert").mockImplementation(async (table, values) => {
      if (first) {
        first = false;
        const mocked = db.insert;
        db.insert = real;
        await rival.set("p1", "fake", "tok_rival");
        db.insert = mocked;
        throw new Error("UNIQUE constraint failed");
      }
      return await real(table, values);
    });
    await model.set("p1", "fake", "tok_mine");
    expect(await model.get("p1", "fake")).toBe("tok_mine");
    expect(await db.count(db.tables.designCredentials)).toBe(1);

    vi.restoreAllMocks();
    vi.spyOn(db, "insert").mockRejectedValue(new Error("disk full"));
    await expect(model.set("p9", "fake", "x")).rejects.toThrow("disk full");
  });
});
