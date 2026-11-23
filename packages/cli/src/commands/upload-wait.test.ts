import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../index.ts";
import { createReporter } from "../output.ts";
import { runUpload } from "./upload.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-wait-"));
  const buildDir = join(dir, "storybook-static");
  mkdirSync(buildDir, { recursive: true });
  const entries = { "a--one": { id: "a--one", title: "A", name: "One", type: "story" } };
  writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries }));
  writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
});
afterEach(() => {
  process.exitCode = undefined;
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

/** A server whose build answers walk through `states`; `testing` is what the create answer says. */
function stubServer(states: object[], testing = true): void {
  let polls = 0;
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
          testing,
        });
      }
      if (path.endsWith("/builds/b1") && init?.method === undefined) {
        const state = states[Math.min(polls, states.length - 1)];
        polls += 1;
        return json({ id: "b1", changedCount: 0, ...state });
      }
      return json({ ok: true });
    }),
  );
}

/** Upload with `--wait` on a frozen clock; returns what went to stdout and stderr. */
async function waitedUpload(
  extra: { timeout?: string; wait?: boolean } = {},
): Promise<[string, string]> {
  let time = 0;
  let out = "";
  let err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  await runUpload({
    url: "https://shelf.example.com",
    slug: "demo",
    token: "secret-ci-token",
    sha: "abc123",
    branch: "main",
    cwd: dir,
    buildDir: "storybook-static",
    wait: true,
    ...extra,
    waitDeps: {
      now: () => time,
      sleep: async (ms) => {
        await Promise.resolve();
        time += ms;
      },
    },
    reporter: createReporter({
      interactive: false,
      color: false,
      now: () => time,
      write: (text) => {
        err += text;
      },
    }),
  });
  return [err, out];
}

describe("upload --wait", () => {
  it("follows the build to approval and leaves the exit code at 0", async () => {
    stubServer([
      { status: "pending", publishing: "pending" },
      { status: "capturing", publishing: "success", capture: { done: 1, total: 1 } },
      { status: "approved", publishing: "success" },
    ]);
    const [err, out] = await waitedUpload();
    expect(process.exitCode).toBeUndefined();
    expect(err).toContain("==> Publishing");
    expect(err).toContain("==> Capturing");
    expect(out).toContain("Build approved");
    expect(err + out).not.toContain("secret-ci-token");
    expect(err).not.toContain("\r");
  });

  it("exits 2 when changes need review", async () => {
    stubServer([{ status: "reviewing", changedCount: 2, publishing: "success" }]);
    const [, out] = await waitedUpload();
    expect(process.exitCode).toBe(2);
    expect(out).toContain("2 visual changes need review");
    expect(out).toContain("Review: https://shelf.example.com/projects/demo/builds/b1");
  });

  it("exits 6 at --timeout and says nothing was cancelled", async () => {
    stubServer([{ status: "capturing", publishing: "success" }]);
    const [, out] = await waitedUpload({ timeout: "10s" });
    expect(process.exitCode).toBe(6);
    expect(out).toContain("still capturing; nothing was cancelled");
  });

  it("with testing off, ends after publishing", async () => {
    stubServer([{ status: "pending", publishing: "success" }], false);
    const [err, out] = await waitedUpload();
    expect(process.exitCode).toBe(2);
    expect(err).not.toContain("==> Capturing");
    expect(out).toContain("Storybook published; waiting for a review verdict");
  });

  it("refuses --timeout without --wait and a timeout that is not a duration", async () => {
    stubServer([{ status: "approved" }]);
    await expect(waitedUpload({ wait: false, timeout: "10s" })).rejects.toThrow(
      "only applies with --wait",
    );
    await expect(waitedUpload({ timeout: "soon" })).rejects.toThrow("not a duration");
  });

  it("waits for nothing without --wait", async () => {
    stubServer([{ status: "capturing" }]);
    await waitedUpload({ wait: false });
    expect(process.exitCode).toBeUndefined();
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => (url as string).endsWith("/builds/b1")),
    ).toBe(false);
  });
});

describe("upload --help", () => {
  it("lists the --wait exit codes", () => {
    const upload = createProgram().commands.find((command) => command.name() === "upload");
    const help = upload?.helpInformation() ?? "";
    expect(help).toContain("--wait");
    expect(help).toContain("--timeout <duration>");
    let text = "";
    upload?.configureOutput({ writeOut: (s) => (text += s) });
    upload?.outputHelp();
    expect(text).toContain("Exit codes with --wait:");
    expect(text).toContain("6  --timeout reached");
  });
});
