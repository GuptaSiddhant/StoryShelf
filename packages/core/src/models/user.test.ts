import { describe, expect, it } from "vitest";
import { users } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { UserModel } from "./user.ts";

describe("UserModel", () => {
  it("inserts a new user on first upsert", async () => {
    const { db } = makeDatabase();
    const model = new UserModel(db, { users });
    const user = await model.upsert({
      id: "u1",
      email: "u@example.com",
      name: "U",
      avatarUrl: null,
      role: "member",
    });
    expect(user.id).toBe("u1");
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("refreshes profile fields and role on subsequent upserts", async () => {
    const { db } = makeDatabase();
    const model = new UserModel(db, { users });
    await model.upsert({
      id: "u1",
      email: "old@example.com",
      name: "Old",
      avatarUrl: null,
      role: "member",
    });
    const updated = await model.upsert({
      id: "u1",
      email: "new@example.com",
      name: "New",
      avatarUrl: "https://example.com/a.png",
      role: "admin",
    });
    expect(updated.email).toBe("new@example.com");
    expect(updated.name).toBe("New");
    expect(updated.role).toBe("admin");
  });

  it("returns null for unknown users", async () => {
    const { db } = makeDatabase();
    const model = new UserModel(db, { users });
    await expect(model.get("missing")).resolves.toBeNull();
  });
});
