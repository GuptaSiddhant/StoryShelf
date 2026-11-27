import { Command } from "commander";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDefaultCommand } from "./default.ts";
import { resetTokenFlagWarning } from "./token-flag.ts";
import { runUpload } from "./upload.ts";

let dir: string;
let savedExitCode: typeof process.exitCode;
let out: string;
let err: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-default-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  for (const name of ["GITHUB_ACTIONS", "GITLAB_CI", "VERCEL", "CI_COMMIT_SHA", "GITHUB_SHA"]) {
    vi.stubEnv(name, "");
  }
  resetTokenFlagWarning();
});

afterEach(() => {
  process.exitCode = savedExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** A project with a committed config and a built Storybook. */
const DEFAULT_CONFIG = { slug: "demo", url: "https://shelf.example.com" };

function writeProject(config: unknown = DEFAULT_CONFIG): void {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(join(dir, ".storybook", "storyshelf.json"), JSON.stringify(config));
  mkdirSync(join(dir, "storybook-static"), { recursive: true });
  writeFileSync(join(dir, "storybook-static", "index.json"), "{}");
}

/** The lines that say what would be uploaded and where each value came from. */
function resolved(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /Dry run|CI provider|sha:|branch:|message:|author/u.test(line));
}

/** A GitHub pull_request run whose merge commit differs from the PR head. */
function stubPullRequest(): void {
  const event = join(dir, "event.json");
  writeFileSync(event, JSON.stringify({ number: 9, pull_request: { head: { sha: "head-sha" } } }));
  vi.stubEnv("GITHUB_ACTIONS", "true");
  vi.stubEnv("GITHUB_EVENT_NAME", "pull_request");
  vi.stubEnv("GITHUB_EVENT_PATH", event);
  vi.stubEnv("GITHUB_SHA", "merge-sha");
  vi.stubEnv("GITHUB_REF_NAME", "9/merge");
  vi.stubEnv("GITHUB_HEAD_REF", "feature/x");
  vi.stubEnv("SHELF_TOKEN", "env-token");
}

describe("bare storyshelf", () => {
  it("resolves exactly what `storyshelf upload` resolves for the same environment and config", async () => {
    writeProject();
    stubPullRequest();
    const seam = { cwd: dir, dryRun: true, verbose: true };
    await runUpload(seam);
    const viaUpload = { out: resolved(out), err };
    out = "";
    err = "";
    resetTokenFlagWarning();
    await runDefaultCommand(new Command(), seam);
    expect(resolved(out)).toEqual(viaUpload.out);
    expect(err).toBe(viaUpload.err);
    expect(viaUpload.out.join("\n")).toContain("as head-sha on feature/x");
    expect(process.exitCode).toBeUndefined();
  });

  it("takes the PR head from the CI provider, not GITHUB_SHA", async () => {
    writeProject();
    stubPullRequest();
    await runDefaultCommand(new Command(), { cwd: dir, dryRun: true });
    expect(out).toContain("as head-sha on feature/x");
    expect(out).not.toContain("merge-sha");
  });

  it("needs no CI variables: local git or a synthesized identity is enough", async () => {
    writeProject();
    vi.stubEnv("SHELF_TOKEN", "env-token");
    await runDefaultCommand(new Command(), { cwd: dir, dryRun: true });
    expect(out).toContain("Dry run");
    expect(process.exitCode).toBeUndefined();
  });

  it("names the missing token, and exits 1 without printing the help", async () => {
    writeProject();
    vi.stubEnv("SHELF_TOKEN", "");
    await runDefaultCommand(new Command(), { cwd: dir, dryRun: true });
    expect(err).toContain("no token");
    expect(err).toContain("SHELF_TOKEN");
    expect(out).not.toContain("Usage");
    expect(process.exitCode).toBe(1);
  });

  it("names the missing url and slug the same way upload does", async () => {
    writeProject({ slug: "demo" });
    vi.stubEnv("SHELF_TOKEN", "env-token");
    vi.stubEnv("SHELF_URL", "");
    await runDefaultCommand(new Command(), { cwd: dir, dryRun: true });
    expect(err).toContain("no server URL");
    expect(err).toContain("SHELF_URL");
    await expect(runUpload({ cwd: dir, dryRun: true })).rejects.toThrow("no server URL");
  });

  it("prints the help and points at init when there is no config", async () => {
    const program = new Command("storyshelf");
    await runDefaultCommand(program, { cwd: dir });
    expect(err).toContain("storyshelf init");
    expect(process.exitCode).toBe(1);
  });

  it("reports a token key in the config as an error naming the key", async () => {
    writeProject({ slug: "demo", url: "https://shelf.example.com", token: "shelf_leaked" });
    await runDefaultCommand(new Command(), { cwd: dir, dryRun: true });
    expect(err).toContain('"token" key');
    expect(err).not.toContain("shelf_leaked");
    expect(process.exitCode).toBe(1);
  });
});
