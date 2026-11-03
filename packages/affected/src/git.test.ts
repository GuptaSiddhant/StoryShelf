import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  gitBranchName,
  gitHeadSha,
  gitRepoRoot,
  gitRepoStatus,
  isShallowRepo,
  LOCAL_BRANCH,
  LOCAL_SHA_PREFIX,
  localSha,
} from "./git.ts";

let dir: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function commitFile(name: string, content: string, message: string): void {
  writeFileSync(join(dir, name), content);
  git(["add", name]);
  git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", message]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-affected-git-"));
  git(["-c", "init.defaultBranch=main", "init"]);
  git([
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=test",
    "commit",
    "--allow-empty",
    "-m",
    "init",
  ]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isShallowRepo", () => {
  it("is false for a normal checkout", () => {
    expect(isShallowRepo(dir)).toBe(false);
  });

  it("is true outside a repository", () => {
    expect(isShallowRepo(tmpdir())).toBe(true);
  });
});

describe("changedFiles", () => {
  it("lists committed changes between revisions", () => {
    const base = git(["rev-parse", "HEAD"]);
    commitFile("a.ts", "a", "change a");
    const head = git(["rev-parse", "HEAD"]);
    expect(changedFiles(dir, base, head)).toEqual(["a.ts"]);
  });

  it("includes staged working-tree files", () => {
    const base = git(["rev-parse", "HEAD"]);
    writeFileSync(join(dir, "new.ts"), "new");
    git(["add", "new.ts"]);
    expect(changedFiles(dir, base, base)).toEqual(["new.ts"]);
  });

  it("lists every path relative to the repository root, even when run from a package", () => {
    const base = git(["rev-parse", "HEAD"]);
    mkdirSync(join(dir, "packages/app"), { recursive: true });
    mkdirSync(join(dir, "packages/core"), { recursive: true });
    writeFileSync(join(dir, "packages/app/inside.ts"), "new");
    writeFileSync(join(dir, "packages/core/outside.ts"), "new");
    writeFileSync(join(dir, "root.ts"), "new");
    expect(changedFiles(join(dir, "packages/app"), base, base)).toEqual([
      "packages/app/inside.ts",
      "packages/core/outside.ts",
      "root.ts",
    ]);
  });

  it("throws for unknown revisions", () => {
    expect(() => changedFiles(dir, "deadbee", "deadbee")).toThrow();
  });
});

describe("gitRepoRoot", () => {
  it("is the repository root from the root and from a package of it", () => {
    mkdirSync(join(dir, "packages/app"), { recursive: true });
    expect(gitRepoRoot(dir)).toBe(realpathSync(dir));
    expect(gitRepoRoot(join(dir, "packages/app"))).toBe(realpathSync(dir));
  });

  it("is null outside a repository", () => {
    expect(gitRepoRoot(tmpdir())).toBeNull();
  });
});

describe("gitHeadSha", () => {
  it("returns HEAD in a repository", () => {
    expect(gitHeadSha(dir)).toBe(git(["rev-parse", "HEAD"]));
  });

  it("returns null outside a repository", () => {
    expect(gitHeadSha(tmpdir())).toBeNull();
  });
});

describe("gitBranchName", () => {
  it("returns the current branch", () => {
    expect(gitBranchName(dir)).toBe("main");
  });

  it("returns null outside a repository", () => {
    expect(gitBranchName(tmpdir())).toBeNull();
  });

  it("returns null on a detached HEAD", () => {
    commitFile("a.ts", "a", "change a");
    git(["checkout", "--detach", "HEAD"]);
    expect(gitBranchName(dir)).toBeNull();
  });
});

describe("localSha", () => {
  it("generates unique prefixed identities", () => {
    const first = localSha();
    const second = localSha();
    expect(first.startsWith(LOCAL_SHA_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(LOCAL_BRANCH).toBe("local");
  });
});

describe("gitRepoStatus", () => {
  it("reports ok for a normal checkout", () => {
    expect(gitRepoStatus(dir)).toBe("ok");
  });

  it("reports no-git outside a repository", () => {
    expect(gitRepoStatus(tmpdir())).toBe("no-git");
  });
});
