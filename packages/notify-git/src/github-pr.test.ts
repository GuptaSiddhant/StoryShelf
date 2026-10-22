import type { NotifierState } from "@storyshelf/core/adapter/notifier";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapState } from "./github-mapper.ts";
import { findPrNumber } from "./github-pr.ts";

function stubFetch(handler: () => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => await handler()),
  );
}

function pullsResponse(pulls: unknown): Response {
  return Response.json(pulls);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapState", () => {
  it("maps the three check states to GitHub states", () => {
    expect(mapState("pending")).toBe("pending");
    expect(mapState("success")).toBe("success");
    expect(mapState("failure")).toBe("failure");
  });

  it("maps unknown states to error", () => {
    expect(mapState("bogus" as NotifierState)).toBe("error");
  });
});

describe("findPrNumber", () => {
  const opts = { token: "ghp_test", owner: "acme", repo: "widgets", sha: "abc" };

  it("returns the first associated PR number", async () => {
    stubFetch(() => pullsResponse([{ number: 42 }, { number: 43 }]));
    await expect(findPrNumber(opts)).resolves.toBe(42);
  });

  it("returns undefined when no PR is associated", async () => {
    stubFetch(() => pullsResponse([]));
    await expect(findPrNumber(opts)).resolves.toBeUndefined();
  });

  it("returns undefined when the API throws", async () => {
    stubFetch(() => new Response("boom", { status: 400 }));
    await expect(findPrNumber(opts)).resolves.toBeUndefined();
  });

  it("ignores non-numeric PR numbers", async () => {
    stubFetch(() => pullsResponse([{ number: "42" }]));
    await expect(findPrNumber(opts)).resolves.toBeUndefined();
  });

  it("queries the commits pulls endpoint with auth", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return pullsResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await findPrNumber({ ...opts, sha: "abc123" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/commits/abc123/pulls");
    expect(init.headers).toMatchObject({ authorization: "Bearer ghp_test" });
  });
});
