import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, normalizeBaseUrl, postFormWithProgress, RequestError } from "./client.ts";

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
