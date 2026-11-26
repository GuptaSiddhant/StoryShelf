import { describe, expect, it } from "vitest";
import { SnapshotModel } from "../models/snapshot.ts";
import { catalogPath } from "../utils/paths.ts";
import { EARLIER_BUILDS_SHOWN } from "./comment-history.ts";
import { deliverBuildState } from "./deliver.ts";
import { world } from "./test-world.ts";

type World = Awaited<ReturnType<typeof world>>;

const entry = (id: string, title: string, name: string, type = "story"): object => ({
  id,
  title,
  name,
  type,
  importPath: "x.stories.tsx",
  tags: [],
});

async function writeCatalog(w: World, buildId: string, entries: object[]): Promise<void> {
  const bytes = Buffer.from(JSON.stringify({ v: 1, entries }));
  await w.storage.write(catalogPath(w.project.id, buildId), bytes);
}

/** The comment text the channel last received for `buildId` (the world's build by default). */
async function commentOf(w: World, buildId = w.build.id): Promise<string> {
  await deliverBuildState(w.deps, { buildId, channelId: w.channelId });
  const comments = w.git.calls.flatMap((call) =>
    call.target.kind === "comment" ? [call.target.markdown] : [],
  );
  return comments.at(-1) ?? "";
}

let clock = 0;

/** A build on `branch` created one minute after the last one made here, so order is explicit. */
async function buildAt(w: World, sha: string, branch: string): Promise<string> {
  const created = await w.builds.create(w.project.id, { gitSha: sha, gitBranch: branch });
  clock += 1;
  const createdAt = new Date(Date.UTC(2026, 10, 1, 0, clock)).toISOString();
  await w.db.update(w.db.tables.builds, created.id, { createdAt });
  return created.id;
}

async function review(w: World, id: string): Promise<void> {
  await w.builds.setStatus(id, "capturing");
  await w.builds.setStatus(id, "reviewing");
}

/** An approved build on `branch`, created before the builds made after it. */
async function approvedBefore(w: World, sha: string, branch = "feature/x"): Promise<string> {
  const id = await buildAt(w, sha, branch);
  await w.builds.setStatus(id, "approved");
  return id;
}

/** What the capture froze on one of `buildId`'s snapshots: the baseline image came from `sourceBuildId`. */
async function recordBaseline(w: World, buildId: string, sourceBuildId: string): Promise<void> {
  await new SnapshotModel(w.db).create(w.project.id, buildId, {
    storyId: "k--keep",
    storyName: "Kept",
    storyTitle: "Keep",
    viewportName: "desktop",
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: `${w.project.id}/builds/${buildId}/k.png`,
    comparisonMetadata: JSON.stringify({ version: 1, baselineId: "b", sourceBuildId }),
  });
}

