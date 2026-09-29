import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { MemberModel, ProjectGroupMappingModel, UserModel } from "@storyshelf/core/models";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { describe, expect, it } from "vitest";
import type { ShelfSSOProvider } from "./engine.ts";
import { extractGroups, provisionHook, resolveSiteRole, syncSsoGroups } from "./groups.ts";

async function testDb(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

async function seedProject(db: DatabaseAdapter, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id,
    name: id,
    slug: id,
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
}

function provider(overrides?: Partial<ShelfSSOProvider>): ShelfSSOProvider {
  return {
    id: "acme",
    label: "Acme",
    domain: "example.com",
    groups: { claim: ["groups", "cognito:groups"], admins: ["shelf-admins"] },
    ...overrides,
  };
}

describe("extractGroups", () => {
  it("reads arrays, lone strings, and first-hit claim names", () => {
    expect(extractGroups({ groups: ["a", "b", "a"] })).toEqual(["a", "b"]);
    expect(extractGroups({ groups: "Shelf Admins" })).toEqual(["Shelf Admins"]);
    expect(
      extractGroups({ other: ["x"], "cognito:groups": ["y"] }, ["groups", "cognito:groups"]),
    ).toEqual(["y"]);
    expect(extractGroups({ groups: ["ok", 42, null] })).toEqual(["ok"]);
    expect(extractGroups({})).toEqual([]);
  });
});

describe("resolveSiteRole", () => {
  it("reconciles against admin groups and preserves otherwise", () => {
    expect(resolveSiteRole("member", ["shelf-admins", "x"], ["shelf-admins"])).toBe("admin");
    expect(resolveSiteRole("admin", ["x"], ["shelf-admins"])).toBe("member");
    expect(resolveSiteRole("admin", ["x"])).toBe("admin");
    expect(resolveSiteRole("viewer", ["x"], [])).toBe("viewer");
  });
});

describe("syncSsoGroups", () => {
  it("promotes admins and reconciles project memberships", async () => {
    const db = await testDb();
    await seedProject(db, "p1");
    const mappings = new ProjectGroupMappingModel(db);
    await mappings.create("p1", "team-a", "developer");
    await mappings.create("p1", "team-b", "approver");
    await new UserModel(db).upsert({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: null,
      role: "member",
    });

    await syncSsoGroups(db, [provider()], {
      userId: "u1",
      email: "ada@example.com",
      name: "Ada",
      userInfo: { groups: ["shelf-admins", "team-b"] },
      providerId: "acme",
    });

    expect((await new UserModel(db).get("u1"))?.role).toBe("admin");
    expect(await new MemberModel(db).get("p1", "u1")).toMatchObject({
      role: "approver",
      source: "sso:team-b",
    });

    await syncSsoGroups(db, [provider()], {
      userId: "u1",
      email: "ada@example.com",
      name: "Ada",
      userInfo: { groups: ["team-a"] },
      providerId: "acme",
    });

    expect((await new UserModel(db).get("u1"))?.role).toBe("member");
    expect(await new MemberModel(db).get("p1", "u1")).toMatchObject({
      role: "developer",
      source: "sso:team-a",
    });
  });

  it("ignores providers without groups config and keeps manual grants", async () => {
    const db = await testDb();
    await seedProject(db, "p1");
    await new UserModel(db).upsert({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: null,
      role: "member",
    });
    await new MemberModel(db).set("p1", "u1", "admin", "manual");

    const { id, label, domain } = provider();
    const bare: ShelfSSOProvider = { id, label, domain };
    await syncSsoGroups(db, [bare], {
      userId: "u1",
      email: "ada@example.com",
      name: "Ada",
      userInfo: { groups: ["team-a"] },
      providerId: "acme",
    });
    expect(await new MemberModel(db).get("p1", "u1")).toMatchObject({
      role: "admin",
      source: "manual",
    });

    const mappings = new ProjectGroupMappingModel(db);
    await mappings.create("p1", "team-a", "viewer");
    await syncSsoGroups(db, [provider({ groups: { claim: "groups" } })], {
      userId: "u1",
      email: "ada@example.com",
      name: "Ada",
      userInfo: { groups: ["team-a"] },
      providerId: "acme",
    });
    // Manual grant survives even though a mapping now matches.
    expect(await new MemberModel(db).get("p1", "u1")).toMatchObject({
      role: "admin",
      source: "manual",
    });
  });

  it("creates the shelf row on first SSO login", async () => {
    const db = await testDb();
    await syncSsoGroups(db, [provider()], {
      userId: "fresh",
      email: "fresh@example.com",
      name: "Fresh",
      userInfo: {},
      providerId: "acme",
    });
    expect(await new UserModel(db).get("fresh")).toMatchObject({
      email: "fresh@example.com",
      role: "member",
    });
  });

  it("maps plugin payloads through the provision hook", async () => {
    const db = await testDb();
    await seedProject(db, "p1");
    await new ProjectGroupMappingModel(db).create("p1", "team-a", "developer");
    const hook = provisionHook(db, [provider()]);
    await hook({
      user: { id: "u9", email: "zed@example.com", name: "Zed" },
      userInfo: { groups: ["shelf-admins", "team-a"] },
      provider: { providerId: "acme" },
    });
    expect(await new UserModel(db).get("u9")).toMatchObject({ role: "admin" });
    expect(await new MemberModel(db).get("p1", "u9")).toMatchObject({
      role: "developer",
      source: "sso:team-a",
    });

    await hook({
      user: { id: "u9", email: "zed@example.com", name: "Zed" },
      userInfo: { groups: ["team-a"] },
      provider: { providerId: "other" },
    });
    // Unknown provider ids are no-ops.
    expect(await new UserModel(db).get("u9")).toMatchObject({ role: "admin" });
  });
});
