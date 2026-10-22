import { describe, expect, it } from "vitest";
import { BuildComponentModel } from "../../models/build-component.ts";
import { createTestBuild } from "../../test-helpers/create-project.ts";
import { catalogPath } from "../../utils/paths.ts";
import { createCatalogLoader } from "./load.ts";
import { seedPublished } from "./test-fixtures.ts";

describe("createCatalogLoader", () => {
  it("catalogues a build that has no catalog on first view, once", async () => {
    const { db, storage, project, build, objects, catalogKey } = await seedPublished();
    const loader = createCatalogLoader({ db, storage });
    expect((await loader.load(project.id, build.id))?.entries).toHaveLength(4);
    expect(objects.has(catalogKey)).toBe(true);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toHaveLength(2);
    // the second view is served from memory: even with the file gone it answers
    objects.delete(catalogKey);
    expect((await loader.load(project.id, build.id))?.entries).toHaveLength(4);
  });

  it("serves a stored catalog without touching the index or the table", async () => {
    const { db, storage, project, build, objects, catalogKey } = await seedPublished();
    objects.set(
      catalogKey,
      Buffer.from(
        JSON.stringify({
          v: 1,
          entries: [{ id: "x", title: "X", name: "X", importPath: "", type: "story", tags: [] }],
        }),
      ),
    );
    const catalog = await createCatalogLoader({ db, storage }).load(project.id, build.id);
    expect(catalog?.entries.map((entry) => entry.id)).toEqual(["x"]);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toEqual([]);
  });

  it("is null for a build with no readable index, and tries again next time", async () => {
    const { db, storage, project, build, publish } = await seedPublished("<html>");
    const loader = createCatalogLoader({ db, storage });
    expect(await loader.load(project.id, build.id)).toBeNull();
    publish(build.id, { entries: { a: { id: "a", title: "A", name: "A" } } });
    expect((await loader.load(project.id, build.id))?.entries).toHaveLength(1);
  });

  it("shares one cataloguing between concurrent first views", async () => {
    const { db, storage, project, build } = await seedPublished();
    const loader = createCatalogLoader({ db, storage });
    const [one, two] = await Promise.all([
      loader.load(project.id, build.id),
      loader.load(project.id, build.id),
    ]);
    expect(one).toEqual(two);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toHaveLength(2);
  });

  it("evicts the least recently used catalog beyond the cache size", async () => {
    const { db, storage, project, build, publish, objects } = await seedPublished();
    const other = await createTestBuild(db, db.tables, project.id, { gitSha: "sha-2" });
    publish(other.id, { entries: { a: { id: "a", title: "A", name: "A" } } });
    const loader = createCatalogLoader({ db, storage, cacheSize: 1 });
    await loader.load(project.id, build.id);
    await loader.load(project.id, other.id);
    objects.delete(catalogPath(project.id, build.id));
    for (const key of [...objects.keys()].filter((k) => k.includes(`${build.id}/storybook`))) {
      objects.delete(key);
    }
    expect(await loader.load(project.id, build.id)).toBeNull();
    expect((await loader.load(project.id, other.id))?.entries).toHaveLength(1);
  });

  it("refresh catalogues again from the statics and replaces the cached catalog", async () => {
    const { db, storage, project, build, publish } = await seedPublished();
    const loader = createCatalogLoader({ db, storage });
    await loader.load(project.id, build.id);
    publish(build.id, { entries: { a: { id: "a", title: "A", name: "A" } } });
    expect((await loader.refresh(project.id, build.id))?.entries).toHaveLength(1);
    expect((await loader.load(project.id, build.id))?.entries).toHaveLength(1);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toHaveLength(1);
  });

  it("refresh is null, and forgets the cache, when the index is gone", async () => {
    const { db, storage, project, build, publish } = await seedPublished();
    const loader = createCatalogLoader({ db, storage });
    await loader.load(project.id, build.id);
    publish(build.id, "nope");
    expect(await loader.refresh(project.id, build.id)).toBeNull();
  });
});
