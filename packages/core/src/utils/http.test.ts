import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, httpJson } from "./http.ts";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpJson", () => {
  it("returns parsed JSON on success", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const data = await httpJson<{ ok: boolean }>("https://example.com/api");
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends method, headers, and JSON body", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    await httpJson("https://example.com/api", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      json: { name: "demo" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://example.com/api");
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers).toMatchObject({
      authorization: "Bearer token",
      "content-type": "application/json",
    });
    expect(calledInit.body).toBe(JSON.stringify({ name: "demo" }));
  });

  it("throws HttpError with status and body without retrying 4xx", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({ message: "nope" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const caught = await httpJson("https://example.com/api").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
    expect((caught as HttpError).body).toContain("nope");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("truncates long error bodies", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({ detail: "x".repeat(600) }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);
    const caught2 = await httpJson("https://example.com/api").catch((error: unknown) => error);
    expect((caught2 as HttpError).body).toHaveLength(500);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries retryable failures and honors Retry-After", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({}, 503, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await httpJson<{ ok: boolean }>("https://example.com/api");
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops retrying after the attempt budget", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({}, 503);
    });
    vi.stubGlobal("fetch", fetchMock);
    const caught3 = await httpJson("https://example.com/api", { retries: 1 }).catch(
      (error: unknown) => error,
    );
    expect(caught3).toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts hung requests after the timeout", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      await Promise.resolve();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      httpJson("https://example.com/api", { timeoutMs: 20, retries: 1 }),
    ).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
