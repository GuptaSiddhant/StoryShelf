import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CiIdentity } from "./ci-env.ts";
import { gitCommitInfo } from "./git-commit.ts";
import {
  describeIdentity,
  isShallowClone,
  resolveIdentity,
  resolveUploadIdentity,
  type GitIdentityProbe,
} from "./identity.ts";

const gitProbe: GitIdentityProbe = {
  headSha: () => "git-sha",
  branchName: () => "git-branch",
  commitInfo: () => ({
    message: "From git\n\nbody",
    authorName: "Git Ada",
    authorEmail: "ada@git",
  }),
};
const nullProbe: GitIdentityProbe = { headSha: () => null, branchName: () => null };

const ci: CiIdentity = {
  provider: "GitHub Actions",
  sha: { value: "ci-sha", source: "GitHub pull_request: GITHUB_EVENT_PATH pull_request.head.sha" },
  branch: { value: "feature/x", source: "GitHub pull_request: GITHUB_HEAD_REF" },
  message: { value: "From CI", source: "Provider: MSG" },
  authorName: { value: "CI Ada", source: "Provider: NAME" },
  pullRequest: { value: "123", source: "GitHub pull_request: GITHUB_EVENT_PATH number" },
};

describe("resolveUploadIdentity", () => {
  it("lets flags win over CI, git and synthesis, per field", () => {
    const identity = resolveUploadIdentity(
      "/x",
      { sha: "flag-sha", message: "flag message" },
      { probe: gitProbe, ci },
    );
    expect(identity).toMatchObject({
      sha: "flag-sha",
      branch: "feature/x",
      message: "flag message",
      sources: { sha: "flag --sha", branch: "GitHub pull_request: GITHUB_HEAD_REF" },
    });
  });

  it("takes the PR head commit and branch from CI, not git", () => {
    const identity = resolveUploadIdentity("/x", {}, { probe: gitProbe, ci });
    expect(identity.sha).toBe("ci-sha");
    expect(identity.branch).toBe("feature/x");
    expect(identity.synthesized).toBe(false);
    expect(identity.pullRequest?.value).toBe("123");
  });

  it("falls to local git, then to a synthesized identity", () => {
    expect(resolveUploadIdentity("/x", {}, { probe: gitProbe, ci: null })).toMatchObject({
      sha: "git-sha",
      branch: "git-branch",
      sources: { sha: "local git (HEAD)", branch: "local git (current branch)" },
    });
    const synthesized = resolveUploadIdentity("/x", {}, { probe: nullProbe, ci: null });
    expect(synthesized.sha.startsWith("local-")).toBe(true);
    expect(synthesized.branch).toBe("local");
    expect(synthesized.sources).toEqual({ sha: "synthesized", branch: "synthesized" });
    expect(synthesized.message).toBeUndefined();
  });

  it("a probe that returns a sha and branch is not synthesized", () => {
    expect(resolveUploadIdentity("/x", {}, { probe: gitProbe, ci: null }).synthesized).toBe(false);
  });

  it("no git, no flags and no CI is synthesized", () => {
    expect(resolveUploadIdentity("/x", {}, { probe: nullProbe, ci: null }).synthesized).toBe(true);
  });

  it("flags alone are not synthesized", () => {
    const identity = resolveUploadIdentity(
      "/x",
      { sha: "flag-sha", branch: "flag-branch" },
      { probe: nullProbe, ci: null },
    );
    expect(identity).toMatchObject({ sha: "flag-sha", branch: "flag-branch", synthesized: false });
  });

  it("takes message and author from git first, then the provider's variables", () => {
    const withGit = resolveUploadIdentity("/x", {}, { probe: gitProbe, ci });
    expect(withGit).toMatchObject({
      message: "From git\n\nbody",
      authorName: "Git Ada",
      authorEmail: "ada@git",
    });
    expect(withGit.sources["message"]).toBe("local git (git log -1)");
    const withoutGit = resolveUploadIdentity(
      "/x",
      {},
      { probe: { ...gitProbe, commitInfo: () => null }, ci },
    );
    expect(withoutGit).toMatchObject({ message: "From CI", authorName: "CI Ada" });
    expect(withoutGit.sources["message"]).toBe("Provider: MSG");
  });

  it("does not look a synthesized sha up in git", () => {
    let asked = false;
    resolveUploadIdentity(
      "/x",
      {},
      {
        probe: {
          ...nullProbe,
          commitInfo: () => {
            asked = true;
            return null;
          },
        },
        ci: null,
      },
    );
    expect(asked).toBe(false);
  });

  it("carries the provider's warnings", () => {
    const warned = { provider: "GitHub Actions", warnings: ["payload unreadable"] };
    expect(resolveUploadIdentity("/x", {}, { probe: nullProbe, ci: warned }).warnings).toEqual([
      "payload unreadable",
    ]);
  });
});

