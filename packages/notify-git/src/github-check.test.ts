import { afterEach, describe, expect, it, vi } from "vitest";
import { findingsHash, summaryOf } from "./github-check-mapper.ts";
import { postCheckRun } from "./github-check.ts";
import { bodyOf, stubFetch } from "./test-fetch.ts";

const repo = { token: "ghs_inst", owner: "acme", repo: "widgets" };
const input = {
  sha: "abc123",
  context: "storyshelf/testing",
  state: "pending" as const,
  description: "Capturing",
  url: "https://shelf.example/projects/web/builds/B1",
  progress: "queued" as const,
};
const annotations = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    path: "a.tsx",
    title: `t${String(at)}`,
    message: "m",
    url: `https://shelf.example/projects/web/builds/B1/diff?snapshot=${String(at)}`,
    level: "warning" as const,
  }));

/**
 * A recorded GitHub: `runs` is what the list endpoint returns (`afterCreate`, when given, from
 * the second listing on); `listed` is what the annotations endpoint returns; creates answer id 77.
 */
function github(runs: unknown[] = [], extra: { listed?: unknown[]; afterCreate?: unknown[] } = {}) {
  let lists = 0;
  return stubFetch((url, init) => {
    if (init.method === undefined || init.method === "GET") {
      if (url.includes("/annotations")) {
        return Response.json(extra.listed ?? []);
      }
      lists += 1;
      return Response.json({
        check_runs: lists > 1 && extra.afterCreate ? extra.afterCreate : runs,
      });
    }
    return Response.json({ id: url.endsWith("/check-runs") ? 77 : 9 });
  });
}

const posted = (call: { init: RequestInit } | undefined) =>
  ((bodyOf(call as never)["output"] ?? {}) as { annotations?: { title: string }[] }).annotations;
const summaryOfCall = (call: { init: RequestInit } | undefined) =>
  (bodyOf(call as never)["output"] as { summary: string }).summary;
const asListed = (items: ReturnType<typeof annotations>) =>
  items.map((item) => ({
    path: item.path,
    annotation_level: item.level,
    title: item.title,
    message: item.message,
    raw_details: item.url,
  }));
