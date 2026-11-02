import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.ts";
import { recordSpans, type RecordedSpan } from "../test-helpers/span-recorder.ts";
import { HttpError, httpBytes, httpJson, httpStatus, httpText, redactUrlForLog } from "./http.ts";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

let recorder: ReturnType<typeof recordSpans>;

beforeEach(() => {
  recorder = recordSpans();
});

afterEach(() => {
  vi.unstubAllGlobals();
  recorder.stop();
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

describe("redactUrlForLog", () => {
  it.each([
    ["https://hooks.slack.com/services/T000/B000/SECRETxyz?token=abc", "https://hooks.slack.com"],
    ["https://user:pass@example.com/a/b", "https://example.com"],
    ["https://api.telegram.org/bot123:ABC/sendMessage", "https://api.telegram.org"],
    ["http://localhost:3000/api/v1/x?token=1#frag", "http://localhost:3000"],
    ["https://example.com/", "https://example.com"],
  ])("keeps only the origin of %s", (url, origin) => {
    expect(redactUrlForLog(url)).toBe(origin);
  });

  it("never throws on an invalid URL", () => {
    expect(redactUrlForLog("not a url with SECRET")).toBe("[invalid url]");
  });
});

/** The request URL, and a response body that echoes it raw, URL-encoded and HTML-escaped. */
const SECRET_URL = "https://u:p@h.example/SECRET/path?token=abc";
const ECHO = [SECRET_URL, encodeURIComponent(SECRET_URL), `${SECRET_URL}&amp;x=1`].join(" | ");
const FORBIDDEN = ["SECRET", "token=abc", "abc", "u:p", "u%3Ap", "p@h"];

function expectNoSecrets(spans: RecordedSpan[], lines: string[]): void {
  const everything = JSON.stringify({ spans, lines });
  for (const secret of FORBIDDEN) {
    expect(everything).not.toContain(secret);
  }
}

describe("spans and logs of a request with a secret URL", () => {
  it("records only the status of a non-retried 4xx, and still throws the response body to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.resolve(new Response(ECHO, { status: 404 }))),
    );
    const { logger, lines } = recordingLogger();
    const caught = await httpText(SECRET_URL, { logger }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
    expect((caught as HttpError).body).toContain("SECRET");
    expect((caught as HttpError).message).toContain("HTTP 404: ");
    const [span] = recorder.spans;
    expect(span?.name).toBe("http.client");
    expect(span?.exceptions).toEqual([
      {
        name: "HttpError",
        message: "HTTP 404",
        stack: expect.stringMatching(/^HttpError: HTTP 404/u),
      },
    ]);
    expect(span?.attributes["http.response.status_code"]).toBe(404);
    expect(span?.attributes["url.full"]).toBe("https://h.example");
    expect(span?.status?.code).toBe(2);
    expectNoSecrets(recorder.spans, lines);
  });

  it("records only the status of a failure on the final retry, and of the retried ones", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(ECHO, { status: 503, headers: { "retry-after": "0" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { logger, lines } = recordingLogger();
    const caught = await httpText(SECRET_URL, { retries: 2, logger }).catch(
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [span] = recorder.spans;
    expect(span?.exceptions.map((exception) => exception.message)).toEqual([
      "HTTP 503",
      "HTTP 503",
    ]);
    expect(span?.attributes["http.retry.count"]).toBe(1);
    expect(lines.some((line) => line.includes("https://h.example"))).toBe(true);
    expectNoSecrets(recorder.spans, lines);
  });

  it("records a refused userinfo URL with the URL replaced by its origin, and rethrows the original", async () => {
    const failure = new TypeError(
      `Request cannot be constructed from a URL that includes credentials: ${SECRET_URL}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.reject(failure)),
    );
    const caught = await httpText(SECRET_URL, { retries: 1 }).catch((error: unknown) => error);
    expect(caught).toBe(failure);
    expect(failure.message).toContain(SECRET_URL);
    const [span] = recorder.spans;
    expect(span?.exceptions).toHaveLength(1);
    expect(span?.exceptions[0]?.message).toBe(
      "Request cannot be constructed from a URL that includes credentials: https://h.example",
    );
    expectNoSecrets(recorder.spans, []);
  });

  it("records an unparseable URL, which fetch echoes as given, as an invalid URL", async () => {
    const relative = "/SECRET/path?token=abc";
    const failure = new TypeError(`Failed to parse URL from ${relative}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.reject(failure)),
    );
    const caught = await httpText(relative, { retries: 1 }).catch((error: unknown) => error);
    expect(caught).toBe(failure);
    const [span] = recorder.spans;
    expect(span?.exceptions[0]?.message).toBe("Failed to parse URL from [invalid url]");
    expect(span?.attributes["url.full"]).toBe("[invalid url]");
    expectNoSecrets(recorder.spans, []);
  });

  it("still requests the real URL", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    await httpJson(SECRET_URL);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(SECRET_URL);
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

/** A response whose body rejects when cancelled. */
function rejectingResponse(status: number): Response {
  const response = new Response("x", { status });
  Object.defineProperty(response, "body", {
    value: { cancel: async () => await Promise.reject(new Error("cancel failed")) },
  });
  return response;
}

/** A response whose endless body records whether anything pulled from it or cancelled it. */
function endlessResponse(status: number): { response: Response; state: StreamState } {
  const state: StreamState = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body, { status }), state };
}

interface StreamState {
  pulls: number;
  cancelled: boolean;
}

describe("httpStatus", () => {
  it("resolves with the status and cancels the body unread on a 2xx", async () => {
    const { response, state } = endlessResponse(201);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.resolve(response)),
    );
    expect(await httpStatus("https://hooks.example.com/x", { method: "POST" })).toBe(201);
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it("throws an HttpError with no body and cancels it unread on an error", async () => {
    const { response, state } = endlessResponse(403);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.resolve(response)),
    );
    const caught = await httpStatus("https://hooks.example.com/x").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(403);
    expect((caught as HttpError).body).toBe("");
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it("keeps the outcome when cancelling the body rejects (no resend of a delivered request)", async () => {
    const fetchMock = vi.fn(async () => await Promise.resolve(rejectingResponse(200)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await httpStatus("https://hooks.example.com/x", { method: "POST" })).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockImplementation(async () => await Promise.resolve(rejectingResponse(403)));
    const caught = await httpStatus("https://hooks.example.com/x").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(403);
  });

  it("retries a 503 and cancels every body it does not read", async () => {
    const first = endlessResponse(503);
    const second = endlessResponse(200);
    const queue = [first.response, second.response];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.resolve(queue.shift())),
    );
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });
    expect(await httpStatus("https://hooks.example.com/x")).toBe(200);
    expect(first.state.cancelled).toBe(true);
    expect(second.state.cancelled).toBe(true);
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
