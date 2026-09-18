import { describe, expect, it } from "vitest";
import { projectGroupMappings } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { ProjectGroupMappingModel } from "./project-group-mapping.ts";

describe("ProjectGroupMappingModel", () => {
  it("creates and lists mappings for a project", async () => {
    const { db } = makeDatabase();
    const model = new ProjectGroupMappingModel(db, { projectGroupMappings });
    const created = await model.create("p1", "team-design", "developer");
    expect(created.id).toBeDefined();
    expect(created.groupName).toBe("team-design");
    expect(created.role).toBe("developer");

    await model.create("p1", "team-admins", "admin");
    const listed = await model.list("p1");
    expect(listed).toHaveLength(2);
  });

  it("scopes listings to the project", async () => {
    const { db } = makeDatabase();
    const model = new ProjectGroupMappingModel(db, { projectGroupMappings });
    await model.create("p1", "team-a", "viewer");
    await model.create("p2", "team-b", "admin");
    expect(await model.list("p1")).toHaveLength(1);
    expect(await model.list("p2")).toHaveLength(1);
  });

  it("removes a mapping by id within the project only", async () => {
    const { db } = makeDatabase();
    const model = new ProjectGroupMappingModel(db, { projectGroupMappings });
    const created = await model.create("p1", "team-a", "viewer");
    await model.create("p1", "team-b", "admin");
    await model.remove("p1", created.id);
    expect(await model.list("p1")).toHaveLength(1);

    const other = await model.create("p2", "team-c", "viewer");
    await model.remove("p1", other.id);
    expect(await model.list("p2")).toHaveLength(1);
  });
});
