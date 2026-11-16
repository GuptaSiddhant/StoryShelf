import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { UserModel } from "./user.ts";

describe("UserModel", () => {
  it("inserts a new user on first upsert", async () => {
    const { db } = makeDatabase();
    const model = new UserModel(db, { users: db.tables.users });
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

  it("finds a user by email, ignoring case and blanks", async () => {
    const { db } = makeDatabase();
    const model = new UserModel(db, { users: db.tables.users });
    await model.upsert({ id: "u1", email: "u@example.com", name: "U", role: "member" });
    expect((await model.getByEmail(" u@example.com "))?.id).toBe("u1");
    expect((await model.getByEmail("U@Example.com"))?.id).toBe("u1");
    expect(await model.getByEmail("nobody@example.com")).toBeNull();
    expect(await model.getByEmail("  ")).toBeNull();
  });

  it("refreshes profile fields and role on subsequent upserts", async () => {
    const { db } = makeDatabase();
    const model = new UserModel(db, { users: db.tables.users });
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
    const model = new UserModel(db, { users: db.tables.users });
    await expect(model.get("missing")).resolves.toBeNull();
  });
});
