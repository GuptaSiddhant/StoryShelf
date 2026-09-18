import { MemberModel, ProjectGroupMappingModel, UserModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import {
  projectGroupMappings,
  projectMembers,
  projects,
  users,
} from "@storyshelf/db-sqlite/schema";
import { describe, expect, it } from "vitest";
import { syncLoginMemberships } from "./auth-sync.ts";

async function seedProject(db: ReturnType<typeof makeDatabase>["db"], id = "p1"): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(projects, {
    id,
    name: `Project ${id}`,
    slug: `slug-${id}`,
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
}

const baseUser = {
  id: "u1",
  email: "u@example.com",
  name: "U",
  avatarUrl: undefined,
  role: "member" as const,
};

function tables() {
  return { users, projects, projectMembers, projectGroupMappings };
}

describe("syncLoginMemberships", () => {
  it("upserts the user row on every login", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await syncLoginMemberships(db, tables(), baseUser);
    const stored = await new UserModel(db, { users }).get("u1");
    expect(stored?.email).toBe("u@example.com");

    await syncLoginMemberships(db, tables(), { ...baseUser, name: "Renamed" });
    const updated = await new UserModel(db, { users }).get("u1");
    expect(updated?.name).toBe("Renamed");
  });

  it("grants the highest matched role and records provenance", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    const mappings = new ProjectGroupMappingModel(db, { projectGroupMappings });
    await mappings.create("p1", "team-view", "viewer");
    await mappings.create("p1", "team-dev", "developer");

    await syncLoginMemberships(db, tables(), { ...baseUser, groups: ["team-view", "team-dev"] });

    const members = new MemberModel(db, { projectMembers });
    const member = await members.get("p1", "u1");
    expect(member?.role).toBe("developer");
    expect(member?.source).toBe("oidc:team-dev");
  });

  it("removes synced grants the user no longer matches, keeping manual ones", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await seedProject(db, "p2");
    const mappings = new ProjectGroupMappingModel(db, { projectGroupMappings });
    await mappings.create("p1", "team-a", "developer");
    const members = new MemberModel(db, { projectMembers });
    await members.set("p2", "u1", "viewer", "manual");

    await syncLoginMemberships(db, tables(), { ...baseUser, groups: ["team-a"] });
    expect(await members.get("p1", "u1")).not.toBeNull();

    await syncLoginMemberships(db, tables(), { ...baseUser, groups: [] });
    expect(await members.get("p1", "u1")).toBeNull();
    expect(await members.get("p2", "u1")).not.toBeNull();
  });

  it("does nothing when the project has no mappings", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await syncLoginMemberships(db, tables(), { ...baseUser, groups: ["team-a"] });
    const members = new MemberModel(db, { projectMembers });
    expect(await members.get("p1", "u1")).toBeNull();
  });
});
