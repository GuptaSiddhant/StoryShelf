import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReporter } from "../output.ts";
import { writeGithubOutputs } from "./upload-result.ts";
import { runUpload } from "./upload.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-json-"));
  const buildDir = join(dir, "storybook-static");
  mkdirSync(buildDir, { recursive: true });
  const entries = { "a--one": { id: "a--one", title: "A", name: "One", type: "story" } };
  writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries }));
  writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A server that creates build `b1` and reports it approved. */
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
      if (path.endsWith("/builds") && init?.method === "POST") {
        return json({
          build: { id: "b1" },
          uploadUrl: "/x",
          baselineSha: null,
          buildUrl: "/projects/demo/builds/b1",
        });
      }
      if (path.endsWith("/builds/b1") && init?.method === undefined) {
        return json({ id: "b1", changedCount: 0, status: "approved", publishing: "success" });
      }
      return json({ ok: true });
    }),
  );
}

/** Upload with `--json`; returns [stdout, stderr]. */
async function jsonUpload(
  extra: { wait?: boolean; dryRun?: boolean } = {},
): Promise<[string, string]> {
  let out = "";
  let err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
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
    json: true,
    ...extra,
    reporter: createReporter({ interactive: false, color: false }),
  });
  return [out, err];
}

describe("upload --json", () => {
  it("prints exactly one JSON object on stdout and all human output on stderr", async () => {
    const [out, err] = await jsonUpload();
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      buildId: "b1",
      url: "https://shelf.example.com/projects/demo/builds/b1",
      status: "created",
      skipped: false,
    });
    expect(err).toContain("==> Uploading Storybook");
    expect(err).toContain("Summary");
    expect(out + err).not.toContain("secret-ci-token");
  });

  it("adds the verdict and exit code with --wait, and keeps the exit code", async () => {
    const [out, err] = await jsonUpload({ wait: true });
    expect(JSON.parse(out)).toMatchObject({ buildId: "b1", verdict: "approved", exitCode: 0 });
    expect(err).toContain("Build approved");
    expect(process.exitCode).toBeUndefined();
  });

  it("reports a dry run with no build", async () => {
    const [out] = await jsonUpload({ dryRun: true });
    expect(JSON.parse(out)).toEqual({
      buildId: null,
      url: null,
      status: "dry-run",
      skipped: false,
    });
  });

  it("appends build-id and build-url to GITHUB_OUTPUT with or without --json", async () => {
    const file = join(dir, "github-output");
    vi.stubEnv("GITHUB_OUTPUT", file);
    await jsonUpload();
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/^build-id<<(ghadelimiter_[\w-]+)\nb1\n\1\n/u);
    expect(text).toContain("\nhttps://shelf.example.com/projects/demo/builds/b1\n");
    expect(text).toContain("build-url<<");
  });
});

describe("writeGithubOutputs", () => {
  it("does nothing without GITHUB_OUTPUT or without a build", () => {
    const file = join(dir, "out");
    writeGithubOutputs({ buildId: "b1", url: null }, {});
    writeGithubOutputs({ buildId: null, url: null }, { GITHUB_OUTPUT: file });
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  it("omits build-url when the server gave none and is multiline-safe", () => {
    const file = join(dir, "out");
    writeGithubOutputs({ buildId: "b1\nevil=1", url: null }, { GITHUB_OUTPUT: file });
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("build-url");
    expect(text).toMatch(/^build-id<<(\S+)\nb1\nevil=1\n\1\n$/u);
  });
});
