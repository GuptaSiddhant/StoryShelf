import { afterEach, describe, expect, it, vi } from "vitest";
import { planAnnotations } from "./github-check-annotations.ts";
import { findingsHash, summaryOf } from "./github-check-mapper.ts";
import { stubFetch } from "./test-fetch.ts";

const repo = { token: "ghs_inst", owner: "acme", repo: "widgets" };
const finding = (index: number, message = "m") => ({
  path: "a.tsx",
  title: `t${String(index)}`,
  message,
  url: `https://shelf.example/projects/web/builds/B1/diff?snapshot=${String(index)}`,
  level: "warning" as const,
});
const findings = (count: number) => Array.from({ length: count }, (_, at) => finding(at));
const listedOf = (items: ReturnType<typeof findings>) =>
  items.map((item) => ({
    path: item.path,
    annotation_level: item.level,
    title: item.title,
    message: item.message,
    raw_details: item.url,
  }));
const base = { context: "storyshelf/testing", state: "pending" as const, description: "Capturing" };
const markedFor = (set: ReturnType<typeof findings>) => summaryOf({ ...base, annotations: set });
const run = (count: number, summary?: string) => ({
  id: 9,
  external_id: "storyshelf:storyshelf/testing",
  output: { annotations_count: count, ...(summary === undefined ? {} : { summary }) },
});

/** A GitHub whose annotation list answers `pages` (one array per page). */
function listing(...pages: unknown[][]) {
  return stubFetch((url) =>
    Response.json(pages[Number(/[?&]page=(?<page>\d+)/u.exec(url)?.groups?.["page"]) - 1] ?? []),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planAnnotations", () => {
  it("posts every finding to a run that is not there or shows nothing, without listing", async () => {
    const calls = listing();
    expect(await planAnnotations(repo, undefined, findings(3))).toEqual({
      post: findings(3),
      resolved: 0,
    });
    expect(await planAnnotations(repo, run(0), findings(3))).toEqual({
      post: findings(3),
      resolved: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("posts nothing and counts nothing as history for a status that carries no findings", async () => {
    const calls = listing(listedOf(findings(4)));
    expect(await planAnnotations(repo, run(4, "no hash"))).toEqual({
      post: [],
      resolved: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("leaves a run alone that carries the hash of the same set and shows at least that many", async () => {
    const set = findings(3);
    const calls = listing();
    expect(await planAnnotations(repo, run(3, markedFor(set)), set)).toEqual({
      post: [],
      resolved: 0,
    });
    expect(await planAnnotations(repo, run(5, markedFor(set)), set)).toEqual({
      post: [],
      resolved: 2,
    });
    expect(calls).toHaveLength(0);
  });

  it("compares the annotations when the hash is there but the run shows fewer than the findings", async () => {
    const set = findings(60);
    const calls = listing(listedOf(findings(50)));
    const plan = await planAnnotations(repo, run(50, markedFor(set)), set);
    expect(calls).toHaveLength(1);
    expect(plan.post).toEqual(findings(60).slice(50));
    expect(plan.resolved).toBe(0);
  });

  it("posts a changed finding whose count is unchanged, and counts the old one as history", async () => {
    const before = findings(3);
    const after = [before[0], before[1], finding(2, "now different")] as typeof before;
    listing(listedOf(before));
    const plan = await planAnnotations(repo, run(3, "old summary"), after);
    expect(plan.post).toEqual([finding(2, "now different")]);
    expect(plan.resolved).toBe(1);
  });

  it("does not repeat what the run already has, and posts only what is missing", async () => {
    listing(listedOf(findings(50)));
    const plan = await planAnnotations(repo, run(50), findings(60));
    expect(plan.post.map((item) => item.title)).toEqual(
      findings(60)
        .slice(50)
        .map((item) => item.title),
    );
    expect(plan.resolved).toBe(0);
  });

  it("reads a long run's annotations page by page, stopping at a short page", async () => {
    const all = findings(120);
    const calls = listing(listedOf(all.slice(0, 100)), listedOf(all.slice(100)));
    const plan = await planAnnotations(repo, run(120), all);
    expect(calls.map((call) => call.url.split("?")[1])).toEqual([
      "per_page=100&page=1",
      "per_page=100&page=2",
    ]);
    expect(plan).toEqual({ post: [], resolved: 0 });
  });

  it("stops after ten pages even when each is full", async () => {
    const page = listedOf(findings(100));
    const calls = listing(...Array.from({ length: 12 }, () => page));
    await planAnnotations(repo, run(1200), findings(1));
    expect(calls).toHaveLength(10);
  });

  it("has a hash that tells one set from another, as the run's summary carries it", () => {
    expect(findingsHash(findings(2))).not.toBe(findingsHash(findings(3)));
  });
});
