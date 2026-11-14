/**
 * Skipped builds (ADR 0044) on SQLite: an old database gains `builds.skipped_from_build_id` and its
 * index when the adapter opens it, and a skipped build round-trips through `BuildModel`.
 */
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel } from "@storyshelf/core/models";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const FIXTURES = new URL("test-fixtures/", import.meta.url);

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-skipped-upgrade-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function oldDatabase(fixture: string): string {
  const path = join(dir, "old.db");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(readFileSync(new URL(fixture, FIXTURES), "utf8"));
  sqlite.close();
  return path;
}

describe.each(["pre-review.sql", "pre-449.sql"])("skipped builds on the %s database", (fixture) => {
  it("adds the nullable source column and its index, and round-trips a skipped build", async () => {
    const path = oldDatabase(fixture);
    const db = createSqliteDatabase(path);
    await db.lifecycle?.setup({ config: {}, logger: silent });
    const builds = new BuildModel(db);
    const projectId = "p-custom";
    const source = await builds.create(projectId, { gitSha: "aaaaaaa1111", gitBranch: "main" });
    await builds.setStatus(source.id, "approved");
    const skipped = await builds.createSkipped({
      projectId,
      gitSha: "bbbbbbb2222",
      gitBranch: "main",
      sourceBuildId: source.id,
      changedFiles: ["README.md"],
    });
    expect(await builds.get(skipped.id)).toMatchObject({
      status: "skipped",
      skippedFromBuildId: source.id,
    });
    expect((await builds.skippedFrom(source.id)).map((build) => build.id)).toEqual([skipped.id]);
    expect((await builds.get(source.id))?.skippedFromBuildId).toBeNull();
    const keyed = {
      projectId: "p-custom",
      gitSha: "ccccccc3333",
      gitBranch: "main",
      sourceBuildId: source.id,
      changedFiles: [],
      idempotencyKey: "run-1",
    };
    const first = await builds.createSkipped(keyed);
    expect((await builds.findByIdempotencyKey("p-custom", "run-1"))?.id).toBe(first.id);
    expect(await builds.findByIdempotencyKey("other", "run-1")).toBeNull();
    await expect(builds.createSkipped(keyed)).rejects.toThrow();
    const replacement = await builds.create("p-custom", {
      gitSha: "ccccccc3333",
      gitBranch: "main",
    });
    const replaced = await builds.supersedeSkipped(
      "p-custom",
      "main",
      "ccccccc3333",
      replacement.id,
    );
    expect(replaced.map((build) => build.id)).toEqual([first.id]);
    expect((await builds.get(first.id))?.supersededByBuildId).toBe(replacement.id);
    expect(await builds.supersedeSkipped("p-custom", "main", "ccccccc3333", "x")).toEqual([]);
    await db.lifecycle?.teardown();

    const sqlite = new DatabaseSync(path, { readOnly: true });
    const column = (
      sqlite.prepare("PRAGMA table_info(builds)").all() as { name: string; notnull: number }[]
    ).find((entry) => entry.name === "skipped_from_build_id");
    const indexes = (sqlite.prepare("PRAGMA index_list(builds)").all() as { name: string }[]).map(
      (entry) => entry.name,
    );
    sqlite.close();
    expect(column).toMatchObject({ notnull: 0 });
    expect(indexes).toContain("builds_skipped_from_idx");
    expect(indexes).toContain("builds_project_idempotency_idx");
  });
});
