import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, RequestError } from "../client.ts";
import { isOverInlineLimit, uploadFileByFile } from "./file-by-file.ts";
import { runUpload } from "./upload.ts";

const HINT =
  "Zip is larger than the inline publish limit and this host runs no publish consumer. " +
  "Upload the Storybook file by file instead: POST /dedup, then PUT /content, then POST /manifest";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-fbf-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function writeBuild(files: Record<string, string>): void {
  const buildDir = join(dir, "storybook-static");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries: {} }));
  writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(buildDir, name), text);
  }
}

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/** A server that refuses the zip with the pointer, and answers the file-by-file routes. */
function stubServer(
  options: { has?: string[]; zipStatus?: number; zipBody?: string } = {},
): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      const path = new URL(url).pathname.replace("/api/v1/projects/demo", "");
      const method = init?.method ?? "GET";
      seen.push({ method, path, body: init?.body });
      if (path.endsWith("/builds") && method === "POST") {
        return json({ build: { id: "b1" }, uploadUrl: "/api/v1/projects/demo/builds/b1/zip" });
      }
      if (path.endsWith("/zip")) {
        return new Response(options.zipBody ?? JSON.stringify({ message: HINT }), {
          status: options.zipStatus ?? 413,
        });
      }
      if (path.endsWith("/dedup")) {
        const { hashes } = JSON.parse(init?.body as string) as { hashes: string[] };
        return json({ needed: hashes.filter((hash) => !(options.has ?? []).includes(hash)) });
      }
      return json({ ok: true, id: "b1" });
    }),
  );
  return seen;
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const options = () => ({
  url: "https://shelf.example.com",
  slug: "demo",
  token: "ci",
  sha: "abc123",
  branch: "main",
  cwd: dir,
  buildDir: "storybook-static",
  full: true,
});

describe("upload over the inline limit", () => {
  it("falls back to dedup, content and manifest when the zip is refused with the pointer", async () => {
    writeBuild({ "index.html": "<html>", "app.js": "js", "copy.js": "js" });
    const seen = stubServer({ has: [sha("<html>")] });

    await runUpload(options());

    const calls = seen.map((call) => `${call.method} ${call.path.replace("/builds/b1", "")}`);
    expect(calls.filter((call) => !call.includes("/affected") && !call.includes("/usage"))).toEqual(
      ["POST /builds", "PUT /zip", "POST /dedup", "POST /content", "POST /manifest"],
    );
    const content = seen.find((call) => call.path.endsWith("/content"))?.body as FormData;
    // The server had index.html; identical files (app.js, copy.js) are sent once.
    expect([...content.keys()].toSorted()).toEqual(
      [sha("js"), sha("<html></html>"), sha(JSON.stringify({ v: 5, entries: {} }))].toSorted(),
    );
    const manifest = JSON.parse(
      seen.find((call) => call.path.endsWith("/manifest"))?.body as string,
    ) as { files: { rel: string; hash: string }[] };
    expect(manifest.files.map((file) => file.rel).toSorted()).toEqual([
      "app.js",
      "copy.js",
      "iframe.html",
      "index.html",
      "index.json",
    ]);
  });

  it("explains a rejected inline zip without bypassing extraction limits", async () => {
    writeBuild({ "index.html": "<html>" });
    const seen = stubServer({ zipStatus: 422, zipBody: "Zip holds more than 10 entries" });

    await expect(runUpload(options())).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(
        /Zip holds more than 10 entries[\s\S]*maxZipEntries[\s\S]*build b1[\s\S]*\/builds\/b1\/zip/u,
      ),
    });
    expect(seen.some((call) => call.path.endsWith("/dedup"))).toBe(false);
  });

  it("does not fall back on other errors, nor on the plain size-limit 413", async () => {
    writeBuild({ "index.html": "<html>" });
    stubServer({
      zipStatus: 413,
      zipBody: JSON.stringify({ message: "Upload exceeds size limit" }),
    });
    await expect(runUpload(options())).rejects.toThrow(/Request failed \(413\)/u);

    stubServer({ zipStatus: 500, zipBody: "boom" });
    await expect(runUpload(options())).rejects.toThrow(/Request failed \(500\)/u);
  });
});

describe("isOverInlineLimit", () => {
  it("matches only the 413 that points to the file-by-file route", () => {
    expect(isOverInlineLimit(new RequestError(413, HINT))).toBe(true);
    expect(isOverInlineLimit(new RequestError(413, "Upload exceeds size limit"))).toBe(false);
    expect(isOverInlineLimit(new RequestError(500, HINT))).toBe(false);
    expect(isOverInlineLimit(new Error(HINT))).toBe(false);
  });
});

describe("uploadFileByFile", () => {
  it("sends content in batches of at most 50 files", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i += 1) {
      files[`f${i}.txt`] = `file-${i}`;
    }
    writeBuild(files);
    const seen = stubServer();
    const client = createClient("https://shelf.example.com", "ci");

    await uploadFileByFile(
      client,
      { slug: "demo", buildId: "b1", cwd: dir, buildDir: "storybook-static" },
      () => {},
    );

    const contents = seen.filter((call) => call.path.endsWith("/content"));
    expect(contents.map((call) => [...(call.body as FormData).keys()].length)).toEqual([
      50, 50, 22,
    ]);
    expect(seen.at(-1)?.path).toBe("/builds/b1/manifest");
  });
});
