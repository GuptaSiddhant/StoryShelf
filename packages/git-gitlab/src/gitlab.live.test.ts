/**
 * Live GitLab test — strictly real API, no mocked fetch.
 *
 * Gated on `LIVE_CLOUD=1` plus `LIVE_GL_TOKEN`, so hermetic `turbo test`
 * never touches gitlab.com (or a self-managed host). Posts `pending` →
 * `success` statuses under a unique context per run
 * (`storyshelf/live-<run-id>`) on a dedicated test SHA. Commit statuses are
 * immutable and cannot be deleted — point `LIVE_GL_SHA` at a throwaway
 * commit/branch reserved for live tests.
 *
 * Required env when live:
 * - `LIVE_GL_TOKEN` — token with `api` scope on the test project
 * - `LIVE_GL_OWNER` / `LIVE_GL_REPO` — test project coordinates
 * - `LIVE_GL_SHA` — commit SHA in the test project to status
 * - `LIVE_GL_HOST` — optional self-managed host (defaults to gitlab.com).
 */
import { describe, expect, it } from "vitest";
import { gitLabHost } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["LIVE_GL_TOKEN"] !== undefined;

function liveToken(): string {
  const token = process.env["LIVE_GL_TOKEN"];
  if (!token) {
    throw new Error("Live GitLab test requires LIVE_GL_TOKEN.");
  }
  return token;
}

function liveOwner(): string {
  const owner = process.env["LIVE_GL_OWNER"];
  if (!owner) {
    throw new Error("Live GitLab test requires LIVE_GL_OWNER.");
  }
  return owner;
}

function liveRepo(): string {
  const repo = process.env["LIVE_GL_REPO"];
  if (!repo) {
    throw new Error("Live GitLab test requires LIVE_GL_REPO.");
  }
  return repo;
}

function liveSha(): string {
  const sha = process.env["LIVE_GL_SHA"];
  if (!sha) {
    throw new Error("Live GitLab test requires LIVE_GL_SHA.");
  }
  return sha;
}

function liveConfig(): { owner: string; repo: string; host?: string } {
  const host = process.env["LIVE_GL_HOST"];
  return host
    ? { owner: liveOwner(), repo: liveRepo(), host }
    : { owner: liveOwner(), repo: liveRepo() };
}

function runContext(): string {
  return `storyshelf/live-${process.env["GITHUB_RUN_ID"] ?? "local"}`;
}

describe.skipIf(!LIVE)("gitlab live (real GitLab API, gated on LIVE_CLOUD=1)", () => {
  it("posts pending then success statuses on the test SHA", async () => {
    const adapter = gitLabHost.create({ config: liveConfig(), token: liveToken() });
    const context = runContext();
    const gitSha = liveSha();

    await adapter.setStatus({
      context,
      gitSha,
      status: "pending",
      url: "https://example.com/live",
    });
    await adapter.setStatus({
      context,
      gitSha,
      status: "success",
      url: "https://example.com/live",
    });

    expect(adapter.metadata.kind).toBe("gitlab");
  }, 60000);
});
