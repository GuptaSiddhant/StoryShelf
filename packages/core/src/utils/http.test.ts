import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.ts";
import { HttpError, httpBytes, httpJson, httpText, redactUrlForLog } from "./http.ts";

const spanAttributes = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("../tracing.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tracing.ts")>();
  return {
    ...original,
    withSpan: ((name, fn, attributes, parent) => {
      spanAttributes.push({ ...attributes });
      return original.withSpan(name, fn, attributes, parent);
    }) as typeof original.withSpan,
  };
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  spanAttributes.length = 0;
});

/** A logger that records every call as one JSON line, so a test can search all of it. */
function recordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(JSON.stringify({ level, args }));
    };
  const logger = { debug: record("debug"), warn: record("warn"), info: record("info") };
  return { logger: logger as unknown as Logger, lines };
}

const SECRET_URLS: { url: string; secrets: string[]; expected: string }[] = [
  {
    url: "https://hooks.slack.com/services/T000/B000/SECRETxyz?token=abc",
    secrets: ["SECRETxyz", "T000", "B000", "abc", "token="],
    expected: "https://hooks.slack.com/services/…",
  },
  {
    url: "https://user:pass@example.com/a/b",
    secrets: ["user", "pass", "@"],
    expected: "https://example.com/a/…",
  },
];

describe("redactUrlForLog", () => {
  it.each(SECRET_URLS)("keeps only the origin and first segment of $url", (row) => {
    expect(redactUrlForLog(row.url)).toBe(row.expected);
  });

  it("drops a single-segment path, which may itself be the secret", () => {
    expect(redactUrlForLog("https://example.com/SECRETONLY?x=1#frag")).toBe("https://example.com");
    expect(redactUrlForLog("https://example.com/")).toBe("https://example.com");
  });

  it("keeps a non-default port and never throws on an invalid URL", () => {
    expect(redactUrlForLog("http://localhost:3000/api/v1/x")).toBe("http://localhost:3000/api/…");
    expect(redactUrlForLog("not a url with SECRET")).toBe("[invalid url]");
  });
});

describe("secret-bearing URLs in logs and spans", () => {
  it.each(SECRET_URLS)("never logs or traces secrets of $url across a retry", async (row) => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({}, 503, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { logger, lines } = recordingLogger();
    await httpText(row.url, { method: "POST", json: {}, logger });
    const warned = lines.filter((line) => line.includes("http request failed, retrying"));
    expect(warned).toHaveLength(1);
    expect(lines.some((line) => line.includes(row.expected))).toBe(true);
    const everything = JSON.stringify({ lines, spans: spanAttributes });
    for (const secret of row.secrets) {
      expect(everything).not.toContain(secret);
    }
    expect(spanAttributes[0]?.["url.full"]).toBe(row.expected);
  });

  it("still requests the real URL", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    await httpJson(SECRET_URLS[0]!.url);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(SECRET_URLS[0]!.url);
  });
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

describe("httpText", () => {
  it("returns raw text for non-JSON webhook responses", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = await httpText("https://hooks.example.com/x", {
      method: "POST",
      json: { text: "hello" },
    });
    expect(body).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws HttpError on non-2xx without swallowing the body", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response("invalid_token", { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const caught = await httpText("https://hooks.example.com/x").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("httpBytes", () => {
  it("returns the raw bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return new Response(new Uint8Array([1, 2, 3]));
      }),
    );
    expect([...(await httpBytes("https://example.com/a.png"))]).toEqual([1, 2, 3]);
  });

  it("throws HttpError on a non-retryable status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return new Response("nope", { status: 404 });
      }),
    );
    const caught = await httpBytes("https://example.com/a.png").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HttpError);
  });
});
