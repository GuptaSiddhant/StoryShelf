import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAffected } from "./index.ts";

/**
 * Affected capture for the three places a Storybook can live: the repository root, a package of a
 * monorepo, and a package whose stories import a sibling workspace package (#502).
 */
let repo: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

function commit(message: string): string {
  git(["add", "."]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

/** Module ids as Vite writes them: relative to the Storybook project. */
const GRAPH = [
  { id: "./src/ui/kbd.stories.tsx", importedIds: ["./src/ui/kbd.tsx"] },
  { id: "./src/pages/login.stories.tsx", importedIds: ["./src/pages/login.tsx"] },
  { id: "./src/pages/login.tsx", importedIds: ["./src/ui/kbd.tsx"] },
  { id: "./src/ui/kbd.tsx", importedIds: ["./src/gen/types.ts"] },
  { id: "./src/ui/core.stories.tsx", importedIds: ["./src/ui/core-user.tsx"] },
  { id: "./src/ui/core-user.tsx", importedIds: ["../core/src/x.ts"] },
];

const STORIES = ["kbd", "login", "core"].map((name) => ({
  id: name,
  importPath: `./src/${name === "login" ? "pages" : "ui"}/${name}.stories.tsx`,
}));

/** A Storybook build for the project at `project` (`""` = the repository root). */
function writeStorybook(project: string, modules: unknown[] = GRAPH): void {
  const at = (file: string): string => join(project, "static", file);
  write(
    at("index.json"),
    JSON.stringify({ v: 5, entries: Object.fromEntries(STORIES.map((s) => [s.id, s])) }),
  );
  write(at("preview-stats.json"), JSON.stringify({ modules }));
  write(join(project, "src/ui/kbd.tsx"), "kbd");
  write("packages/core/src/x.ts", "x");
  write("README.md", "readme");
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "storyshelf-affected-layout-")));
  git(["-c", "init.defaultBranch=main", "init"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Commit the Storybook, change `file`, and ask which stories are affected. */
async function affectedBy(project: string, file: string, extra: { untraced?: string[] } = {}) {
  const base = commit("init");
  write(file, "changed");
  const head = commit("change");
  return await computeAffected({
    cwd: join(repo, project),
    buildDir: "static",
    baseSha: base,
    headSha: head,
    ...extra,
  });
}

describe("Storybook at the repository root", () => {
  it("affects the stories that import the changed file", async () => {
    writeStorybook("");
    const result = await affectedBy("", "src/ui/kbd.tsx");
    expect(result).toMatchObject({ fullReason: null, changedFiles: ["src/ui/kbd.tsx"] });
    expect(result.affectedImportPaths).toEqual([
      "src/pages/login.stories.tsx",
      "src/ui/kbd.stories.tsx",
    ]);
  });
});

describe("Storybook in a package of a monorepo", () => {
  const PROJECT = "packages/app";

  it("affects the stories that import a file changed inside the package", async () => {
    writeStorybook(PROJECT);
    const result = await affectedBy(PROJECT, "packages/app/src/ui/kbd.tsx");
    expect(result.fullReason).toBeNull();
    expect(result.changedFiles).toEqual(["packages/app/src/ui/kbd.tsx"]);
    // Story paths keep the project-relative form the server compares them in.
    expect(result.affectedImportPaths).toEqual([
      "src/pages/login.stories.tsx",
      "src/ui/kbd.stories.tsx",
    ]);
  });

  it("affects the importers of a file changed in a sibling workspace package", async () => {
    writeStorybook(PROJECT);
    const result = await affectedBy(PROJECT, "packages/core/src/x.ts");
    expect(result).toMatchObject({
      fullReason: null,
      affectedImportPaths: ["src/ui/core.stories.tsx"],
    });
  });

  it("sees a new, uncommitted file outside the package, which git lists relative to the root", async () => {
    writeStorybook(PROJECT, [
      ...GRAPH,
      { id: "./src/ui/core-user.tsx", importedIds: ["../core/src/fresh.ts"] },
    ]);
    const head = commit("init");
    write("packages/core/src/fresh.ts", "new and untracked");
    const result = await computeAffected({
      cwd: join(repo, PROJECT),
      buildDir: "static",
      baseSha: head,
      headSha: head,
    });
    expect(result.changedFiles).toEqual(["packages/core/src/fresh.ts"]);
    expect(result.affectedImportPaths).toEqual(["src/ui/core.stories.tsx"]);
  });

  it("matches a bundler that writes absolute module ids", async () => {
    const absolute = (rel: string): string => join(repo, PROJECT, rel);
    writeStorybook(PROJECT, [
      { id: absolute("src/ui/kbd.stories.tsx"), importedIds: [absolute("src/ui/kbd.tsx")] },
    ]);
    const result = await affectedBy(PROJECT, "packages/app/src/ui/kbd.tsx");
    expect(result).toMatchObject({
      fullReason: null,
      affectedImportPaths: ["src/ui/kbd.stories.tsx"],
    });
  });

  it("does not take a same-named file in another package for the changed one", async () => {
    writeStorybook(PROJECT);
    write("packages/other/src/ui/kbd.tsx", "other");
    const result = await affectedBy(PROJECT, "packages/other/src/ui/kbd.tsx");
    expect(result).toMatchObject({ fullReason: null, affectedImportPaths: [] });
  });
});

describe("a change outside every graph", () => {
  it("affects nothing and stays selective, so docs-only changes stay cheap", async () => {
    writeStorybook("packages/app");
    const result = await affectedBy("packages/app", "README.md");
    expect(result).toMatchObject({ fullReason: null, affectedImportPaths: [] });
  });
});

describe("untraced globs", () => {
  const TYPES = "packages/app/src/gen/types.ts";

  it("trace the file when nothing excludes it", async () => {
    writeStorybook("packages/app");
    const result = await affectedBy("packages/app", TYPES);
    expect(result.affectedImportPaths).toEqual([
      "src/pages/login.stories.tsx",
      "src/ui/kbd.stories.tsx",
    ]);
  });

  it("match the project-relative form of a changed file in a package", async () => {
    writeStorybook("packages/app");
    const result = await affectedBy("packages/app", TYPES, { untraced: ["src/gen/**"] });
    expect(result).toMatchObject({ fullReason: null, affectedImportPaths: [] });
  });

  it("still match the repo-relative form, so existing configs keep working", async () => {
    writeStorybook("packages/app");
    const result = await affectedBy("packages/app", TYPES, {
      untraced: ["packages/app/src/gen/**"],
    });
    expect(result).toMatchObject({ fullReason: null, affectedImportPaths: [] });
  });
});

describe("global files", () => {
  it("force a full render wherever the Storybook lives", async () => {
    writeStorybook("packages/app");
    write("packages/app/.storybook/preview.ts", "preview");
    const result = await affectedBy("packages/app", "packages/app/.storybook/preview.ts");
    expect(result).toMatchObject({ affectedImportPaths: null, fullReason: "global-file-changed" });
  });
});
