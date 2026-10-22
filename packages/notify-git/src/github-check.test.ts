import { afterEach, describe, expect, it, vi } from "vitest";
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

/** A recorded GitHub: `runs` is what the list endpoint returns; creates answer id 77. */
function github(runs: unknown[] = []) {
  return stubFetch((url, init) => {
    if (init.method === undefined || init.method === "GET") {
      return Response.json({ check_runs: runs });
    }
    return Response.json({ id: url.endsWith("/check-runs") ? 77 : 9 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postCheckRun", () => {
  it("creates the run queued for the commit when there is none", async () => {
    const calls = github();
    await postCheckRun(repo, input);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/widgets/commits/abc123/check-runs?filter=latest&per_page=100&check_name=storyshelf%2Ftesting",
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
    const writes = calls.slice(1);
    expect(writes.map((call) => call.init.method)).toEqual(["POST", "PATCH", "PATCH"]);
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
    const calls = github([
      {
        id: 9,
        external_id: "storyshelf:storyshelf/testing",
        output: { annotations_count: 50 },
      },
    ]);
    await postCheckRun(repo, { ...input, annotations: annotations(60) });
    expect(calls).toHaveLength(2);
    const output = bodyOf(calls[1])["output"] as { annotations: { title: string }[] };
    expect(output.annotations.map((a) => a.title)).toEqual(
      annotations(60)
        .slice(50)
        .map((a) => a.title),
    );
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