describe("a push keeps today's identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["GitHub", { GITHUB_SHA: "tip", GITHUB_REF_NAME: "main", GITHUB_EVENT_NAME: "push" }],
    ["Vercel", { VERCEL_GIT_COMMIT_SHA: "tip", VERCEL_GIT_COMMIT_REF: "main" }],
    ["GitLab", { CI_COMMIT_SHA: "tip", CI_COMMIT_REF_NAME: "main" }],
  ])("%s: the same sha and branch the old env lookup returned", (_name, env) => {
    for (const name of CLEARED) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    expect(resolveIdentity("/x", {}, gitProbe)).toEqual({
      sha: "tip",
      branch: "main",
      synthesized: false,
    });
  });
});

const CLEARED = [
  "GITHUB_ACTIONS",
  "GITHUB_SHA",
  "GITHUB_REF_NAME",
  "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH",
  "VERCEL",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "GITLAB_CI",
  "CI_COMMIT_SHA",
  "CI_COMMIT_REF_NAME",
];

describe("describeIdentity", () => {
  it("lists each value with its source", () => {
    const lines = describeIdentity(resolveUploadIdentity("/x", {}, { probe: gitProbe, ci }));
    expect(lines).toContain("CI provider: GitHub Actions");
    expect(lines).toContain("branch: feature/x (GitHub pull_request: GITHUB_HEAD_REF)");
    expect(lines).toContain("message: From git (local git (git log -1))");
    expect(lines).toContain("pull request: 123 (GitHub pull_request: GITHUB_EVENT_PATH number)");
  });

  it("never includes a token", () => {
    const text = describeIdentity(resolveUploadIdentity("/x", {}, { probe: gitProbe, ci })).join(
      "\n",
    );
    expect(text.toLowerCase()).not.toContain("token");
  });
});

describe("git on disk", () => {
  let dir: string;
  const git = (args: string[], cwd = dir): string =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "storyshelf-identity-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.name", "Test Author"]);
    git(["config", "user.email", "author@example.com"]);
    git(["commit", "-q", "--allow-empty", "-m", "First line", "-m", "Second paragraph"]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads message and author of a commit", () => {
    const info = gitCommitInfo(dir, git(["rev-parse", "HEAD"]));
    expect(info).toEqual({
      message: "First line\n\nSecond paragraph",
      authorName: "Test Author",
      authorEmail: "author@example.com",
    });
  });

  it("is null for a commit the checkout does not have, and outside a repository", () => {
    expect(gitCommitInfo(dir, "0".repeat(40))).toBeNull();
    const outside = mkdtempSync(join(tmpdir(), "storyshelf-nogit-"));
    try {
      expect(gitCommitInfo(outside, "HEAD")).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("resolves message and author from the CI sha through real git", () => {
    const sha = git(["rev-parse", "HEAD"]);
    const identity = resolveUploadIdentity(
      dir,
      {},
      { ci: { provider: "X", sha: { value: sha, source: "X: SHA" } } },
    );
    expect(identity).toMatchObject({
      sha,
      authorName: "Test Author",
      message: expect.stringContaining("First line"),
    });
  });

  it("detects a shallow clone and a full one", () => {
    expect(isShallowClone(dir)).toBe(false);
    git(["commit", "-q", "--allow-empty", "-m", "Second"]);
    const clone = join(dir, "..", `${dir.split("/").pop()}-shallow`);
    mkdirSync(clone);
    git(["clone", "-q", "--depth", "1", `file://${dir}`, clone], tmpdir());
    try {
      expect(isShallowClone(clone)).toBe(true);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
