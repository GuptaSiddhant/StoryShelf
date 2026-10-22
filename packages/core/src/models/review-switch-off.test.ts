import { describe, expect, it } from "vitest";
import { createTestBuild, createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { BuildModel } from "./build.ts";
import { CaptureAttemptModel } from "./capture-attempt.ts";
import { acceptPendingWithoutWork } from "./review-switch-off.ts";
import { SnapshotModel } from "./snapshot.ts";

async function setup() {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables);
  const other = await createTestProject(db, db.tables, { name: "Other" });
  return { db, project, other };
}

describe("acceptPendingWithoutWork", () => {
  it("accepts pending builds nothing worked on, and only those", async () => {
    const { db, project, other } = await setup();
    const idle = await createTestBuild(db, db.tables, project.id, { gitSha: "a" });
    const attempted = await createTestBuild(db, db.tables, project.id, { gitSha: "b" });
    const captured = await createTestBuild(db, db.tables, project.id, { gitSha: "c" });
    const rejected = await createTestBuild(db, db.tables, project.id, { gitSha: "d" });
    const foreign = await createTestBuild(db, db.tables, other.id, { gitSha: "e" });
    await new CaptureAttemptModel(db).startAttempt(project.id, attempted.id);
    await new SnapshotModel(db).create(project.id, captured.id, {
      storyId: "a--x",
      storyName: "X",
      storyTitle: "A",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 800,
      screenshotPath: "x.png",
    });
    await new BuildModel(db).setStatus(rejected.id, "rejected");

    const accepted = await acceptPendingWithoutWork(db, project.id);

    expect(accepted.map((build) => build.id)).toEqual([idle.id]);
    const builds = new BuildModel(db);
    expect((await builds.get(idle.id))?.status).toBe("approved");
    expect((await builds.get(attempted.id))?.status).toBe("pending");
    expect((await builds.get(captured.id))?.status).toBe("pending");
    expect((await builds.get(rejected.id))?.status).toBe("rejected");
    expect((await builds.get(foreign.id))?.status).toBe("pending");
  });

  it("is idempotent", async () => {
    const { db, project } = await setup();
    await createTestBuild(db, db.tables, project.id);
    expect(await acceptPendingWithoutWork(db, project.id)).toHaveLength(1);
    expect(await acceptPendingWithoutWork(db, project.id)).toEqual([]);
  });
});