const RUN = { id: 9, external_id: "storyshelf:storyshelf/testing" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postCheckRun", () => {
  it("creates the run queued for the commit when there is none", async () => {
    const calls = github();
    await postCheckRun(repo, input);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/widgets/commits/abc123/check-runs?filter=all&per_page=100&check_name=storyshelf%2Ftesting",
    );
    expect(calls[1]?.url).toBe("https://api.github.com/repos/acme/widgets/check-runs");
    expect(calls[1]?.init.method).toBe("POST");
    expect(calls[1]?.init.headers).toMatchObject({ authorization: "Bearer ghs_inst" });
    expect(bodyOf(calls[1])).toMatchObject({
      name: "storyshelf/testing",
      head_sha: "abc123",
      external_id: "storyshelf:storyshelf/testing",
      status: "queued",
      details_url: input.url,
    });
  });

  it("updates the existing run instead of creating a duplicate", async () => {
    const calls = github([
      { id: 5, external_id: "someone-else" },
      { id: 9, external_id: "storyshelf:storyshelf/testing" },
    ]);
    await postCheckRun(repo, { ...input, state: "success", description: "Passed" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://api.github.com/repos/acme/widgets/check-runs/9");
    expect(calls[1]?.init.method).toBe("PATCH");
    expect(bodyOf(calls[1])).toMatchObject({ status: "completed", conclusion: "success" });
    expect(bodyOf(calls[1])).not.toHaveProperty("head_sha");
  });

  it("walks the lifecycle on one run: queued, in progress, completed", async () => {
    const created = github();
    await postCheckRun(repo, input);
    expect(bodyOf(created[1])["status"]).toBe("queued");
    vi.unstubAllGlobals();
    const run = [{ id: 9, external_id: "storyshelf:storyshelf/testing" }];
    const second = github(run);
    await postCheckRun(repo, { ...input, progress: "running" });
    vi.unstubAllGlobals();
    const third = github(run);
    await postCheckRun(repo, { ...input, state: "cancelled", description: "Cancelled" });
    expect(bodyOf(second[1])["status"]).toBe("in_progress");
    expect(bodyOf(third[1])).toMatchObject({ status: "completed", conclusion: "cancelled" });
  });

  it("posts annotations 50 per request on the same run", async () => {
    const calls = github();
    await postCheckRun(repo, { ...input, annotations: annotations(120), omitted: 5 });
    const writes = calls.slice(1, 4);
    expect(writes.map((call) => call.init.method)).toEqual(["POST", "PATCH", "PATCH"]);
    expect(calls[4]?.init.method ?? "GET").toBe("GET");
    expect(writes[1]?.url).toBe("https://api.github.com/repos/acme/widgets/check-runs/77");
    const sizes = writes.map(
      (call) => (bodyOf(call)["output"] as { annotations: unknown[] }).annotations.length,
    );
    expect(sizes).toEqual([50, 50, 20]);
    const summary = (bodyOf(writes[0])["output"] as { summary: string }).summary;
    expect(summary).toContain("and 5 more changed snapshots");
    expect(summary).toContain(input.url);
    const first = (bodyOf(writes[0])["output"] as { annotations: { raw_details: string }[] })
      .annotations[0];
    expect(first?.raw_details).toBe("https://shelf.example/projects/web/builds/B1/diff?snapshot=0");
  });

  it("does not repeat annotations the run already has", async () => {
    const calls = github([{ ...RUN, output: { annotations_count: 50 } }], {
      listed: asListed(annotations(50)),
    });
    await postCheckRun(repo, { ...input, annotations: annotations(60) });
    expect(calls.map((call) => call.init.method ?? "GET")).toEqual(["GET", "GET", "PATCH"]);
    expect(calls[1]?.url).toBe(
      "https://api.github.com/repos/acme/widgets/check-runs/9/annotations?per_page=100&page=1",
    );
    expect(posted(calls[2])?.map((a) => a.title)).toEqual(
      annotations(60)
        .slice(50)
        .map((a) => a.title),
    );
  });

  it("posts a changed finding even when the count of annotations is the same", async () => {
    const before = annotations(3);
    const after = [
      before[0],
      before[1],
      { ...before[2], message: "now different" },
    ] as typeof before;
    const calls = github([{ ...RUN, output: { annotations_count: 3 } }], {
      listed: asListed(before),
    });
    await postCheckRun(repo, { ...input, annotations: after });
    expect(posted(calls[2])).toHaveLength(1);
    expect(posted(calls[2])?.[0]).toMatchObject({ title: "t2", message: "now different" });
    expect(summaryOfCall(calls[2])).toContain("1 earlier annotation belongs to findings");
  });

  it("leaves the annotations alone when the run carries the hash of the same set", async () => {
    const same = annotations(3);
    const marked = summaryOf({ ...input, annotations: same });
    const calls = github([{ ...RUN, output: { annotations_count: 3, summary: marked } }]);
    await postCheckRun(repo, {
      ...input,
      state: "success",
      description: "Passed",
      annotations: same,
    });
    expect(calls.map((call) => call.init.method ?? "GET")).toEqual(["GET", "PATCH"]);
    expect(posted(calls[1])).toBeUndefined();
    expect(bodyOf(calls[1])).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("counts earlier annotations as history when the same set is shown again", async () => {
    const same = annotations(2);
    const marked = summaryOf({ ...input, annotations: same });
    const calls = github([{ ...RUN, output: { annotations_count: 5, summary: marked } }]);
    await postCheckRun(repo, { ...input, annotations: same });
    expect(summaryOfCall(calls[1])).toContain("3 earlier annotations belong to findings");
  });

  it("finishes a post that was cut short: the hash is there but not every annotation", async () => {
    const same = annotations(60);
    const marked = summaryOf({ ...input, annotations: same });
    const calls = github([{ ...RUN, output: { annotations_count: 50, summary: marked } }], {
      listed: asListed(annotations(50)),
    });
    await postCheckRun(repo, { ...input, annotations: same });
    expect(calls[1]?.url).toContain("/annotations");
    expect(posted(calls[2])).toHaveLength(10);
  });

  it("reads a long run's annotations page by page", async () => {
    const calls = stubFetch((url, init) => {
      if (init.method !== undefined && init.method !== "GET") {
        return Response.json({ id: 9 });
      }
      if (url.includes("/annotations")) {
        return Response.json(
          url.endsWith("page=1")
            ? asListed(annotations(100))
            : asListed(annotations(120).slice(100)),
        );
      }
      return Response.json({ check_runs: [{ ...RUN, output: { annotations_count: 120 } }] });
    });
    await postCheckRun(repo, { ...input, annotations: annotations(120) });
    expect(calls.filter((call) => call.url.includes("/annotations"))).toHaveLength(2);
    expect(calls.at(-1)?.init.method).toBe("PATCH");
    expect(posted(calls.at(-1))).toBeUndefined();
  });

  it("puts the hash of a build with no findings on the run", async () => {
    const calls = github();
    await postCheckRun(repo, { ...input, annotations: [] });
    expect(summaryOfCall(calls[1])).toContain(`<!-- storyshelf:findings=${findingsHash([])} -->`);
  });

  it("updates every run with the id, so a duplicate never keeps an older state", async () => {
    const calls = github([
      { id: 12, external_id: "storyshelf:storyshelf/testing" },
      { id: 9, external_id: "storyshelf:storyshelf/testing" },
    ]);
    await postCheckRun(repo, { ...input, state: "success", description: "Passed" });
    const writes = calls.slice(1);
    expect(writes.map((call) => call.url).toSorted()).toEqual([
      "https://api.github.com/repos/acme/widgets/check-runs/12",
      "https://api.github.com/repos/acme/widgets/check-runs/9",
    ]);
    expect(writes.every((call) => bodyOf(call)["conclusion"] === "success")).toBe(true);
    expect(writes[0]?.url.endsWith("/9")).toBe(true);
  });

  it("lists again after a create and brings a run another delivery created to the same state", async () => {
    const calls = github([], {
      afterCreate: [
        { id: 5, external_id: "storyshelf:storyshelf/testing" },
        { id: 77, external_id: "storyshelf:storyshelf/testing" },
      ],
    });
    await postCheckRun(repo, { ...input, state: "success", description: "Passed" });
    expect(
      calls.map((call) => `${call.init.method ?? "GET"} ${call.url.split("/").at(-1)}`),
    ).toEqual([
      expect.stringMatching(/^GET /u),
      "POST check-runs",
      expect.stringMatching(/^GET /u),
      "PATCH 5",
    ]);
    expect(bodyOf(calls[3])).toMatchObject({ status: "completed", conclusion: "success" });
    expect(bodyOf(calls[3])).not.toHaveProperty("head_sha");
  });

  it("finds only runs of this name and id, and orders them oldest first", async () => {
    const calls = github([
      { id: 30, external_id: "storyshelf:storyshelf/testing" },
      { id: 4, external_id: "someone-else" },
      { id: 20, external_id: "storyshelf:storyshelf/testing" },
    ]);
    await postCheckRun(repo, input);
    expect(calls.slice(1).map((call) => call.url.split("/").at(-1))).toEqual(["20", "30"]);
  });

  it("rethrows a refused write so the job is retried", async () => {
    stubFetch((_url, init) =>
      init.method === "POST"
        ? Response.json({ message: "Resource not accessible" }, { status: 403 })
        : Response.json({ check_runs: [] }),
    );
    await expect(postCheckRun(repo, input)).rejects.toThrow();
  });
});
