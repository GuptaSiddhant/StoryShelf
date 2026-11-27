import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCi, readJsonFile, type CiEnv } from "./ci-env.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-ci-env-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write an event payload fixture and return the env of a GitHub Actions run for it. */
function githubRun(event: string, payload: unknown, extra: CiEnv = {}): CiEnv {
  const path = join(dir, "event.json");
  writeFileSync(path, typeof payload === "string" ? payload : JSON.stringify(payload));
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: event,
    GITHUB_EVENT_PATH: path,
    GITHUB_SHA: "merge-sha",
    GITHUB_REF_NAME: "123/merge",
    ...extra,
  };
}

function detect(env: CiEnv): ReturnType<typeof detectCi> {
  return detectCi({ env, readJson: readJsonFile });
}

describe("GitHub Actions", () => {
  it("uses the PR head commit and branch on pull_request, not the merge commit", () => {
    const ci = detect(
      githubRun(
        "pull_request",
        { number: 123, pull_request: { number: 123, head: { sha: "head-sha", ref: "feature/x" } } },
        { GITHUB_HEAD_REF: "feature/x", GITHUB_BASE_REF: "main" },
      ),
    );
    expect(ci?.provider).toBe("GitHub Actions");
    expect(ci?.sha).toEqual({
      value: "head-sha",
      source: "GitHub pull_request: GITHUB_EVENT_PATH pull_request.head.sha",
    });
    expect(ci?.branch).toEqual({
      value: "feature/x",
      source: "GitHub pull_request: GITHUB_HEAD_REF",
    });
    expect(ci?.pullRequest?.value).toBe("123");
    expect(ci?.baseBranch?.value).toBe("main");
    expect(ci?.warnings).toBeUndefined();
  });

  it("treats pull_request_target like pull_request", () => {
    const ci = detect(
      githubRun(
        "pull_request_target",
        { number: 7, pull_request: { head: { sha: "fork-head", ref: "fork-branch" } } },
        { GITHUB_HEAD_REF: "fork-branch", GITHUB_BASE_REF: "main", GITHUB_SHA: "default-tip" },
      ),
    );
    expect(ci?.sha?.value).toBe("fork-head");
    expect(ci?.branch?.value).toBe("fork-branch");
    expect(ci?.pullRequest?.value).toBe("7");
  });

  it("falls back to the payload's head ref when GITHUB_HEAD_REF is unset", () => {
    const ci = detect(
      githubRun("pull_request", { pull_request: { head: { sha: "s", ref: "from-payload" } } }),
    );
    expect(ci?.branch?.value).toBe("from-payload");
  });

  it("never reads the merge commit when the payload is missing, and warns", () => {
    for (const payload of ["", "{not json", "[]", "null", { pull_request: {} }]) {
      const ci = detect(githubRun("pull_request", payload, { GITHUB_HEAD_REF: "feature/x" }));
      expect(ci?.sha).toBeUndefined();
      expect(ci?.branch?.value).toBe("feature/x");
      expect(ci?.warnings?.[0]).toContain("GITHUB_EVENT_PATH");
    }
  });

  it("does not throw when GITHUB_EVENT_PATH is unset or names no file", () => {
    const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request" };
    expect(detect(env)?.sha).toBeUndefined();
    expect(detect({ ...env, GITHUB_EVENT_PATH: join(dir, "missing.json") })?.sha).toBeUndefined();
  });

  it("keeps today's push behaviour: GITHUB_SHA and GITHUB_REF_NAME", () => {
    const ci = detect(
      githubRun(
        "push",
        { head_commit: { id: "ignored" } },
        { GITHUB_SHA: "tip", GITHUB_REF_NAME: "main" },
      ),
    );
    expect(ci?.sha).toEqual({ value: "tip", source: "GitHub push: GITHUB_SHA" });
    expect(ci?.branch).toEqual({ value: "main", source: "GitHub push: GITHUB_REF_NAME" });
  });

  it("reads push from the variables alone, with no event file", () => {
    const ci = detect({ GITHUB_SHA: "tip", GITHUB_REF_NAME: "main" });
    expect(ci?.sha?.value).toBe("tip");
    expect(ci?.branch?.value).toBe("main");
  });

  it("labels a tag push and uses the tag name as the branch", () => {
    const ci = detect(
      githubRun(
        "push",
        {},
        { GITHUB_SHA: "tag-sha", GITHUB_REF_NAME: "v1.2.0", GITHUB_REF_TYPE: "tag" },
      ),
    );
    expect(ci?.sha?.value).toBe("tag-sha");
    expect(ci?.branch).toEqual({ value: "v1.2.0", source: "GitHub push (tag): GITHUB_REF_NAME" });
  });

  it("uses the merge queue's head commit and base branch on merge_group", () => {
    const ci = detect(
      githubRun(
        "merge_group",
        { merge_group: { head_sha: "queue-head", base_ref: "refs/heads/release/1.x" } },
        { GITHUB_SHA: "group-sha", GITHUB_REF_NAME: "gh-readonly-queue/main/pr-1-abc" },
      ),
    );
    expect(ci?.sha).toEqual({
      value: "queue-head",
      source: "GitHub merge_group: GITHUB_EVENT_PATH merge_group.head_sha",
    });
    expect(ci?.branch?.value).toBe("release/1.x");
    expect(ci?.baseBranch?.value).toBe("release/1.x");
  });

  it("falls back to GITHUB_SHA (the merge group's SHA) and no branch on merge_group without a payload", () => {
    const ci = detect(githubRun("merge_group", "", { GITHUB_SHA: "group-sha" }));
    expect(ci?.sha?.value).toBe("group-sha");
    expect(ci?.branch).toBeUndefined();
  });
});

