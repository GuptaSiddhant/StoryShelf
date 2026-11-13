import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpload } from "./upload.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shelf-upload-hash-"));
  const build = join(dir, "storybook-static");
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "index.json"), JSON.stringify({ v: 5, entries: {} }));
  writeFileSync(join(build, "iframe.html"), "<html></html>");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function options(extra: { zip?: boolean } = {}) {
  return {
    url: "https://shelf.example.com",
    slug: "demo",
    token: "t",
    sha: "abc",
    branch: "main",
    cwd: dir,
    full: true,
    ...extra,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fake server; `hasHashRoutes: false` answers 404 on /dedup like an older release. */
function stubServer(opts: { held: boolean; hasHashRoutes: boolean }): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      const path = new URL(url).pathname.replace("/api/v1/projects/demo/builds", "") || "/";
      seen.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/") {
        return json({ build: { id: "b1" }, uploadUrl: "/api/v1/projects/demo/builds/b1/zip" });
      }
      if (path.endsWith("/dedup")) {
        if (!opts.hasHashRoutes) {
          return json({ message: "Not Found" }, 404);
        }
        const body = JSON.parse(init?.body as string) as { hashes: string[] };
        return json({ needed: opts.held ? [] : body.hashes });
      }
      if (init?.method === "PUT") {
        await new Response(init.body as ReadableStream).arrayBuffer().catch(() => null);
      }
      return json({ ok: true });
    }),
  );
  return seen;
}

describe("runUpload by content hash", () => {
  it("sends only changed files, then the manifest, with no zip", async () => {
    const seen = stubServer({ held: false, hasHashRoutes: true });
    await runUpload(options());
    expect(seen).toEqual(["POST /", "POST /b1/dedup", "POST /b1/content", "POST /b1/manifest"]);
  });

  it("sends only the manifest when the server holds every file", async () => {
    const seen = stubServer({ held: true, hasHashRoutes: true });
    await runUpload(options());
    expect(seen).toEqual(["POST /", "POST /b1/dedup", "POST /b1/manifest"]);
  });

  it("falls back to the zip when /dedup answers 404", async () => {
    const seen = stubServer({ held: false, hasHashRoutes: false });
    await runUpload(options());
    expect(seen).toEqual(["POST /", "POST /b1/dedup", "PUT /b1/zip"]);
  });

  it("--zip skips the hash routes", async () => {
    const seen = stubServer({ held: false, hasHashRoutes: true });
    await runUpload(options({ zip: true }));
    expect(seen).toEqual(["POST /", "PUT /b1/zip"]);
  });

  it("STORYSHELF_ZIP=1 skips the hash routes", async () => {
    vi.stubEnv("STORYSHELF_ZIP", "1");
    const seen = stubServer({ held: false, hasHashRoutes: true });
    await runUpload(options());
    expect(seen).toEqual(["POST /", "PUT /b1/zip"]);
  });
});
