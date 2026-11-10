import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { findingsHash } from "./github-check-mapper.ts";
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
const OLDER = "01JBZ0000000000000000000AA";
const NEWER = "01JBZ0000000000000000000BB";
const buildLink = (id: string) => `https://shelf.example/projects/web/builds/${id}`;
const shown = (id: string) => [{ ...RUN, details_url: buildLink(id) }];
const RUN = { id: 9, external_id: "storyshelf:storyshelf/testing" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postCheckRun", () => {
  it("creates the run queued for the commit when there is none", async () => {
    const calls = github();
    await postCheckRun(repo, input);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/widgets/commits/abc123/check-runs?filter=all&per_page=100&page=1&check_name=storyshelf%2Ftesting",
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
    expect(writes[0]?.url.endsWith("/12")).toBe(true);
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

  it("asks only for the runs of the configured App when it is known", async () => {
    const calls = github();
    await postCheckRun({ ...repo, appId: "123" }, input);
    expect(calls[0]?.url).toContain("&app_id=123");
    vi.unstubAllGlobals();
    const without = github();
    await postCheckRun(repo, input);
    expect(without[0]?.url).not.toContain("app_id");
  });

  it("reads the next page of runs, so a run past the first hundred is still found and updated", async () => {
    const others = Array.from({ length: 100 }, (_, at) => ({
      id: 1000 + at,
      external_id: "someone-else",
    }));
    const calls = stubFetch((url, init) => {
      if (init.method !== undefined && init.method !== "GET") {
        return Response.json({ id: 9 });
      }
      return Response.json({
        check_runs: url.includes("&page=1&") ? others : [{ id: 9, external_id: RUN.external_id }],
      });
    });
    await postCheckRun(repo, { ...input, state: "success", description: "Passed" });
    const lists = calls.filter((call) => call.url.includes("/check-runs?"));
    expect(lists.map((call) => /[?&]page=(?<page>\d+)/u.exec(call.url)?.groups?.["page"])).toEqual([
      "1",
      "2",
    ]);
    const writes = calls.filter((call) => call.init.method === "PATCH");
    expect(writes.map((call) => call.url.split("/").at(-1))).toEqual(["9"]);
    expect(calls.some((call) => call.init.method === "POST")).toBe(false);
  });

  it("stops after ten pages of full runs", async () => {
    const full = Array.from({ length: 100 }, (_, at) => ({ id: at, external_id: "someone-else" }));
    const calls = stubFetch((_url, init) =>
      init.method === undefined || init.method === "GET"
        ? Response.json({ check_runs: full })
        : Response.json({ id: 77 }),
    );
    await postCheckRun(repo, input);
    // Ten pages, then the create (the re-list after it reads ten pages again).
    expect(calls.slice(0, 10).every((call) => call.url.includes("/check-runs?"))).toBe(true);
    expect(calls[10]?.init.method).toBe("POST");
  });

  it("finds only runs of this name and id, and orders them newest first", async () => {
    const calls = github([
      { id: 30, external_id: "storyshelf:storyshelf/testing" },
      { id: 4, external_id: "someone-else" },
      { id: 20, external_id: "storyshelf:storyshelf/testing" },
    ]);
    await postCheckRun(repo, input);
    expect(calls.slice(1).map((call) => call.url.split("/").at(-1))).toEqual(["30", "20"]);
  });

  it("puts the hash on the last write of a long post only, so a cut-short post leaves none", async () => {
    const calls = github();
    await postCheckRun(repo, { ...input, annotations: annotations(120) });
    const writes = calls.slice(1, 4);
    const hashed = writes.map((call) => summaryOfCall(call).includes("storyshelf:findings="));
    expect(hashed).toEqual([false, false, true]);
  });

  it("puts the hash on the only write of a short post", async () => {
    const calls = github();
    await postCheckRun(repo, { ...input, annotations: annotations(3) });
    expect(summaryOfCall(calls[1])).toContain(
      `storyshelf:findings=${findingsHash(annotations(3))}`,
    );
  });

  it("mirrors the state to a duplicate without claiming the finding set", async () => {
    const calls = github([
      { id: 12, external_id: "storyshelf:storyshelf/testing" },
      { id: 9, external_id: "storyshelf:storyshelf/testing" },
    ]);
    await postCheckRun(repo, { ...input, annotations: annotations(2) });
    const own = calls.find((call) => call.url.endsWith("/12"));
    const mirror = calls.find((call) => call.url.endsWith("/9"));
    expect(own?.url.endsWith("/12")).toBe(true);
    expect(summaryOfCall(own)).toContain("storyshelf:findings=");
    expect(mirror?.url.endsWith("/9")).toBe(true);
    expect(summaryOfCall(mirror)).not.toContain("storyshelf:findings=");
    expect(summaryOfCall(mirror)).toContain("Current findings (2):");
  });

  it("updates a run without findings and leaves its annotations alone", async () => {
    const calls = github([{ ...RUN, output: { annotations_count: 4 } }]);
    await postCheckRun(repo, { ...input, state: "success", description: "Passed" });
    expect(calls.map((call) => call.init.method ?? "GET")).toEqual(["GET", "PATCH"]);
    expect(summaryOfCall(calls[1])).not.toContain("earlier annotation");
    expect(posted(calls[1])).toBeUndefined();
  });

  it("posts only the findings a run lacks, in one update", async () => {
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

  it("rethrows a refused write so the job is retried", async () => {
    stubFetch((_url, init) =>
      init.method === "POST"
        ? Response.json({ message: "Resource not accessible" }, { status: 403 })
        : Response.json({ check_runs: [] }),
    );
    await expect(postCheckRun(repo, input)).rejects.toThrow();
  });

  describe("a delivery for another build", () => {
    it("leaves a run that shows a newer build untouched, and writes nothing", async () => {
      const calls = github(shown(NEWER));
      await postCheckRun(repo, { ...input, url: buildLink(OLDER), state: "failure" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.init.method === undefined || calls[0]?.init.method === "GET").toBe(true);
    });

    it("updates a run that shows an older or the same build", async () => {
      const older = github(shown(OLDER));
      await postCheckRun(repo, { ...input, url: buildLink(NEWER), state: "success" });
      expect(older.at(-1)?.init.method).toBe("PATCH");
      vi.unstubAllGlobals();
      const same = github(shown(NEWER));
      await postCheckRun(repo, { ...input, url: buildLink(NEWER), state: "success" });
      expect(same.at(-1)?.init.method).toBe("PATCH");
    });

    it("updates as before when a link names no readable build", async () => {
      const calls = github([{ ...RUN, details_url: buildLink(NEWER) }]);
      await postCheckRun(repo, { ...input, url: "https://shelf.example/projects/web/builds/B1" });
      expect(calls.at(-1)?.init.method).toBe("PATCH");
    });

    it("skips when any duplicate shows a newer build", async () => {
      const calls = github([
        { ...RUN, id: 8, details_url: buildLink(OLDER) },
        { ...RUN, id: 9, details_url: buildLink(NEWER) },
      ]);
      await postCheckRun(repo, { ...input, url: buildLink(OLDER) });
      expect(calls).toHaveLength(1);
    });
  });
});
