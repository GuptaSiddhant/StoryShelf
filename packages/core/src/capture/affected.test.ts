import { describe, expect, it } from "vitest";
import { BuildModel } from "../models/build.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import type { StoryEntry } from "./adapter.ts";
import { partitionAffectedStories } from "./affected.ts";

const VIEWPORT = { name: "desktop", width: 1280, height: 720 };
const MOBILE = { name: "mobile", width: 390, height: 844 };

function story(id: string, importPath?: string): StoryEntry {
  return { id, title: "Title", name: id, ...(importPath ? { importPath } : {}), type: "story" };
}

async function seedBaseline(
  db: ReturnType<typeof makeDatabase>["db"],
  storyId: string,
  options: { branch?: string; sourceBuildId?: string | null } = {},
): Promise<void> {
  await db.insert(db.tables.baselines, {
    id: `bl-${storyId}`,
    projectId: "p1",
    storyId,
    viewportName: VIEWPORT.name,
    branch: options.branch ?? "main",
    snapshotId: null,
    ...(options.sourceBuildId === undefined ? {} : { sourceBuildId: options.sourceBuildId }),
    screenshotPath: `/baselines/${storyId}.png`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function input(
  db: ReturnType<typeof makeDatabase>["db"],
  stories: StoryEntry[],
  affectedPaths: string[] | null,
  baselineSha: string | null = null,
) {
  return {
    baselineSha,
    db,
    tables: { baselines: db.tables.baselines },
    projectId: "p1",
    branch: "feature",
    defaultBranch: "main",
    stories,
    viewports: [VIEWPORT],
    affectedPaths,
  };
}

describe("partitionAffectedStories", () => {
  it("renders everything when the affected set is null", async () => {
    const { db } = makeDatabase();
    const stories = [story("a", "src/a.stories.tsx")];
    const partition = await partitionAffectedStories(input(db, stories, null));
    expect(partition.render).toHaveLength(1);
    expect(partition.inherited).toEqual([]);
  });

  it("inherits baselined stories and renders the rest", async () => {
    const { db } = makeDatabase();
    await seedBaseline(db, "a");
    const stories = [story("a", "src/a.stories.tsx"), story("b", "src/b.stories.tsx")];
    const partition = await partitionAffectedStories(input(db, stories, ["src/b.stories.tsx"]));
    expect(partition.render.map((entry) => entry.id)).toEqual(["b"]);
    expect(partition.inherited.map((entry) => entry.story.id)).toEqual(["a"]);
    expect(partition.inherited[0]?.baseline.storyId).toBe("a");
  });

  it("renders affected stories that have no baseline yet", async () => {
    const { db } = makeDatabase();
    const stories = [story("fresh", "src/fresh.stories.tsx")];
    const partition = await partitionAffectedStories(input(db, stories, []));
    expect(partition.render.map((entry) => entry.id)).toEqual(["fresh"]);
    expect(partition.inherited).toEqual([]);
  });

  it("renders stories without an import path", async () => {
    const { db } = makeDatabase();
    const stories = [story("nopath")];
    const partition = await partitionAffectedStories(input(db, stories, []));
    expect(partition.render.map((entry) => entry.id)).toEqual(["nopath"]);
  });
});

/** Builds on `feature` at fixed, increasing times: A (approved, the comparison) then B (reviewing). */
async function seedBranch(db: ReturnType<typeof makeDatabase>["db"]) {
  const builds = new BuildModel(db);
  const made = {} as Record<"a" | "b" | "older", string>;
  for (const [key, sha, status, stamp] of [
    ["older", "sha-old", "approved", "2026-01-01T00:00:00.000Z"],
    ["a", "sha-a", "approved", "2026-01-02T00:00:00.000Z"],
    ["b", "sha-b", "reviewing", "2026-01-03T00:00:00.000Z"],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps the order explicit
    const build = await builds.create("p1", { gitSha: sha, gitBranch: "feature" });
    // oxlint-disable-next-line no-await-in-loop -- as above
    await db.update(db.tables.builds, build.id, { createdAt: stamp });
    // oxlint-disable-next-line no-await-in-loop -- as above
    await builds.update(build.id, { status });
    made[key] = build.id;
  }
  return made;
}

describe("baselines promoted after the comparison build (#764)", () => {
  const stories = [story("a", "src/a.stories.tsx")];

  it("renders a story whose baseline was promoted by a later build (A, B per-snapshot, C revert)", async () => {
    const { db } = makeDatabase();
    const builds = await seedBranch(db);
    await seedBaseline(db, "a", { branch: "feature", sourceBuildId: builds.b });
    const partition = await partitionAffectedStories(input(db, stories, [], "sha-a"));
    expect(partition.render.map((entry) => entry.id)).toEqual(["a"]);
    expect(partition.inherited).toEqual([]);
  });

  it("renders a default-branch fallback baseline promoted after the comparison build", async () => {
    const { db } = makeDatabase();
    const builds = await seedBranch(db);
    await seedBaseline(db, "a", { branch: "main", sourceBuildId: builds.b });
    const partition = await partitionAffectedStories(input(db, stories, [], "sha-a"));
    expect(partition.render.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("renders a story at every viewport when only one viewport's baseline was promoted", async () => {
    const { db } = makeDatabase();
    const builds = await seedBranch(db);
    await seedBaseline(db, "a", { branch: "feature", sourceBuildId: builds.a });
    await db.insert(db.tables.baselines, {
      id: "bl-a-mobile",
      projectId: "p1",
      storyId: "a",
      viewportName: "mobile",
      branch: "feature",
      snapshotId: null,
      sourceBuildId: builds.b,
      screenshotPath: "/baselines/a-mobile.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const both = { ...input(db, stories, [], "sha-a"), viewports: [VIEWPORT, MOBILE] };
    const partition = await partitionAffectedStories(both);
    expect(partition.render.map((entry) => entry.id)).toEqual(["a"]);
    expect(partition.inherited).toEqual([]);
  });

  it("still inherits a baseline from the comparison build or an older one", async () => {
    const { db } = makeDatabase();
    const builds = await seedBranch(db);
    await seedBaseline(db, "a", { branch: "feature", sourceBuildId: builds.a });
    await seedBaseline(db, "o", { branch: "feature", sourceBuildId: builds.older });
    const both = [story("a", "src/a.stories.tsx"), story("o", "src/o.stories.tsx")];
    const partition = await partitionAffectedStories(input(db, both, [], "sha-a"));
    expect(partition.render).toEqual([]);
    expect(new Set(partition.inherited.map((entry) => entry.story.id))).toEqual(
      new Set(["a", "o"]),
    );
  });

  it("inherits a legacy baseline with no recorded source", async () => {
    const { db } = makeDatabase();
    await seedBranch(db);
    await seedBaseline(db, "a", { branch: "feature", sourceBuildId: null });
    const partition = await partitionAffectedStories(input(db, stories, [], "sha-a"));
    expect(partition.inherited.map((entry) => entry.story.id)).toEqual(["a"]);
  });

  it("keeps inheriting when no comparison build is known", async () => {
    const { db } = makeDatabase();
    const builds = await seedBranch(db);
    await seedBaseline(db, "a", { branch: "feature", sourceBuildId: builds.b });
    expect((await partitionAffectedStories(input(db, stories, [], null))).inherited).toHaveLength(
      1,
    );
    expect(
      (await partitionAffectedStories(input(db, stories, [], "sha-unknown"))).inherited,
    ).toHaveLength(1);
  });
});
