import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, ToolError, toToolError } from "./client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createApiClient", () => {
  it("sends the bearer token and query string to /api/v1", async () => {
    const fetchMock = stubFetch(Response.json([{ id: "b1" }]));
    const client = createApiClient({ url: "https://s.example", token: "tok", slug: "web" });
    const result = await client.get("/projects/web/builds", { branch: "main", status: undefined });
    expect(result).toEqual([{ id: "b1" }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://s.example/api/v1/projects/web/builds?branch=main");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
    expect(client.defaultSlug).toBe("web");
  });

  it("posts a json body", async () => {
    const fetchMock = stubFetch(Response.json({ id: "c1" }, { status: 201 }));
    const client = createApiClient({ url: "https://s.example", token: "tok" });
    await client.post("/x", { body: "hi" });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("POST");
  });

  it("maps 403 to an actionable ToolError without leaking the body", async () => {
    stubFetch(new Response("secret internals", { status: 403 }));
    const client = createApiClient({ url: "https://s.example", token: "tok" });
    const call = client.get("/x");
    await expect(call).rejects.toBeInstanceOf(ToolError);
    await expect(call).rejects.toThrow(/forbidden/u);
    await expect(call).rejects.not.toThrow(/secret/u);
  });
});

describe("toToolError", () => {
  it("wraps network errors", () => {
    expect(toToolError(new Error("ECONNREFUSED")).message).toContain("unreachable");
  });
});
