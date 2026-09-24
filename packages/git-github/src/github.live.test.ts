/**
 * Live GitHub test — strictly real API, no stubs.
 *
 * Gated on `LIVE_CLOUD=1` plus `LIVE_GH_TOKEN`, so hermetic `turbo test`
 * never touches api.github.com. Posts `pending` → `success` statuses under
 * a unique context per run (`storyshelf/live-<run-id>`) on a dedicated test
 * SHA. Commit statuses are immutable and cannot be deleted — point
 * `LIVE_GH_SHA` at a throwaway commit/branch reserved for live tests.
 *
 * Required env when live:
 * - `LIVE_GH_TOKEN` — PAT with `repo:status` on the test repo
 * - `LIVE_GH_OWNER` / `LIVE_GH_REPO` — test repo coordinates
 * - `LIVE_GH_SHA` — commit SHA on the test repo to status.
 */
import { describe, expect, it } from "vitest";
import { gitHubHost } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["LIVE_GH_TOKEN"] !== undefined;

function liveToken(): string {
  const token = process.env["LIVE_GH_TOKEN"];
  if (!token) {
    throw new Error("Live GitHub test requires LIVE_GH_TOKEN.");
  }
  return token;
}

function liveOwner(): string {
  const owner = process.env["LIVE_GH_OWNER"];
  if (!owner) {
    throw new Error("Live GitHub test requires LIVE_GH_OWNER.");
  }
  return owner;
}

function liveRepo(): string {
  const repo = process.env["LIVE_GH_REPO"];
  if (!repo) {
    throw new Error("Live GitHub test requires LIVE_GH_REPO.");
  }
  return repo;
}

function liveSha(): string {
  const sha = process.env["LIVE_GH_SHA"];
  if (!sha) {
    throw new Error("Live GitHub test requires LIVE_GH_SHA.");
  }
  return sha;
}

function runContext(): string {
  return `storyshelf/live-${process.env["GITHUB_RUN_ID"] ?? "local"}`;
}

describe.skipIf(!LIVE)("github live (real api.github.com, gated on LIVE_CLOUD=1)", () => {
  it("posts pending then success statuses on the test SHA", async () => {
    const adapter = gitHubHost.create({
      config: { owner: liveOwner(), repo: liveRepo() },
      token: liveToken(),
    });
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

    expect(adapter.metadata.kind).toBe("github");
  }, 60000);
});
