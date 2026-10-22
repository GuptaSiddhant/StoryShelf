import { describe, expect, it } from "vitest";
import type { BuildComponent } from "../schema/build-component.ts";
import { createTestBuild, createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { BuildComponentModel } from "./build-component.ts";
import { changesetOf, computeChangeset, findChangesetBaseline } from "./changeset.ts";

function row(importPath: string, title: string, hash: string, storyCount = 1): BuildComponent {
  return {
    id: `${importPath}-${hash}`,
    projectId: "p",
    buildId: "b",
    importPath,
    title,
    storyCount,
    hash,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeChangeset", () => {
  it("lists added, removed and changed components and counts the rest", () => {
    const baseline = [
      row("a.tsx", "A", "1"),
      row("b.tsx", "B", "1", 2),
      row("c.tsx", "C", "1"),
      row("d.tsx", "D", "1"),
    ];
    const current = [
      row("a.tsx", "A", "1"),
      row("b.tsx", "B", "2", 3),
      row("c.tsx", "C", "1"),
      row("e.tsx", "E", "1"),
    ];
    expect(computeChangeset(current, baseline)).toEqual({
      added: [{ importPath: "e.tsx", title: "E", storyCount: 1 }],
      removed: [{ importPath: "d.tsx", title: "D", storyCount: 1 }],
      changed: [{ importPath: "b.tsx", title: "B", storyCount: 3, previousStoryCount: 2 }],
      unchanged: 2,
    });
  });

  it("counts every component as added without a baseline", () => {
    const result = computeChangeset([row("b.tsx", "B", "1"), row("a.tsx", "A", "1")], null);
    expect(result.added.map((item) => item.title)).toEqual(["A", "B"]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toBe(0);
  });

  it("is empty for identical catalogs and matches file-less components by title", () => {
    const same = [row("", "Loose", "1"), row("a.tsx", "A", "1")];
    expect(computeChangeset(same, same)).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: 2,
    });
    const moved = computeChangeset([row("", "Loose", "2")], [row("", "Loose", "1")]);
    expect(moved.changed).toHaveLength(1);
  });
});

async function setup() {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables, { gitDefaultBranch: "main" });
  const make = async (
    gitBranch: string,
    createdAt: string,
    status: "approved" | "pending",
  ): Promise<Awaited<ReturnType<typeof createTestBuild>>> => {
    const build = await createTestBuild(db, db.tables, project.id, {
      gitBranch,
      gitSha: `${gitBranch}-${createdAt}`,
    });
    return (await db.update(db.tables.builds, build.id, {
      createdAt,
      status,
    })) as unknown as typeof build;
  };
  return { db, project, make };
}

describe("findChangesetBaseline", () => {
  it("prefers the latest accepted earlier build of the branch", async () => {
    const { db, project, make } = await setup();
    await make("main", "2026-01-01T00:00:00.000Z", "approved");
    const older = await make("feat", "2026-01-02T00:00:00.000Z", "approved");
    const newer = await make("feat", "2026-01-03T00:00:00.000Z", "approved");
    await make("feat", "2026-01-04T00:00:00.000Z", "pending");
    const current = await make("feat", "2026-01-05T00:00:00.000Z", "pending");
    expect((await findChangesetBaseline(db, project, current))?.id).toBe(newer.id);
    expect((await findChangesetBaseline(db, project, newer))?.id).toBe(older.id);
  });

  it("falls back to the default branch, and is null for the very first build", async () => {
    const { db, project, make } = await setup();
    const first = await make("main", "2026-01-01T00:00:00.000Z", "pending");
    expect(await findChangesetBaseline(db, project, first)).toBeNull();
    const main = await make("main", "2026-01-02T00:00:00.000Z", "approved");
    const feature = await make("feat", "2026-01-03T00:00:00.000Z", "pending");
    expect((await findChangesetBaseline(db, project, feature))?.id).toBe(main.id);
  });

  it("ignores accepted builds that are newer than the build", async () => {
    const { db, project, make } = await setup();
    const early = await make("feat", "2026-01-01T00:00:00.000Z", "pending");
    await make("feat", "2026-01-02T00:00:00.000Z", "approved");
    expect(await findChangesetBaseline(db, project, early)).toBeNull();
  });
});

describe("changesetOf", () => {
  it("reads both builds' components", async () => {
    const { db, project, make } = await setup();
    const base = await make("main", "2026-01-01T00:00:00.000Z", "approved");
    const build = await make("feat", "2026-01-02T00:00:00.000Z", "pending");
    const components = new BuildComponentModel(db);
    await components.replaceForBuild(project.id, base.id, [
      { importPath: "a.tsx", title: "A", storyCount: 1, hash: "1" },
    ]);
    await components.replaceForBuild(project.id, build.id, [
      { importPath: "a.tsx", title: "A", storyCount: 2, hash: "2" },
    ]);
    const result = await changesetOf(db, project, build);
    expect(result.baseline?.id).toBe(base.id);
    expect(result.changeset.changed).toHaveLength(1);
  });

  it("has no baseline for a first build", async () => {
    const { db, project, make } = await setup();
    const build = await make("main", "2026-01-01T00:00:00.000Z", "pending");
    await new BuildComponentModel(db).replaceForBuild(project.id, build.id, [
      { importPath: "a.tsx", title: "A", storyCount: 1, hash: "1" },
    ]);
    const result = await changesetOf(db, project, build);
    expect(result.baseline).toBeNull();
    expect(result.changeset.added).toHaveLength(1);
  });
});
