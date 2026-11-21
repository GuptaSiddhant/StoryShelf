/**
 * The one reader of StoryShelf's own environment variables (#1308). `readSetting(env, "SHELF_X")`
 * returns the `SHELF_X` value, or the value of an old name from {@link SETTING_ALIASES}. Errors and
 * warnings name variables only, never a value.
 */
import { SETTING_ALIASES, type SettingName } from "./aliases.ts";

/** The process environment, or a test's. */
export type SettingsEnv = Readonly<Record<string, string | undefined>>;

/** An old variable that is set, and the name that replaces it. */
export interface SettingRename {
  old: string;
  new: SettingName;
}

/** `A and B are both set, to different values: …`; names only. */
function conflictMessage(setting: SettingName, names: readonly string[]): string {
  const list = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const which = names.length === 2 ? "both" : "all";
  const old = names.filter((name) => name !== setting).join(", ");
  return `${list} are ${which} set, to different values: set only ${setting} and unset ${old}`;
}

/** Thrown when two names of one setting are set to different values. Names the variables, never the values. */
export class SettingConflictError extends Error {
  readonly setting: SettingName;
  readonly names: readonly string[];

  constructor(setting: SettingName, names: readonly string[]) {
    super(conflictMessage(setting, names));
    this.setting = setting;
    this.name = "SettingConflictError";
    this.names = names;
  }
}

const NO_ALIASES: readonly string[] = [];

/** The old names that still set `name` (none for a name without aliases). */
export function aliasesOf(name: SettingName): readonly string[] {
  return Object.hasOwn(SETTING_ALIASES, name)
    ? SETTING_ALIASES[name as keyof typeof SETTING_ALIASES]
    : NO_ALIASES;
}

/** The names of `name`'s setting that are set to a non-empty value, the new name first. */
function setNames(env: SettingsEnv, name: SettingName): string[] {
  return [name, ...aliasesOf(name)].filter((each) => {
    const value = env[each];
    return value !== undefined && value !== "";
  });
}

/**
 * The value of setting `name`: its `SHELF_*` variable, else an old name's. An empty value counts as
 * unset. Two names set to the same value are accepted; different values throw
 * {@link SettingConflictError}, naming both variables.
 */
export function readSetting(env: SettingsEnv, name: SettingName): string | undefined {
  const set = setNames(env, name);
  const [first] = set;
  if (first === undefined) {
    return env[name];
  }
  const value = env[first];
  if (set.some((each) => env[each] !== value)) {
    throw new SettingConflictError(name, set);
  }
  return value;
}

/**
 * Every old name set in `env`, with its replacement, after checking each setting for a conflict.
 * Boot calls this once (through {@link warnRenamedSettings}), so a conflict refuses to start.
 */
export function renamedSettingsIn(env: SettingsEnv): SettingRename[] {
  return Object.keys(SETTING_ALIASES).flatMap((key) => {
    const name = key as SettingName;
    readSetting(env, name);
    return setNames(env, name)
      .filter((each) => each !== name)
      .map((old) => ({ old, new: name }));
  });
}

/** The part of a logger this needs: pino's `warn(object, message)`. */
export interface SettingsWarnLogger {
  warn(details: object, message: string): void;
}

/**
 * Boot's check: throws on a conflict, then logs one warning `{ old, new }` per old name in use. Never
 * logs a value. Returns the renames so a caller can report them elsewhere too.
 */
export function warnRenamedSettings(env: SettingsEnv, logger: SettingsWarnLogger): SettingRename[] {
  const renames = renamedSettingsIn(env);
  for (const rename of renames) {
    logger.warn(rename, "environment variable renamed: the old name still works, set the new one");
  }
  return renames;
}
