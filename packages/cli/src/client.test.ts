import { Readable as NodeReadable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorText,
  createClient,
  normalizeBaseUrl,
  postForm,
  postJson,
  RequestError,
} from "./client.ts";

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://shelf.example.com")).toBe("https://shelf.example.com");
    expect(normalizeBaseUrl("https://shelf.example.com/")).toBe("https://shelf.example.com");
    expect(normalizeBaseUrl("https://shelf.example.com///")).toBe("https://shelf.example.com");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("skip calls", () => {
  it("asks for the skip source with the branch and sha in the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ sourceBuildId: "b1", sha: "abc" }));
    vi.stubGlobal("fetch", fetchMock);
    const source = await createClient("https://shelf.test", "tok").projects.builds.skipSource(
      "demo",
      "feat/a b",
      "def",
    );
    expect(source).toEqual({ sourceBuildId: "b1", sha: "abc" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://shelf.test/api/v1/projects/demo/builds/skip-source?branch=feat%2Fa+b&sha=def",
    );
  });

  it("posts a skipped build as JSON, and a refusal is a RequestError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ build: { id: "b2" }, buildUrl: "/builds/b2" }))
      .mockResolvedValueOnce(new Response("no", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const { builds } = createClient("https://shelf.test", "tok").projects;
    const input = {
      gitSha: "s",
      gitBranch: "main",
      sourceBuildId: "b1",
      changedFiles: ["a"],
      entryIds: ["a--b"],
      idempotencyKey: "k1",
    };
    await expect(builds.createSkipped("demo", input)).resolves.toMatchObject({
      build: { id: "b2" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shelf.test/api/v1/projects/demo/builds/skipped",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
    await expect(builds.createSkipped("demo", input)).rejects.toMatchObject({ status: 409 });
  });
});

describe("file-by-file upload calls", () => {
  it("posts hashes to /dedup and returns the needed ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ needed: ["b"] }));
    vi.stubGlobal("fetch", fetchMock);
    const needed = await createClient("https://shelf.test", "tok").projects.builds.dedup(
      "demo",
      "b1",
      ["a", "b"],
    );
    expect(needed).toEqual(["b"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shelf.test/api/v1/projects/demo/builds/b1/dedup",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ hashes: ["a", "b"] }) }),
    );
  });

  it("posts content as multipart keyed by hash, and the manifest as JSON", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { builds } = createClient("https://shelf.test").projects;
    await builds.uploadContent("demo", "b1", [{ hash: "h1", data: Buffer.from("x") }]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["h1"]);
    await builds.postManifest("demo", "b1", [{ rel: "a.js", hash: "h1", size: 1 }]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://shelf.test/api/v1/projects/demo/builds/b1/manifest",
    );
  });

  it("throws a RequestError carrying the status when the zip is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too big", { status: 413 })));
    const { Readable } = await import("node:stream");
    const attempt = createClient("https://shelf.test").projects.builds.uploadZip(
      "/zip",
      Readable.from([Buffer.from("zip")]),
    );
    await expect(attempt).rejects.toBeInstanceOf(RequestError);
    await expect(attempt).rejects.toMatchObject({ status: 413 });
  });
});

const okFetch = (): ReturnType<typeof vi.fn> =>
  vi.fn().mockResolvedValue(Response.json({ slug: "demo" }));

describe("server url forms", () => {
  it.each([
    ["https://shelf.test", "https://shelf.test/api/v1/projects/demo"],
    ["https://shelf.test/", "https://shelf.test/api/v1/projects/demo"],
    ["https://shelf.test///", "https://shelf.test/api/v1/projects/demo"],
    ["https://shelf.test/shelf/", "https://shelf.test/shelf/api/v1/projects/demo"],
  ])("reaches /api/v1 with one slash from %s", async (serverUrl, expected) => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await createClient(serverUrl, "t").projects.get("demo");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expected);
  });

  it("says plainly when the server answers with an HTML page, naming only the origin", async () => {
    const page = new Response("<!DOCTYPE html><html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page));
    const failure = createClient("https://user:pw@shelf.test/secret/path", "t").projects.get(
      "demo",
    );
    await expect(failure).rejects.toThrow(
      /^The server at https:\/\/shelf\.test answered with an HTML page, not JSON\. Check the url/u,
    );
    await expect(failure).rejects.not.toThrow(/secret|pw|Unexpected token/u);
  });

  it("names the content type of any other non-JSON answer", async () => {
    const plain = new Response("nope", { headers: { "content-type": "text/plain" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(plain));
    await expect(createClient("https://shelf.test").projects.get("demo")).rejects.toThrow(
      /answered with a response that is not JSON \(text\/plain\)/u,
    );
  });

  it("describes an HTML page behind a failed status, keeping the status", async () => {
    const page = new Response("<html>502 Bad Gateway</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page));
    const failure = createClient("https://shelf.test", "t").projects.get("demo");
    await expect(failure).rejects.toMatchObject({ name: "RequestError", status: 502 });
    await expect(failure).rejects.toThrow(/answered with an HTML page, not JSON/u);
    await expect(failure).rejects.not.toThrow(/Bad Gateway/u);
  });

  it("keeps the raw body of a failed non-HTML answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400 })));
    await expect(createClient("https://shelf.test").projects.get("demo")).rejects.toThrow(
      /Request failed \(400\): boom/u,
    );
  });

  it("shows the message of a JSON error from a current server", async () => {
    const body = { error: { message: "Project not found" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 404 })));
    const failure = createClient("https://shelf.test").projects.get("demo");
    await expect(failure).rejects.toMatchObject({ name: "RequestError", status: 404 });
    await expect(failure).rejects.toThrow("Request failed (404): Project not found");
  });

  it("shows the message of a JSON error on the form and JSON posts too", async () => {
    const body = { error: { message: "Upload too large" } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json(body, { status: 413 })),
    );
    await expect(postForm("https://shelf.test/x", new FormData())).rejects.toThrow(
      "Request failed (413): Upload too large",
    );
  });

  it("describes an HTML page where the zip upload expects JSON", async () => {
    const page = new Response("<html></html>", { headers: { "content-type": "text/html" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page));
    const upload = createClient("https://shelf.test/shelf/", "t").projects.builds.uploadZip(
      "/api/v1/projects/demo/builds/b1/zip",
      NodeReadable.from([]),
    );
    await expect(upload).rejects.toThrow(
      /^The server at https:\/\/shelf\.test answered with an HTML page/u,
    );
  });

  it("keeps a transport error while reading the body instead of blaming the url", async () => {
    const dropped = new Error("terminated");
    const res = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.reject(dropped),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    await expect(createClient("https://shelf.test").projects.get("demo")).rejects.toBe(dropped);
  });

  it("releases the body of an HTML error page it does not read", async () => {
    const page = new Response("<html></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const cancel = vi.spyOn(page.body as ReadableStream, "cancel");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page));
    await expect(createClient("https://shelf.test").projects.get("demo")).rejects.toMatchObject({
      status: 502,
    });
    expect(cancel).toHaveBeenCalled();
  });
});

