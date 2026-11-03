import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The repository root git reports is the one thing a test cannot normally get wrong.
const reported = vi.hoisted(() => ({ root: undefined as string | null | undefined }));
vi.mock("./git.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./git.ts")>();
  return {
    ...real,
    gitRepoRoot: (cwd: string) =>
      reported.root === undefined ? real.gitRepoRoot(cwd) : reported.root,
  };
});

const { computeAffected } = await import("./index.ts");

let project: string;
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), "storyshelf-affected-base-")));
  reported.root = undefined;
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("computeAffected when the paths cannot be anchored", () => {
  it.each([
    ["git reports no repository root", null],
    ["the project is outside the repository root git reports", join(tmpdir(), "elsewhere")],
  ])("renders everything with path-base-unknown when %s", async (_name, root) => {
    reported.root = root;
    // A checkout that otherwise diffs fine: only the anchoring fails.
    const { execFileSync } = await import("node:child_process");
    const git = (args: string[]) => execFileSync("git", args, { cwd: project, encoding: "utf8" });
    git(["-c", "init.defaultBranch=main", "init"]);
    git([
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "i",
    ]);
    const head = git(["rev-parse", "HEAD"]).trim();
    const result = await computeAffected({
      cwd: project,
      buildDir: "static",
      baseSha: head,
      headSha: head,
    });
    expect(result).toMatchObject({ affectedImportPaths: null, fullReason: "path-base-unknown" });
  });
});
