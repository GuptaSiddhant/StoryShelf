import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { describe, expect, it } from "vitest";
import { createPgliteDatabase } from "./pglite.ts";

describe("BuildModel.failIfOwnedBy on Postgres", () => {
  it("reports its own write as applied although the driver returns a non-ISO timestamp", async () => {
    const db = createPgliteDatabase();
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    const project = await new ProjectModel(db).create({ name: "Owned" });
    const builds = new BuildModel(db);
    const build = await builds.create(project.id, { gitSha: "sha", gitBranch: "main" });
    await builds.setStatus(build.id, "capturing");
    await builds.stampCaptureJob(build.id, "J1");

    const stale = await builds.failIfOwnedBy(build.id, "J-other");
    const own = await builds.failIfOwnedBy(build.id, "J1");

    expect(stale.applied).toBe(false);
    expect(own.applied).toBe(true);
    expect(own.build?.status).toBe("failed");
    // The column comes back in Postgres' own form, which is what a string compare got wrong.
    expect(own.build?.updatedAt).not.toContain("T");
    await db.lifecycle?.teardown?.();
  }, 30_000);
});
