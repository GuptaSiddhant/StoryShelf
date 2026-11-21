import { describe, expect, it } from "vitest";
import { catalogPath } from "../../utils/paths.ts";
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

/** The comment text the channel last received. */
async function commentOf(w: World): Promise<string> {
  await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId });
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
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const calls = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    );
    expect(calls[0]).toContain("Gone / Story");
  });

  it("names nothing while an index cannot be read", async () => {
    const w = await world();
    const baseline = await approvedBefore(w, "base111");
    const current = await w.builds.create(w.project.id, {
      gitSha: "new222",
      gitBranch: "feature/x",
    });
    await writeCatalog(w, baseline, [entry("a--one", "Old", "One")]);
    await review(w, current.id);
    await deliverBuildState(w.deps, { buildId: current.id, channelId: w.channelId });
    const body = w.git.calls.flatMap((c) =>
      c.target.kind === "comment" ? [c.target.markdown] : [],
    )[0];
    expect(body).not.toContain("removed");
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

  it("shows none for a branch's first build", async () => {
    const w = await world();
    expect(await commentOf(w)).not.toContain("earlier build");
  });
});