describe("removed stories", () => {
  it("lists the stories the baseline had and this build lacks, escaped", async () => {
    const w = await world();
    const baseline = await approvedBefore(w, "base111");
    const current = await w.builds.create(w.project.id, {
      gitSha: "new222",
      gitBranch: "feature/x",
    });
    await writeCatalog(w, baseline, [
      entry("a--one", "@acme/Old", "One"),
      entry("a--docs", "Old", "Docs", "docs"),
      entry("k--keep", "Keep", "Kept"),
    ]);
    await writeCatalog(w, current.id, [entry("k--keep", "Keep", "Kept")]);
    await recordBaseline(w, current.id, baseline);
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const body = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    )[0];
    expect(body).toContain("**1 removed story**");
    expect(body).toContain("@‍");
    expect(body).not.toContain("@acme");
    expect(body).not.toContain("Old / Docs");
  });

  it("falls back to the default branch's baseline", async () => {
    const w = await world();
    const main = await approvedBefore(w, "main111", w.project.gitDefaultBranch);
    const current = await w.builds.create(w.project.id, {
      gitSha: "new222",
      gitBranch: "feature/y",
    });
    await writeCatalog(w, main, [entry("g--gone", "Gone", "Story")]);
    await writeCatalog(w, current.id, []);
    await recordBaseline(w, current.id, main);
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const calls = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    );
    expect(calls[0]).toContain("Gone / Story");
  });

  it("counts every removed story, not only the ones it lists", async () => {
    const w = await world();
    const baseline = await approvedBefore(w, "base111");
    const current = { id: await buildAt(w, "new222", "feature/x") };
    const gone = Array.from({ length: 150 }, (_, index) =>
      entry(`g--s${String(index)}`, "Gone", `Story ${String(index)}`),
    );
    await writeCatalog(w, baseline, gone);
    await writeCatalog(w, current.id, []);
    await recordBaseline(w, current.id, baseline);
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const body = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    )[0];
    expect(body).toContain("**150 removed stories**");
    expect(body).toContain("…and 140 more");
  });

  it("leaves the list out, and still delivers, when a catalog holds a malformed entry", async () => {
    const w = await world();
    const baseline = await approvedBefore(w, "base111");
    const current = { id: await buildAt(w, "new222", "feature/x") };
    await writeCatalog(w, baseline, [entry("a--one", "Old", "One")]);
    await writeCatalog(w, current.id, [null as unknown as object, "text" as unknown as object]);
    await recordBaseline(w, current.id, baseline);
    await review(w, current.id);
    await expect(
      deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId }),
    ).resolves.toBe("delivered");
    const body = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    )[0];
    expect(body).toBeDefined();
    expect(body).not.toContain("removed");
  });

  it("names nothing while an index cannot be read", async () => {
    const w = await world();
    const baseline = await approvedBefore(w, "base111");
    const current = await w.builds.create(w.project.id, {
      gitSha: "new222",
      gitBranch: "feature/x",
    });
    await writeCatalog(w, baseline, [entry("a--one", "Old", "One")]);
    await recordBaseline(w, current.id, baseline);
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const body = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    )[0];
    expect(body).not.toContain("removed");
  });

  it("keeps the recorded baseline when an older build is approved between deliveries", async () => {
    const w = await world();
    const recorded = await approvedBefore(w, "base111");
    const older = await buildAt(w, "old0001", "feature/x");
    const current = await buildAt(w, "new222", "feature/x");
    await writeCatalog(w, recorded, [
      entry("a--one", "Old", "One"),
      entry("k--keep", "Keep", "Kept"),
    ]);
    await writeCatalog(w, older, [entry("k--keep", "Keep", "Kept")]);
    await writeCatalog(w, current, [entry("k--keep", "Keep", "Kept")]);
    await recordBaseline(w, current, recorded);
    await review(w, current);
    const first = await commentOf(w, current);
    await w.builds.setStatus(older, "approved");
    const second = await commentOf(w, current);
    expect(first).toContain("**1 removed story**");
    expect(first).toContain("Old / One");
    // The earlier-builds list changes with the approval; the removed-stories part must not.
    expect(second).toContain("**1 removed story**");
    expect(second).toContain("Old / One");
    expect(second).not.toContain("Keep / Kept");
  });

  it("names nothing when the capture recorded no baseline", async () => {
    const w = await world();
    const approved = await approvedBefore(w, "base111");
    const current = await buildAt(w, "new222", "feature/x");
    await writeCatalog(w, approved, [entry("a--one", "Old", "One")]);
    await writeCatalog(w, current, []);
    await review(w, current);
    expect(await commentOf(w, current)).not.toContain("removed");
  });
});

describe("earlier builds", () => {
  it("lists the branch's earlier builds newest first, capped, linked from the builder", async () => {
    const w = await world();
    const ids: string[] = [];
    const shas = Array.from(
      { length: EARLIER_BUILDS_SHOWN + 2 },
      (_, i) => `sha${String(i).padStart(4, "0")}`,
    );
    for (const sha of shas) {
      // eslint-disable-next-line no-await-in-loop -- each build is created after the one before it
      ids.push(await approvedBefore(w, sha));
    }
    await approvedBefore(w, "other00", "other-branch");
    const current = await w.builds.create(w.project.id, {
      gitSha: "cur0000",
      gitBranch: "feature/x",
    });
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const body =
      w.git.calls.flatMap((c) => (c.target.kind === "comment" ? [c.target.markdown] : []))[0] ?? "";
    const links = body.match(/\(https:\/\/shelf\.example\.com\/projects\/web\/builds\/\w+/gu) ?? [];
    expect(body).toContain(`${String(EARLIER_BUILDS_SHOWN)} earlier builds`);
    expect(body).toContain("✅ approved · [`sha0011`]");
    expect(body.indexOf("sha0011")).toBeLessThan(body.indexOf("sha0010"));
    expect(body).not.toContain("sha0001");
    expect(body).not.toContain("other00");
    expect(links.length).toBeGreaterThanOrEqual(EARLIER_BUILDS_SHOWN);
  });

  it("finds earlier builds behind more than 50 newer builds of the branch", async () => {
    const w = await world();
    await approvedBefore(w, "old0001");
    await approvedBefore(w, "old0002");
    const current = { id: await buildAt(w, "cur0000", "feature/x") };
    for (let index = 0; index < 55; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- each build is created after the one before it
      await buildAt(w, `new${String(index).padStart(4, "0")}`, "feature/x");
    }
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const body = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    )[0];
    expect(body).toContain("2 earlier builds");
    expect(body).toContain("`old0002`");
    expect(body).toContain("`old0001`");
    expect(body).not.toContain("`new0000`");
  });

  it("shows none for a branch's first build", async () => {
    const w = await world();
    expect(await commentOf(w)).not.toContain("earlier build");
  });
});
