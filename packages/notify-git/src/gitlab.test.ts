import { afterEach, describe, expect, it, vi } from "vitest";
import { gitLabNotifier } from "./gitlab.ts";
import { bodyOf, stubFetch } from "./test-fetch.ts";

const channel = {
  id: "c1",
  projectId: "p1",
  provider: "gitlab",
  config: {},
  events: [],
  enabled: true,
};

const REPO = { owner: "acme", repo: "widgets" };

function adapter(config: unknown) {
  return gitLabNotifier.create({ config, secret: "glpat-test" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gitLabNotifier", () => {
  it("declares state delivery for kind gitlab", () => {
    expect(gitLabNotifier.metadata).toMatchObject({
      kind: "gitlab",
      name: "GitLab",
      category: "notifier",
      delivery: "state",
    });
  });

  it("posts the commit status with the exact context as name and context", async () => {
    const calls = stubFetch(() => Response.json({}));
    await adapter(REPO).setState({
      channel,
      target: { kind: "status", sha: "abc123", context: "storyshelf/testing" },
      state: "failure",
      url: "https://shelf.example/b/1",
    });
    expect(calls[0]?.url).toBe("https://gitlab.com/api/v4/projects/acme%2Fwidgets/statuses/abc123");
    expect(calls[0]?.init.headers).toMatchObject({ "PRIVATE-TOKEN": "glpat-test" });
    expect(bodyOf(calls[0])).toEqual({
      state: "failed",
      target_url: "https://shelf.example/b/1",
      description: "Visual changes detected or tests failed",
      name: "storyshelf/testing",
      context: "storyshelf/testing",
    });
  });

  it("targets a self-hosted GitLab host", async () => {
    const calls = stubFetch(() => Response.json({}));
    await adapter({ owner: "acme", repo: "widgets", host: "https://git.example.com/" }).setState({
      channel,
      target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
      state: "pending",
      url: "u",
    });
    expect(calls[0]?.url.startsWith("https://git.example.com/api/v4/projects/")).toBe(true);
  });

  it("rethrows a rejected status so the host can record the failure", async () => {
    stubFetch(() => new Response("401 Unauthorized", { status: 401 }));
    await expect(
      adapter(REPO).setState({
        channel,
        target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
        state: "success",
        url: "u",
      }),
    ).rejects.toThrow("401");
  });

  it("creates the merge-request note with the url marker when none exists", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/merge_requests")) {
        return Response.json([{ iid: 3 }]);
      }
      if (url.includes("/notes?")) {
        return Response.json([]);
      }
      return Response.json({ id: 77 });
    });
    await adapter(REPO).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "Visual tests passed" },
      state: "success",
      url: "https://shelf.example/b/1",
    });
    const create = calls.at(-1);
    expect(create?.url).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fwidgets/merge_requests/3/notes",
    );
    expect(create?.init.method).toBe("POST");
    expect(bodyOf(create)["body"]).toBe(
      "<!-- storyshelf:https://shelf.example/b/1 -->\nVisual tests passed",
    );
  });

  it("updates the existing note instead of adding a second one", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/merge_requests")) {
        return Response.json([{ iid: 3 }]);
      }
      if (url.includes("/notes?")) {
        return Response.json([
          { id: 5, body: "<!-- storyshelf:https://shelf.example/b/1 -->\nold" },
        ]);
      }
      return Response.json({ id: 5 });
    });
    await adapter(REPO).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "new" },
      state: "failure",
      url: "https://shelf.example/b/1",
    });
    expect(calls.at(-1)?.init.method).toBe("PUT");
  });

  it("rejects a missing token and an invalid host at create", () => {
    expect(() => gitLabNotifier.create({ config: { owner: "a", repo: "b" } })).toThrow(
      "GitLab channel needs a token",
    );
    expect(() =>
      gitLabNotifier.create({ config: { owner: "a", repo: "b", host: "nope" }, secret: "t" }),
    ).toThrow();
  });
});
