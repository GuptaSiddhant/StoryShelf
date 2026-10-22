import { describe, expect, it } from "vitest";
import { BuildComponentModel } from "../../models/build-component.ts";
import { storybookDir } from "../../utils/paths.ts";
import { catalogueBuild, readCatalog } from "./catalogue.ts";
import { INDEX, seedPublished } from "./test-fixtures.ts";

describe("catalogueBuild", () => {
  it("writes catalog.json and one build_components row per component", async () => {
    const { db, storage, project, build, objects, catalogKey } = await seedPublished();
    const catalog = await catalogueBuild({ db, storage }, project.id, build.id);
    expect(catalog?.entries).toHaveLength(4);
    expect(objects.has(catalogKey)).toBe(true);
    const rows = await new BuildComponentModel(db).listByBuild(build.id);
    expect(rows.map((row) => [row.title, row.importPath, row.storyCount])).toEqual([
      ["Components/Button", "src/Button.stories.tsx", 2],
      ["Components/Card", "src/Card.stories.tsx", 1],
    ]);
    expect(rows.every((row) => row.projectId === project.id && row.hash.length === 64)).toBe(true);
  });

  it("replaces the rows when a build is catalogued again", async () => {
    const { db, storage, project, build, publish } = await seedPublished();
    await catalogueBuild({ db, storage }, project.id, build.id);
    publish(build.id, { v: 5, entries: { only: { id: "only", title: "Only", name: "Only" } } });
    await catalogueBuild({ db, storage }, project.id, build.id);
    const rows = await new BuildComponentModel(db).listByBuild(build.id);
    expect(rows.map((row) => row.title)).toEqual(["Only"]);
  });

  it("reads a content-addressed build through its manifest", async () => {
    const { db, storage, project, build, objects } = await seedPublished();
    objects.delete(`${storybookDir(project.id, build.id)}/index.json`);
    objects.set(
      `${storybookDir(project.id, build.id)}/manifest.json`,
      Buffer.from('{"index.json":"h"}'),
    );
    objects.set("content/h", Buffer.from(JSON.stringify(INDEX)));
    expect((await catalogueBuild({ db, storage }, project.id, build.id))?.entries).toHaveLength(4);
  });

  it("uses stories.json when there is no index.json", async () => {
    const { db, storage, project, build, objects } = await seedPublished();
    const dir = storybookDir(project.id, build.id);
    objects.delete(`${dir}/index.json`);
    objects.set(`${dir}/stories.json`, Buffer.from(JSON.stringify(INDEX)));
    expect((await catalogueBuild({ db, storage }, project.id, build.id))?.entries).toHaveLength(4);
  });

  it("skips an index that is not JSON and writes nothing when no index parses", async () => {
    const { db, storage, project, build, objects, catalogKey } = await seedPublished();
    const dir = storybookDir(project.id, build.id);
    objects.set(`${dir}/index.json`, Buffer.from("<html>"));
    expect(await catalogueBuild({ db, storage }, project.id, build.id)).toBeNull();
    expect(objects.has(catalogKey)).toBe(false);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toEqual([]);
  });
});

describe("catalogueBuild failure", () => {
  it("leaves no catalog.json when the rows cannot be written, so the next view tries again", async () => {
    const { db, storage, project, build, objects, catalogKey } = await seedPublished();
    const insert = db.insert.bind(db);
    db.insert = (async () => {
      throw new Error("database unavailable");
    }) as typeof insert;
    await expect(catalogueBuild({ db, storage }, project.id, build.id)).rejects.toThrow(
      "database unavailable",
    );
    expect(objects.has(catalogKey)).toBe(false);
  });
});

describe("readCatalog", () => {
  it("round-trips a written catalog and is null when missing or damaged", async () => {
    const { db, storage, project, build, objects, catalogKey } = await seedPublished();
    expect(await readCatalog(storage, project.id, build.id)).toBeNull();
    await catalogueBuild({ db, storage }, project.id, build.id);
    expect((await readCatalog(storage, project.id, build.id))?.entries).toHaveLength(4);
    objects.set(catalogKey, Buffer.from("{broken"));
    expect(await readCatalog(storage, project.id, build.id)).toBeNull();
    objects.set(catalogKey, Buffer.from('{"v":2,"entries":[]}'));
    expect(await readCatalog(storage, project.id, build.id)).toBeNull();
  });
});
