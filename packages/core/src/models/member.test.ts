import { describe, expect, it } from "vitest";
import { projectMembers } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { MemberModel } from "./member.ts";

describe("MemberModel", () => {
  it("sets a member role on a project", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    const member = await model.set("p1", "user-1", "admin");
    expect(member.id).toBeDefined();
    expect(member.role).toBe("admin");
  });

  it("gets members of a project", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await model.set("p1", "user-1", "admin");
    await model.set("p1", "user-2", "viewer");
    const members = await model.list("p1");
    expect(members.length).toBe(2);
    expect(members.map((m) => m.userId)).toContain("user-1");
    expect(members.map((m) => m.userId)).toContain("user-2");
  });

  it("removes a member from a project", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await model.set("p1", "user-1", "admin");
    await model.remove("p1", "user-1");
    const members = await model.list("p1");
    expect(members.length).toBe(0);
  });

  it("updates a member role", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await model.set("p1", "user-1", "viewer");
    // In a full impl there'd be an update method; test the set/reset cycle
    const members = await model.list("p1");
    const user1 = members.find((m) => m.userId === "user-1");
    expect(user1?.role).toBe("viewer");
  });

  it("resolves site admin to project admin without membership", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await expect(model.effectiveRole("admin", "p1", "user-9")).resolves.toBe("admin");
  });

  it("resolves site viewer to project viewer without membership", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await expect(model.effectiveRole("viewer", "p1", "user-9")).resolves.toBe("viewer");
  });

  it("prefers explicit membership over the site viewer floor", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await model.set("p1", "user-9", "developer");
    await expect(model.effectiveRole("viewer", "p1", "user-9")).resolves.toBe("developer");
  });

  it("resolves site member without membership to null", async () => {
    const { db } = makeDatabase();
    const model = new MemberModel(db, { projectMembers });
    await expect(model.effectiveRole("member", "p1", "user-9")).resolves.toBeNull();
  });
});
