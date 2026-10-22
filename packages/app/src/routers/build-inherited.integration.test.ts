import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

/** A project with builds whose snapshots were partly inherited (affected capture, #140). */
async function setup(testing: boolean) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Inherit" });
  const builds = new BuildModel(db);
  const snapshots = new SnapshotModel(db);
  const mine = async (sha: string, inherited: boolean[]) => {
    const build = await builds.create(project.id, { gitSha: sha, gitBranch: "main" });
    for (const [index, value] of inherited.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- rows are created in order
      await snapshots.create(project.id, build.id, {
        storyId: `s-${sha}-${index}`,
        storyName: `S${index}`,
        storyTitle: "T",
        viewportName: "desktop",
        viewportWidth: 1280,
        viewportHeight: 720,
        screenshotPath: "p.png",
        inherited: value,
      });
    }
    return await builds.updateCounts(build.id);
  };
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
  });
  return { app, mine, project };
}

describe("inherited counts of a build", () => {
  it("stores the count and serves it as inheritedCount", async () => {
    const { app, mine } = await setup(true);
    const build = await mine("aaa1111", [true, true, false, false]);
    expect(build.inheritedCount).toBe(2);
    const response = await app.request("/api/v1/projects/inherit/builds");
    const body = (await response.json()) as { inheritedCount: number; snapshotCount: number }[];
    expect(body[0]).toMatchObject({ inheritedCount: 2, snapshotCount: 4 });
  });

  it("shows the stored count on the build page and the average ratio on the builds page", async () => {
    const { app, mine, project } = await setup(true);
    const first = await mine("aaa1111", [true, true, false, false]);
    await mine("bbb2222", [true, true, true, false]);
    const page = await (await app.request(`/projects/inherit/builds/${first.id}`)).text();
    expect(page).toContain("Inherited");
    const list = await (await app.request(`/projects/${project.slug}/builds`)).text();
    expect(list).toContain("Inherited from baseline");
    expect(list).toContain("63%");
    expect(list).toContain("Average over the last 2 builds");
  });

  it("leaves the ratio out when the instance only hosts Storybooks", async () => {
    const { app, mine } = await setup(false);
    await mine("aaa1111", [true, false]);
    const list = await (await app.request("/projects/inherit/builds")).text();
    expect(list).not.toContain("Inherited from baseline");
  });
});
