/**
 * The CLI's reader of StoryShelf's environment variables (#1308). The CLI ships without
 * `@storyshelf/core` (it is a dev dependency), so it keeps the rows of core's alias table it reads;
 * `settings.test.ts` fails when a row here differs from core's `SETTING_ALIASES`. An old name still
 * works and prints one warning per name per run; two names set to different values throw, naming
 * the variables and never a value.
 */
import { printError } from "./output.ts";

/** The CLI's settings with their old names: the same rows as core's `SETTING_ALIASES`. */
export const CLI_SETTING_ALIASES = {
  SHELF_URL: ["STORYSHELF_URL", "STORYSHELF_HOST"],
  SHELF_TOKEN: ["STORYSHELF_TOKEN"],
  SHELF_SLUG: ["STORYSHELF_SLUG"],
  SHELF_ADMIN_TOKEN: ["ADMIN_TOKEN", "STORYSHELF_ADMIN_TOKEN"],
  SHELF_FULL: ["STORYSHELF_FULL"],
  SHELF_ZIP: ["STORYSHELF_ZIP"],
  SHELF_SKIP_UNCHANGED: ["STORYSHELF_SKIP_UNCHANGED"],
} as const satisfies Readonly<Record<`SHELF_${string}`, readonly string[]>>;

/** A setting the CLI reads. */
export type CliSetting = keyof typeof CLI_SETTING_ALIASES;

type Env = Readonly<Record<string, string | undefined>>;

const warned = new Set<string>();

/** The names of `name`'s setting set to a non-empty value, the new name first. */
function setNames(env: Env, name: CliSetting): string[] {
  return [name, ...CLI_SETTING_ALIASES[name]].filter((each) => {
    const value = env[each];
    return value !== undefined && value !== "";
  });
}

/** One warning per old name per process: names only. */
function warnOnce(old: string, name: CliSetting): void {
  if (warned.has(old)) {
    return;
  }
  warned.add(old);
  printError(`storyshelf: ${old} is renamed ${name}; the old name still works, set the new one`);
}

/** The refusal for two names of one setting with different values: names only. */
function conflictError(name: CliSetting, set: readonly string[]): Error {
  const old = set.filter((each) => each !== name).join(", ");
  const list = `${set.slice(0, -1).join(", ")} and ${set.at(-1)}`;
  const which = set.length === 2 ? "both" : "all";
  return new Error(
    `${list} are ${which} set, to different values: set only ${name} and unset ${old}`,
  );
}

/**
 * The value of `name`, or of an old name for it. An empty value counts as unset; two names set to
 * different values throw.
 */
export function readSetting(env: Env, name: CliSetting): string | undefined {
  const set = setNames(env, name);
  const [first] = set;
  if (first === undefined) {
    return env[name];
  }
  const value = env[first];
  if (set.some((each) => env[each] !== value)) {
    throw conflictError(name, set);
  }
  for (const old of set.filter((each) => each !== name)) {
    warnOnce(old, name);
  }
  return value;
}

/** Test seam: forget which old names were already reported. */
export function resetSettingWarnings(): void {
  warned.clear();
}

/**
 * Set `name` in a child's environment and drop its old names, so a flag passed down never meets a
 * different old value there (which the child would refuse).
 */
export function overrideSetting(
  env: Record<string, string | undefined>,
  name: CliSetting,
  value: string,
): void {
  // A child process ignores an undefined value, so this unsets the old names for it.
  for (const old of CLI_SETTING_ALIASES[name]) {
    env[old] = undefined;
  }
  env[name] = value;
}
