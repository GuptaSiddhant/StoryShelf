import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReporter } from "../output.ts";
import { runUpload } from "./upload.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-output-"));
  const buildDir = join(dir, "storybook-static");
  mkdirSync(buildDir, { recursive: true });
  const entries = { "a--one": { id: "a--one", title: "A", name: "One", type: "story" } };
  writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries }));
  writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
  writeFileSync(join(buildDir, "main.js"), "x".repeat(2048));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A server that accepts the file-by-file routes. */
function stubServer(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      const path = new URL(url).pathname;
      if (path.endsWith("/builds/in-flight")) return json([]);
      if (path.endsWith("/dedup")) {
        return json({ needed: (JSON.parse(init?.body as string) as { hashes: string[] }).hashes });
      }
      if (path.endsWith("/builds")) {
        return json({
          build: { id: "b1" },
          uploadUrl: "/x",
          baselineSha: null,
          buildUrl: "/projects/demo/builds/b1",
        });
      }
      return json({ ok: true });
    }),
  );
}

/** Run one fake upload with a clock that advances 400ms per reading; returns [stderr, stdout]. */
async function fakeUpload(interactive: boolean): Promise<[string, string]> {
  let tick = 0;
  let err = "";
  let out = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  stubServer();
  await runUpload({
    url: "https://shelf.example.com",
    slug: "demo",
    token: "secret-ci-token",
    sha: "abc123",
    branch: "main",
    cwd: dir,
    buildDir: "storybook-static",
    reporter: createReporter({
      interactive,
      color: false,
      now: () => (tick += 400),
      write: (text) => {
        err += text;
      },
    }),
  });
  return [err, out];
}

describe("upload output", () => {
  it("prints one open and one close line per phase when not on a terminal", async () => {
    const [err, out] = await fakeUpload(false);
    expect(err).toMatchInlineSnapshot(`
      "==> Checking config
      --> Checked config (0.4s)
      ==> Building Storybook
      --> Built Storybook (0.4s)
      ==> Creating build
      --> Created build (0.4s)
      ==> Selecting affected stories
      --> Selected affected stories (0.4s)
      ==> Recording package usage
      --> Recorded package usage (0.4s)
      ==> Uploading Storybook
      --> Uploaded Storybook (0.4s)
      "
    `);
    expect(out).toMatchInlineSnapshot(`
      "Full capture (no baseline build yet): rendering all stories
      Uploading 3 of 3 files (the server has the rest)
      Summary
        Files:    3
        Size:     2.1 KiB
        Stories:  full capture (1 stories)
        Build:    b1
        Time:     5.2s
      View the build: https://shelf.example.com/projects/demo/builds/b1
      "
    `);
    expect(err + out).not.toContain("secret-ci-token");
    expect(err).not.toContain("\r");
  });

  it("redraws progress in place on a terminal, on stderr only", async () => {
    const [err, out] = await fakeUpload(true);
    expect(err).toContain("\r\u001B[2K    3/3 files");
    expect(err).toContain("\r\u001B[2K--> Uploaded Storybook (0.4s)");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("files\r");
  });
});
