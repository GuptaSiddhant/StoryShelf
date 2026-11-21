/**
 * The naming ratchet (#1308): product source reads only `SHELF_*` names, the platform and SDK names
 * in `UNPREFIXED_ALLOWED`, and the names below that are not settings at all. An old name lives only in the
 * alias table. A new `env["FOO"]` fails here until it is `SHELF_FOO` or added to a list on purpose.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTING_ALIASES, UNPREFIXED_ALLOWED } from "./aliases.ts";

const ROOT = join(import.meta.dirname, "../../../..");

/** Where product source lives. `apps/fly-app/sprite/` is the demo's own browser host (out of scope). */
const SOURCE_DIRS = ["packages", "apps/server-image", "apps/fly-app", "apps/dev-server/src"];
const SKIPPED =
  /(?:\/node_modules\/|\/dist\/|\/storybook-static\/|\/apps\/fly-app\/sprite\/|\/apps\/fly-app\/e2e\/|\.test\.tsx?$|\.stories\.tsx$|\/stories-fixtures\/|\/\.storybook\/|\/packages\/[^/]+\/scripts\/)/u;
const SOURCE_FILE = /\.(?:ts|tsx|mts|mjs)$/u;

/**
 * Not product settings: names only the repository's own test harnesses read, and the Fly demo's own
 * browser host (`SPRITE_*`, `FLY_SPRITES_TOKEN`: the owner's demo secrets, out of scope in #1308).
 */
const NOT_SETTINGS = [
  "FIXTURE_DIR",
  "RUN_INTEGRATION",
  "LIVE_CLOUD",
  "SPRITE_",
  "FLY_SPRITES_TOKEN",
];

/** `env.NAME`, `env["NAME"]`, `env?.NAME`, `process.env.NAME` and `readSetting(env, "NAME")`. */
const ENV_READ =
  /\benv(?:\?\.|\.|\[\s*["'`])(?<name>[A-Z][A-Z0-9_]*)|readSetting\([^,]+,\s*["'`](?<setting>[A-Z][A-Z0-9_]*)/gu;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (SKIPPED.test(`${path}${entry.isDirectory() ? "/" : ""}`)) {
      return [];
    }
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

function allowed(name: string): boolean {
  if (name.startsWith("SHELF_")) {
    return true;
  }
  return [...UNPREFIXED_ALLOWED, ...NOT_SETTINGS].some((entry) =>
    entry.endsWith("_") ? name.startsWith(entry) : name === entry,
  );
}

function filesUnder(): { file: string; text: string }[] {
  return SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => ({
    file: relative(ROOT, path),
    text: readFileSync(path, "utf8"),
  }));
}

const FILES = filesUnder();
const OLD_NAMES = new Set<string>(Object.values(SETTING_ALIASES).flat());
const ALIAS_TABLE = "packages/core/src/env-settings/aliases.ts";
const CLI_ALIAS_TABLE = "packages/cli/src/settings.ts";

describe("environment variable naming ratchet", () => {
  it("scans the product source", () => {
    expect(FILES.some(({ file }) => file === "apps/server-image/env.ts")).toBe(true);
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("reads no unprefixed name outside the allow-list", () => {
    const offenders = FILES.flatMap(({ file, text }) =>
      [...text.matchAll(ENV_READ)]
        .map((match) => match.groups?.["name"] ?? match.groups?.["setting"] ?? "")
        .filter((name) => !allowed(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("names an old variable as a string only in the alias tables", () => {
    const QUOTED = /["'`](?<name>[A-Z][A-Z0-9_]*)["'`]/gu;
    const offenders = FILES.filter(
      ({ file }) => file !== ALIAS_TABLE && file !== CLI_ALIAS_TABLE,
    ).flatMap(({ file, text }) =>
      [...text.matchAll(QUOTED)]
        .map((match) => match.groups?.["name"] ?? "")
        .filter((name) => OLD_NAMES.has(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("flags an unprefixed read, and passes a SHELF_ or allowed one", () => {
    const sample = 'env["FOO"]; env.SHELF_FOO; process.env.PORT; readSetting(env, "BAR")';
    const names = [...sample.matchAll(ENV_READ)].map(
      (match) => match.groups?.["name"] ?? match.groups?.["setting"],
    );
    expect(names).toEqual(["FOO", "SHELF_FOO", "PORT", "BAR"]);
    expect(names.filter((name) => !allowed(name ?? ""))).toEqual(["FOO", "BAR"]);
  });
});
