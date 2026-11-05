import { Readable as NodeReadable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorText,
  createClient,
  normalizeBaseUrl,
  postFormWithProgress,
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

describe("postFormWithProgress", () => {
  it("posts the form and returns the parsed JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "01JABC" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("gitSha", "abc123");
    form.set("gitBranch", "main");

    const result = await postFormWithProgress<{ id: string }>(
      "https://shelf.test/api/v1/projects/demo/builds",
      form,
      { authorization: "Bearer token" },
    );

    expect(result.id).toBe("01JABC");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shelf.test/api/v1/projects/demo/builds",
      expect.objectContaining({ method: "POST", body: form }),
    );
  });

  it("throws when the server responds with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400 })));
    const form = new FormData();

    await expect(
      postFormWithProgress("https://shelf.test/projects/demo/builds", form),
    ).rejects.toThrow(/Request failed \(400\): boom/u);
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
    await expect(postFormWithProgress("https://shelf.test/x", new FormData())).rejects.toThrow(
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
