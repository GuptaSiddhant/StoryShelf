import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  keyOfChangedFile,
  keyOfModuleId,
  keyOfStoryFile,
  pathBase,
  projectRelative,
  type PathBase,
} from "./paths.ts";

const BASE: PathBase = {
  repoRoot: "/work/repo",
  projectRoot: "/work/repo/packages/app",
  caseInsensitive: false,
};

describe("pathBase", () => {
  it("resolves a package of the repository", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "storyshelf-affected-paths-")));
    mkdirSync(join(root, "packages/app"), { recursive: true });
    try {
      expect(pathBase(root, join(root, "packages/app"))).toEqual({
        repoRoot: root,
        projectRoot: join(root, "packages/app"),
        caseInsensitive: false,
      });
      expect(pathBase(root, root)?.projectRoot).toBe(root);
      expect(pathBase(root, root, "win32")?.caseInsensitive).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is null when a base cannot be determined", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "storyshelf-affected-paths-")));
    try {
      expect(pathBase(null, root)).toBeNull();
      expect(pathBase(join(root, "missing"), root)).toBeNull();
      expect(pathBase(root, join(root, "does-not-exist"))).toBeNull();
      expect(pathBase(join(root, "somewhere-else"), root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("keys", () => {
  it("put a changed file and a project-relative module id on the same absolute path", () => {
    const changed = keyOfChangedFile(BASE, "packages/app/src/ui/kbd.tsx");
    expect(changed).toBe("/work/repo/packages/app/src/ui/kbd.tsx");
    expect(keyOfModuleId(BASE, "./src/ui/kbd.tsx")).toBe(changed);
    expect(keyOfModuleId(BASE, "src/ui/kbd.tsx")).toBe(changed);
    expect(keyOfStoryFile(BASE, "src/ui/kbd.stories.tsx")).toBe(
      "/work/repo/packages/app/src/ui/kbd.stories.tsx",
    );
  });

  it("reach a sibling workspace package through ../", () => {
    expect(keyOfModuleId(BASE, "../core/src/x.ts")).toBe(
      keyOfChangedFile(BASE, "packages/core/src/x.ts"),
    );
  });

  it("keep an absolute id inside the repository, including Vite's /@fs/ form", () => {
    expect(keyOfModuleId(BASE, "/work/repo/packages/app/src/a.ts")).toBe(
      "/work/repo/packages/app/src/a.ts",
    );
    expect(keyOfModuleId(BASE, "/@fs/work/repo/packages/core/src/b.ts")).toBe(
      "/work/repo/packages/core/src/b.ts",
    );
  });

  it("read a leading-slash id outside the repository as relative to the project", () => {
    expect(keyOfModuleId(BASE, "/src/ui/kbd.tsx")).toBe("/work/repo/packages/app/src/ui/kbd.tsx");
  });

  it("do not confuse a file of another package with the changed one", () => {
    expect(keyOfModuleId(BASE, "./src/ui/kbd.tsx")).not.toBe(
      keyOfChangedFile(BASE, "packages/other/src/ui/kbd.tsx"),
    );
  });

  it("give no key to ids that name no file", () => {
    for (const id of [
      "\0plugin:x",
      "/@id/__x00__virtual",
      "virtual:icons",
      "https://cdn.test/x.js",
    ]) {
      expect(keyOfModuleId(BASE, id)).toBeNull();
    }
  });

  it("ignore case when asked to, as on Windows", () => {
    const base = { ...BASE, caseInsensitive: true };
    expect(keyOfModuleId(base, "./SRC/UI/Kbd.tsx")).toBe(
      keyOfChangedFile(base, "packages/app/src/ui/kbd.tsx"),
    );
    expect(keyOfModuleId(BASE, "./SRC/UI/Kbd.tsx")).not.toBe(
      keyOfChangedFile(BASE, "packages/app/src/ui/kbd.tsx"),
    );
  });
});

describe("projectRelative", () => {
  it("names a changed file the way .storybook/storyshelf.json globs do", () => {
    expect(projectRelative(BASE, "packages/app/src/gen/types.ts")).toBe("src/gen/types.ts");
    expect(projectRelative(BASE, "packages/core/src/x.ts")).toBe("../core/src/x.ts");
    expect(projectRelative({ ...BASE, projectRoot: BASE.repoRoot }, "README.md")).toBe("README.md");
  });
});
