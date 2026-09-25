import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles, isShallowRepo } from "./git.ts";

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

  it("throws for unknown revisions", () => {
    expect(() => changedFiles(dir, "deadbee", "deadbee")).toThrow();
  });
});
