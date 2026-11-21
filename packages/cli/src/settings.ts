/**
 * The CLI's reader of StoryShelf's environment variables (#1308). The CLI ships without
 * `@storyshelf/core` (it is a dev dependency), so it keeps the rows of core's `RENAMED_SETTINGS` it
 * reads; `settings.test.ts` fails when a row here differs from core's. Old names are never read
 * (owner policy #1309): the CLI refuses to run while one is set, naming each with its new name and
 * never a value.
 */

/** The CLI's settings with the old names they replaced: the same rows as core's `RENAMED_SETTINGS`. */
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

/** The value of `name`. Only the `SHELF_*` name is read; an old name never is. */
export function readSetting(env: Env, name: CliSetting): string | undefined {
  return env[name];
}

/** `OLD -> NEW` for every old name of the CLI's settings set to a non-empty value. */
export function renamedCliSettingsIn(env: Env): string[] {
  return Object.entries(CLI_RENAMED_SETTINGS).flatMap(([name, olds]) =>
    olds
      .filter((old) => env[old] !== undefined && env[old] !== "")
      .map((old) => `${old} -> ${name}`),
  );
}

/** Throws, naming each old variable with its new name (never a value), when any is set. */
export function refuseRenamedCliSettings(env: Env): void {
  const renames = renamedCliSettingsIn(env);
  if (renames.length > 0) {
    throw new Error(
      `StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then run again:\n${renames.map((line) => `  ${line}`).join("\n")}`,
    );
  }
}
