import { describe, expect, it } from "vitest";
import { BuildModel } from "../models/build.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { hasApprovedBuildForSha } from "./skip-checks.ts";

async function setUp() {
  const { db } = makeDatabase();
  const tables = {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
  };
  const model = new BuildModel(db, tables);
  const approved = await model.create("p1", { gitSha: "aaaaaaa1111", gitBranch: "main" });
  await model.setStatus(approved.id, "approved");
  return { db, tables, model, approved };
}

describe("hasApprovedBuildForSha", () => {
  it("finds another approved build of the same commit", async () => {
    const { db, tables, approved } = await setUp();
    await expect(hasApprovedBuildForSha(db, tables, "p1", "aaaaaaa1111", "other")).resolves.toBe(
      true,
    );
    await expect(
      hasApprovedBuildForSha(db, tables, "p1", "aaaaaaa1111", approved.id),
    ).resolves.toBe(false);
  });

  it("does not count a skipped build of the commit as an approved one (ADR 0044)", async () => {
    const { db, tables, model, approved } = await setUp();
    await model.createSkipped({
      projectId: "p1",
      gitSha: "bbbbbbb2222",
      gitBranch: "main",
      sourceBuildId: approved.id,
      changedFiles: [],
    });
    await expect(hasApprovedBuildForSha(db, tables, "p1", "bbbbbbb2222", "other")).resolves.toBe(
      false,
    );
  });
});
