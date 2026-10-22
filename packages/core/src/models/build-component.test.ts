import { describe, expect, it } from "vitest";
import { createTestBuild, createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { BuildComponentModel } from "./build-component.ts";

const button = { importPath: "src/Button.stories.tsx", title: "Button", storyCount: 2, hash: "h1" };
const card = { importPath: "src/Card.stories.tsx", title: "Card", storyCount: 1, hash: "h2" };

async function setup() {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables);
  const first = await createTestBuild(db, db.tables, project.id, { gitSha: "a" });
  const second = await createTestBuild(db, db.tables, project.id, { gitSha: "b" });
  return { db, model: new BuildComponentModel(db), project, first, second };
}

describe("BuildComponentModel", () => {
  it("stores a build's components and lists them by title", async () => {
    const { model, project, first } = await setup();
    await model.replaceForBuild(project.id, first.id, [card, button]);
    const rows = await model.listByBuild(first.id);
    expect(rows.map((row) => row.title)).toEqual(["Button", "Card"]);
    expect(rows[0]).toMatchObject({ projectId: project.id, buildId: first.id, hash: "h1" });
  });

  it("replaces a build's rows and leaves other builds alone", async () => {
    const { model, project, first, second } = await setup();
    await model.replaceForBuild(project.id, first.id, [button, card]);
    await model.replaceForBuild(project.id, second.id, [button]);
    await model.replaceForBuild(project.id, first.id, [card]);
    expect((await model.listByBuild(first.id)).map((row) => row.title)).toEqual(["Card"]);
    expect(await model.listByBuild(second.id)).toHaveLength(1);
  });

  it("lists one story file's rows across builds, newest first", async () => {
    const { model, project, first, second } = await setup();
    await model.replaceForBuild(project.id, first.id, [button, card]);
    await new Promise((done) => setTimeout(done, 5));
    await model.replaceForBuild(project.id, second.id, [{ ...button, hash: "h3" }]);
    const rows = await model.listByImportPath(project.id, button.importPath);
    expect(rows.map((row) => row.buildId)).toEqual([second.id, first.id]);
    expect(await model.listByImportPath(project.id, "missing.tsx")).toEqual([]);
  });

  it("removes a build's rows and counts them", async () => {
    const { model, project, first, second } = await setup();
    await model.replaceForBuild(project.id, first.id, [button, card]);
    await model.replaceForBuild(project.id, second.id, [button]);
    expect(await model.removeForBuild(first.id)).toBe(2);
    expect(await model.listByBuild(first.id)).toEqual([]);
    expect(await model.listByBuild(second.id)).toHaveLength(1);
  });
});
