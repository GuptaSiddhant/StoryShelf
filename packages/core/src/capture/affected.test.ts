import { describe, expect, it } from "vitest";
import { baselines } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import type { StoryEntry } from "./adapter.ts";
import { partitionAffectedStories } from "./affected.ts";

const VIEWPORT = { name: "desktop", width: 1280, height: 720 };

function story(id: string, importPath?: string): StoryEntry {
  return { id, title: "Title", name: id, ...(importPath ? { importPath } : {}), type: "story" };
}

async function seedBaseline(
  db: ReturnType<typeof makeDatabase>["db"],
  storyId: string,
): Promise<void> {
  await db.insert(baselines, {
    id: `bl-${storyId}`,
    projectId: "p1",
    storyId,
    viewportName: VIEWPORT.name,
    branch: "main",
    snapshotId: null,
    screenshotPath: `/baselines/${storyId}.png`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function input(
  db: ReturnType<typeof makeDatabase>["db"],
  stories: StoryEntry[],
  affectedPaths: string[] | null,
) {
  return {
    db,
    tables: { baselines },
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