const envelope = () => Response.json({ error: { message: "Project not found" } }, { status: 404 });
const plain = () => new Response("Project not found", { status: 404 });

describe("failed posts show the server's message", () => {
  const posts: [string, () => Promise<unknown>][] = [
    ["postJson", async () => await postJson("https://shelf.test/x", { a: 1 })],
    ["postForm", async () => await postForm("https://shelf.test/x", new FormData())],
  ];

  for (const [name, post] of posts) {
    it(`${name}: a JSON envelope from a current server`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () => envelope()),
      );
      await expect(post()).rejects.toThrow("Request failed (404): Project not found");
    });

    it(`${name}: the plain text of an older server`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () => plain()),
      );
      await expect(post()).rejects.toThrow("Request failed (404): Project not found");
    });
  }
});

describe("apiErrorText", () => {
  it("reads error.message from the JSON envelope", () => {
    expect(apiErrorText('{"error":{"message":"No such build"}}')).toBe("No such build");
  });

  it("falls back to the raw text for an older server's plain text", () => {
    expect(apiErrorText("Build not found")).toBe("Build not found");
    expect(apiErrorText("")).toBe("");
  });

  it("keeps JSON of another shape as it is", () => {
    for (const body of [
      '{"message":"old json"}',
      '{"error":"text"}',
      '{"error":{"message":""}}',
      "null",
      "[]",
    ]) {
      expect(apiErrorText(body)).toBe(body);
    }
  });
});

describe("builds.get", () => {
  it("reads one build with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "b1", status: "capturing" }));
    vi.stubGlobal("fetch", fetchMock);
    const state = await createClient("https://shelf.test", "tok").projects.builds.get("demo", "b1");
    expect(state.status).toBe("capturing");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://shelf.test/api/v1/projects/demo/builds/b1");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("keeps Retry-After seconds on a throttled answer", async () => {
    const throttled = new Response("{}", { status: 429, headers: { "retry-after": "7" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(throttled));
    const error = await createClient("https://shelf.test")
      .projects.builds.get("demo", "b1")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryAfterMs).toBe(7000);
  });

  it.each([{}, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }])(
    "has no retryAfterMs without a usable header (%j)",
    async (headers) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("{}", { status: 503, headers: headers as Record<string, string> }),
          ),
      );
      const error = await createClient("https://shelf.test")
        .projects.builds.get("demo", "b1")
        .catch((caught: unknown) => caught);
      expect((error as RequestError).retryAfterMs).toBeUndefined();
    },
  );
});

const throttled = (): Response =>
  new Response("{}", { status: 429, headers: { "retry-after": "2" } });

describe("429 retries on create and upload calls", () => {
  const created = { build: { id: "b1" }, uploadUrl: "/u" };
  const input = { gitSha: "abc", gitBranch: "main" };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits Retry-After and repeats a create call", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(Response.json(created));
    vi.stubGlobal("fetch", fetchMock);
    const pending = createClient("https://shelf.test").projects.builds.createJson("demo", input);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retries and names the limit and trustProxy", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => throttled());
    vi.stubGlobal("fetch", fetchMock);
    const pending = createClient("https://shelf.test")
      .projects.builds.inFlight("demo", "main")
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = (await pending) as RequestError;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(RequestError);
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/rate limit.*trustProxy/u);
  });

  it("does not retry other failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createClient("https://shelf.test").projects.builds.createJson("demo", input),
    ).rejects.toThrow("500");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
