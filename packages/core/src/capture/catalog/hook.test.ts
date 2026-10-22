import { describe, expect, it } from "vitest";
import { BuildComponentModel } from "../../models/build-component.ts";
import { stubLogger } from "../consumer/test-fixtures.ts";
import { createCatalogHook } from "./hook.ts";
import { createCatalogLoader } from "./load.ts";
import { seedPublished } from "./test-fixtures.ts";

async function run(ok: boolean, index?: unknown) {
  const seeded = await seedPublished(index);
  const log = stubLogger();
  const hook = createCatalogHook(createCatalogLoader({ db: seeded.db, storage: seeded.storage }));
  await hook({
    build: seeded.build,
    project: seeded.project,
    outcome: ok ? { ok: true } : { ok: false, error: "boom" },
    logger: log.logger,
  });
  return { ...seeded, log };
}

describe("createCatalogHook", () => {
  it("catalogues a build whose publishing succeeded", async () => {
    const { db, build, objects, catalogKey } = await run(true);
    expect(objects.has(catalogKey)).toBe(true);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toHaveLength(2);
  });

  it("writes nothing for a failed publish", async () => {
    const { db, build, objects, catalogKey } = await run(false);
    expect(objects.has(catalogKey)).toBe(false);
    expect(await new BuildComponentModel(db).listByBuild(build.id)).toEqual([]);
  });

  it("warns, without failing, when the build has no readable index", async () => {
    const { objects, catalogKey, log } = await run(true, "<html>");
    expect(objects.has(catalogKey)).toBe(false);
    expect(log.calls.some((call) => call.level === "warn")).toBe(true);
  });
});
