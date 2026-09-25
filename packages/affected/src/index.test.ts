import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAffected } from "./index.ts";

let dir: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function writeBuild(): void {
  mkdirSync(join(dir, "static"), { recursive: true });
  writeFileSync(
    join(dir, "static", "index.json"),
    JSON.stringify({
      v: 5,
      entries: {
        a: { id: "a", importPath: "src/a.stories.tsx" },
        b: { id: "b", importPath: "src/b.stories.tsx" },
      },
    }),
  );
  writeFileSync(
    join(dir, "static", "preview-stats.json"),
    JSON.stringify({
      modules: [
        { id: "src/a.stories.tsx", importedIds: ["src/a.tsx"] },
        { id: "src/b.stories.tsx", importedIds: ["src/b.tsx"] },
      ],
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-affected-index-"));
  writeBuild();
  git(["-c", "init.defaultBranch=main", "init"]);
  git(["add", "."]);
  git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "init"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("computeAffected", () => {
  it("selects stories downstream of a change", async () => {
    const base = git(["rev-parse", "HEAD"]);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.tsx"), "changed");
    git(["add", "src/a.tsx"]);
    git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "x"]);
    const head = git(["rev-parse", "HEAD"]);
    const result = await computeAffected({
      cwd: dir,
      buildDir: "static",
      baseSha: base,
      headSha: head,
    });
    expect(result.fullReason).toBeNull();
    expect(result.affectedImportPaths).toEqual(["src/a.stories.tsx"]);
    expect(result.baselineSha).toBe(base);
  });

  it("falls back to full render without a story index", async () => {
    const base = git(["rev-parse", "HEAD"]);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "b.tsx"), "changed");
    git(["add", "src/b.tsx"]);
    git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "x"]);
    const head = git(["rev-parse", "HEAD"]);
    const result = await computeAffected({
      cwd: dir,
      buildDir: "missing",
      baseSha: base,
      headSha: head,
    });
    expect(result.affectedImportPaths).toBeNull();
    expect(result.fullReason).toBe("story-index-unreadable");
  });

  it("never throws outside a repository", async () => {
    const result = await computeAffected({
      cwd: tmpdir(),
      buildDir: "static",
      baseSha: "a",
      headSha: "b",
    });
    expect(result.affectedImportPaths).toBeNull();
    expect(result.fullReason).toBe("shallow-clone");
  });
});