describe("other providers", () => {
  it("GitLab: a branch pipeline uses CI_COMMIT_SHA and CI_COMMIT_REF_NAME", () => {
    const ci = detect({
      GITLAB_CI: "true",
      CI_COMMIT_SHA: "a1",
      CI_COMMIT_REF_NAME: "main",
      CI_COMMIT_MESSAGE: "Fix it\n",
      CI_COMMIT_AUTHOR: "Ada Lovelace <ada@example.com>",
    });
    expect(ci).toMatchObject({
      provider: "GitLab CI",
      sha: { value: "a1" },
      branch: { value: "main" },
      message: { value: "Fix it\n" },
      authorName: { value: "Ada Lovelace" },
      authorEmail: { value: "ada@example.com" },
    });
  });

  it("GitLab: a merge request pipeline uses the source branch and its head SHA when set", () => {
    const env = {
      GITLAB_CI: "true",
      CI_COMMIT_SHA: "merge-result",
      CI_COMMIT_REF_NAME: "refs/merge-requests/4/head",
      CI_MERGE_REQUEST_IID: "4",
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feature/y",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
    };
    expect(detect({ ...env, CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: "mr-head" })).toMatchObject({
      sha: { value: "mr-head" },
      branch: { value: "feature/y" },
      pullRequest: { value: "4" },
      baseBranch: { value: "main" },
    });
    expect(detect(env)?.sha?.value).toBe("merge-result");
  });

  it("Vercel", () => {
    expect(
      detect({
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: "v1",
        VERCEL_GIT_COMMIT_REF: "preview",
        VERCEL_GIT_COMMIT_MESSAGE: "Tweak",
        VERCEL_GIT_COMMIT_AUTHOR_NAME: "Grace",
        VERCEL_GIT_PULL_REQUEST_ID: "23",
      }),
    ).toMatchObject({
      provider: "Vercel",
      sha: { value: "v1" },
      branch: { value: "preview" },
      message: { value: "Tweak" },
      authorName: { value: "Grace" },
      pullRequest: { value: "23" },
    });
  });

  it("Netlify: COMMIT_REF and HEAD, and the review id only for a pull request", () => {
    const env = { NETLIFY: "true", COMMIT_REF: "n1", HEAD: "feature/n", REVIEW_ID: "12" };
    expect(detect(env)).toMatchObject({ sha: { value: "n1" }, branch: { value: "feature/n" } });
    expect(detect(env)?.pullRequest).toBeUndefined();
    expect(detect({ ...env, PULL_REQUEST: "true" })?.pullRequest?.value).toBe("12");
  });

  it("CircleCI: a branch, else the tag", () => {
    const env = { CIRCLECI: "true", CIRCLE_SHA1: "c1", CIRCLE_BRANCH: "dev" };
    expect(detect(env)).toMatchObject({ sha: { value: "c1" }, branch: { value: "dev" } });
    expect(detect({ CIRCLECI: "true", CIRCLE_SHA1: "c1", CIRCLE_TAG: "v2" })?.branch?.value).toBe(
      "v2",
    );
  });

  it("Buildkite: ignores the symbolic HEAD commit and a false pull request", () => {
    const env = {
      BUILDKITE: "true",
      BUILDKITE_COMMIT: "HEAD",
      BUILDKITE_BRANCH: "main",
      BUILDKITE_PULL_REQUEST: "false",
      BUILDKITE_MESSAGE: "Ship",
      BUILDKITE_BUILD_AUTHOR: "Linus",
      BUILDKITE_BUILD_AUTHOR_EMAIL: "l@example.com",
    };
    expect(detect(env)?.sha).toBeUndefined();
    expect(detect(env)?.pullRequest).toBeUndefined();
    expect(detect(env)).toMatchObject({ branch: { value: "main" }, message: { value: "Ship" } });
    expect(detect({ ...env, BUILDKITE_COMMIT: "b1", BUILDKITE_PULL_REQUEST: "9" })).toMatchObject({
      sha: { value: "b1" },
      pullRequest: { value: "9" },
    });
  });

  it("Bitbucket Pipelines", () => {
    expect(
      detect({
        BITBUCKET_BUILD_NUMBER: "5",
        BITBUCKET_COMMIT: "bb1",
        BITBUCKET_BRANCH: "feature/b",
        BITBUCKET_PR_ID: "8",
        BITBUCKET_PR_DESTINATION_BRANCH: "main",
      }),
    ).toMatchObject({
      sha: { value: "bb1" },
      branch: { value: "feature/b" },
      pullRequest: { value: "8" },
      baseBranch: { value: "main" },
    });
  });

  it("Azure Pipelines: a pull request uses the source commit and branch", () => {
    expect(
      detect({
        TF_BUILD: "True",
        BUILD_SOURCEVERSION: "merge",
        BUILD_SOURCEBRANCH: "refs/pull/3/merge",
        SYSTEM_PULLREQUEST_SOURCECOMMITID: "az-head",
        SYSTEM_PULLREQUEST_SOURCEBRANCH: "refs/heads/users/ada/feature",
        SYSTEM_PULLREQUEST_TARGETBRANCH: "refs/heads/main",
        SYSTEM_PULLREQUEST_PULLREQUESTNUMBER: "3",
      }),
    ).toMatchObject({
      sha: { value: "az-head" },
      branch: { value: "users/ada/feature" },
      baseBranch: { value: "main" },
      pullRequest: { value: "3" },
    });
  });

  it("Azure Pipelines: a branch build strips refs/heads/, a tag build refs/tags/, a merge ref gives nothing", () => {
    const base = { TF_BUILD: "True", BUILD_SOURCEVERSION: "az1" };
    expect(detect({ ...base, BUILD_SOURCEBRANCH: "refs/heads/feature/z" })).toMatchObject({
      sha: { value: "az1" },
      branch: { value: "feature/z" },
    });
    expect(detect({ ...base, BUILD_SOURCEBRANCH: "refs/tags/v3" })?.branch?.value).toBe("v3");
    const merge = detect({ ...base, BUILD_SOURCEBRANCH: "refs/pull/1/merge" });
    expect(merge?.sha).toBeUndefined();
    expect(merge?.branch).toBeUndefined();
  });

  it("Jenkins: the git plugin's commit and branch, and no branch for a change request", () => {
    const env = {
      JENKINS_URL: "https://ci.example.com/",
      GIT_COMMIT: "j1",
      GIT_LOCAL_BRANCH: "dev",
    };
    expect(detect(env)).toMatchObject({ sha: { value: "j1" }, branch: { value: "dev" } });
    const pr = detect({ ...env, BRANCH_NAME: "PR-12", CHANGE_ID: "12" });
    expect(pr?.branch).toBeUndefined();
    expect(pr?.pullRequest?.value).toBe("12");
  });

  it("returns null outside CI and for a bare CI=true", () => {
    expect(detect({})).toBeNull();
    expect(detect({ CI: "true", GIT_COMMIT_LIKE: "x" })).toBeNull();
  });

  it("takes only the first detected provider's variables", () => {
    const ci = detect({
      GITHUB_SHA: "gh",
      GITHUB_REF_NAME: "main",
      CI_COMMIT_SHA: "gl",
      CI_COMMIT_REF_NAME: "other",
    });
    expect(ci?.provider).toBe("GitHub Actions");
    expect(ci?.sha?.value).toBe("gh");
  });

  it("treats empty variables as unset", () => {
    expect(
      detect({ GITHUB_ACTIONS: "true", GITHUB_SHA: "", GITHUB_REF_NAME: "" })?.sha,
    ).toBeUndefined();
  });
});
