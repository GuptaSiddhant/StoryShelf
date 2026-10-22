import { afterEach, describe, expect, it, vi } from "vitest";
import { gitHubNotifier } from "./github.ts";
import { bodyOf, stubFetch } from "./test-fetch.ts";

const channel = {
  id: "c1",
  projectId: "p1",
  provider: "github",
  config: {},
  events: [],
  enabled: true,
};

const REPO = { owner: "acme", repo: "widgets" };

function adapter(config: unknown) {
  return gitHubNotifier.create({ config, secret: "ghp_test" });
}

const set = async (state: "pending" | "success"): Promise<void> => {
  await adapter(REPO).setState({
    channel,
    target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
    state,
    url: "u",
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gitHubNotifier", () => {
  it("declares state delivery for kind github", () => {
    expect(gitHubNotifier.metadata).toMatchObject({
      kind: "github",
      name: "GitHub",
      category: "notifier",
      delivery: "state",
    });
  });

  it("posts the commit status under the exact context the caller chose", async () => {
    const calls = stubFetch(() => Response.json({}));
    await adapter(REPO).setState({
      channel,
      target: { kind: "status", sha: "abc123", context: "storyshelf-web/testing" },
      state: "failure",
      url: "https://shelf.example/projects/web/builds/1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/widgets/statuses/abc123");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer ghp_test" });
    expect(bodyOf(calls[0])).toEqual({
      state: "failure",
      target_url: "https://shelf.example/projects/web/builds/1",
      description: "Visual changes detected or tests failed",
      context: "storyshelf-web/testing",
    });
  });

  it("maps pending and success states", async () => {
    const calls = stubFetch(() => Response.json({}));
    await set("pending");
    await set("success");
    const states = calls.map((call) => bodyOf(call)["state"]);
    expect(states).toEqual(["pending", "success"]);
  });

  it("rethrows a rejected status so the host can record the failure", async () => {
    stubFetch(() => new Response("Bad credentials", { status: 401 }));
    await expect(
      adapter(REPO).setState({
        channel,
        target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
        state: "success",
        url: "u",
      }),
    ).rejects.toThrow("401");
  });

  it("creates the pull-request comment with the url marker when none exists", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/pulls")) {
        return Response.json([{ number: 7 }]);
      }
      if (url.includes("/comments?")) {
        return Response.json([]);
      }
      return Response.json({ id: 99 });
    });
    await adapter(REPO).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "Visual tests passed" },
      state: "success",
      url: "https://shelf.example/b/1",
    });
    const create = calls.at(-1);
    expect(create?.url).toBe("https://api.github.com/repos/acme/widgets/issues/7/comments");
    expect(create?.init.method).toBe("POST");
    expect(bodyOf(create)["body"]).toBe(
      "<!-- storyshelf:https://shelf.example/b/1 -->\nVisual tests passed",
    );
  });

  it("updates the existing comment instead of adding a second one", async () => {
    const calls = stubFetch((url, init) => {
      if (url.endsWith("/pulls")) {
        return Response.json([{ number: 7 }]);
      }
      if (url.includes("/issues/7/comments?")) {
        return Response.json([
          { id: 55, body: "<!-- storyshelf:https://shelf.example/b/1 -->\nold" },
        ]);
      }
      return Response.json({ id: 55, method: init.method });
    });
    await adapter(REPO).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "new" },
      state: "failure",
      url: "https://shelf.example/b/1",
    });
    const update = calls.at(-1);
    expect(update?.url).toBe("https://api.github.com/repos/acme/widgets/issues/comments/55");
    expect(update?.init.method).toBe("PATCH");
  });

  it("skips the comment when the commit has no pull request", async () => {
    const calls = stubFetch(() => Response.json([]));
    await adapter(REPO).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "m" },
      state: "success",
      url: "u",
    });
    expect(calls).toHaveLength(1);
  });

  it("rejects a missing token and an invalid config at create", () => {
    expect(() => gitHubNotifier.create({ config: { owner: "acme", repo: "widgets" } })).toThrow(
      "GitHub channel needs a token",
    );
    expect(() => gitHubNotifier.create({ config: { owner: "acme" }, secret: "t" })).toThrow();
    expect(() =>
      gitHubNotifier.create({
        config: { owner: "a", repo: "b", prefix: "bad prefix" },
        secret: "t",
      }),
    ).toThrow();
  });
});
