/**
 * The CLI's reader of StoryShelf's environment variables (#1308). The CLI ships without
 * `@storyshelf/common` (a dev dependency: it would add `@opentelemetry/api`, about 2 MB, to a client-only
 * install), so it keeps the rows of common's `RENAMED_SETTINGS` it reads; `settings.test.ts` fails when
 * a row here differs from common's. Old names are never read
 * (owner policy #1309): the CLI refuses to run while one is set, naming each with its new name and
 * never a value, unless `SHELF_ALLOW_OLD_NAMES=1`. Removed with common's table in the first release of 2027.
 */

/** The CLI's settings with the old names they replaced: the same rows as common's `RENAMED_SETTINGS`. */
export const CLI_RENAMED_SETTINGS = {
  SHELF_URL: ["STORYSHELF_URL", "STORYSHELF_HOST"],
  SHELF_TOKEN: ["STORYSHELF_TOKEN"],
  SHELF_SLUG: ["STORYSHELF_SLUG"],
  SHELF_ADMIN_TOKEN: ["ADMIN_TOKEN", "STORYSHELF_ADMIN_TOKEN"],
  SHELF_FULL: ["STORYSHELF_FULL"],
  SHELF_ZIP: ["STORYSHELF_ZIP"],
  SHELF_SKIP_UNCHANGED: ["STORYSHELF_SKIP_UNCHANGED"],
} as const satisfies Readonly<Record<`SHELF_${string}`, readonly string[]>>;

/** A setting the CLI reads. */
export type CliSetting = keyof typeof CLI_RENAMED_SETTINGS;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The value of `name`. Only the `SHELF_*` name is read; an old name never is. An empty value is
 * unset: a CI secret that does not exist expands to an empty variable, and must not hide the config file.
 */
export function readSetting(env: Env, name: CliSetting): string | undefined {
  const value = env[name];
  return value === "" ? undefined : value;
}

/** `OLD -> NEW` for every old name of the CLI's settings set to a non-empty value. */
export function renamedCliSettingsIn(env: Env): string[] {
  return Object.entries(CLI_RENAMED_SETTINGS).flatMap(([name, olds]) =>
    olds
      .filter((old) => env[old] !== undefined && env[old] !== "")
      .map((old) => `${old} -> ${name}`),
  );
}

/** Lets the CLI run past old names another service owns; they are still never read. */
export const ALLOW_OLD_NAMES_ENV = "SHELF_ALLOW_OLD_NAMES";

/**
 * Throws, naming each old variable with its new name (never a value), when any is set. With
 * `SHELF_ALLOW_OLD_NAMES=1` it returns those `OLD -> NEW` lines instead, for one warning.
 */
export function refuseRenamedCliSettings(env: Env): string[] {
  const renames = renamedCliSettingsIn(env);
  if (renames.length === 0 || env[ALLOW_OLD_NAMES_ENV] === "1") {
    return renames;
  }
  throw new Error(
    `StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then run again:\n${renames.map((line) => `  ${line}`).join("\n")}\nIf another tool sets one of these names for itself, set ${ALLOW_OLD_NAMES_ENV}=1: the CLI then runs and still ignores them.`,
  );
}
