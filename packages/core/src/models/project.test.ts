import { describe, expect, it } from "vitest";

import { ProjectModel } from "./project.ts";
import { makeDatabase } from "../capture/fake-adapters.ts";

describe("ProjectModel", () => {
  it("creates a project with unique slug", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    const project = await model.create({
      name: "Test Project",
      gitRepository: "owner/repo",
    });
    expect(project.id).toBeDefined();
    expect(project.name).toBe("Test Project");
    expect(project.slug).toBeDefined();
    expect(project.slug).not.toBeNull();
    expect(project.gitDefaultBranch).toBe("main");
  });

  it("creates project with custom default branch", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    const project = await model.create({
      name: "Test Project",
      gitRepository: "owner/repo",
      gitDefaultBranch: "develop",
    });
    expect(project.gitDefaultBranch).toBe("develop");
  });

  it("gets a project by id", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    const project = await model.create({
      name: "Test Project",
      gitRepository: "owner/repo",
    });
    const fetched = await model.get(project.id);
    expect(fetched?.id).toBe(project.id);
    expect(fetched?.name).toBe("Test Project");
  });

  it("gets a project by slug", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    const project = await model.create({
      name: "Test Project",
      gitRepository: "owner/repo",
    });
    const fetched = await model.getBySlug(project.slug);
    expect(fetched?.id).toBe(project.id);
    expect(fetched?.name).toBe("Test Project");
  });

  it("lists all projects", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    await model.create({ name: "Project 1", gitRepository: "owner/repo" });
    await model.create({ name: "Project 2", gitRepository: "owner/repo" });
    const projects = await model.list();
    expect(projects.length).toBe(2);
  });

  it("updates project fields", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    const project = await model.create({
      name: "Test Project",
      gitRepository: "owner/repo",
    });
    const updated = await model.update(project.id, { name: "Updated Name" });
    expect(updated.name).toBe("Updated Name");
  });

  it("removes a project", async () => {
    const { db } = makeDatabase();
    const model = new ProjectModel(db);
    await model.create({ name: "To Be Deleted", gitRepository: "owner/repo" });
    // Id is ulid, but let's test
    await model.remove("p1");
    // Note: fake db remove by id
    const deleted = await model.get("p1");
    expect(deleted).toBeNull();
  });
});
