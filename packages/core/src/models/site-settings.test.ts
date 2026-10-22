import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { SiteSettingsModel } from "./site-settings.ts";

describe("SiteSettingsModel", () => {
  it("returns null for a setting never written", async () => {
    const { db } = makeDatabase();
    expect(await new SiteSettingsModel(db).get("public_origin")).toBeNull();
  });

  it("writes, replaces and removes a setting", async () => {
    const { db } = makeDatabase();
    const model = new SiteSettingsModel(db);
    await model.set("k", "one", "user-1");
    expect(await model.get("k")).toBe("one");
    await model.set("k", "two");
    expect(await model.get("k")).toBe("two");
    const row = await db.get(db.tables.siteSettings, "k");
    expect(row).toMatchObject({ value: "two", updatedBy: null });
    await model.remove("k");
    expect(await model.get("k")).toBeNull();
    await model.remove("k");
  });

  it("lets a write win when another instance inserted the key first", async () => {
    const { db } = makeDatabase();
    const model = new SiteSettingsModel(db);
    const insert = db.insert.bind(db);
    let raced = false;
    db.insert = (async (
      table: Parameters<typeof insert>[0],
      values: Parameters<typeof insert>[1],
    ) => {
      if (!raced) {
        raced = true;
        await insert(table, { ...values, value: "other" });
        throw new Error("unique violation");
      }
      return await insert(table, values);
    }) as typeof db.insert;
    await model.set("k", "mine");
    expect(await model.get("k")).toBe("mine");
  });

  it("rethrows an insert failure that left no row behind", async () => {
    const { db } = makeDatabase();
    db.insert = (async () => {
      await Promise.resolve();
      throw new Error("disk full");
    }) as typeof db.insert;
    await expect(new SiteSettingsModel(db).set("k", "v")).rejects.toThrow("disk full");
  });
});
