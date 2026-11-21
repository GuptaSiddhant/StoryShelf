/**
 * StoryShelf's own environment variables (#1308): `readSetting` reads a `SHELF_*` name, and
 * `refuseRenamedSettings` is the boot guard that refuses to start while an old name from
 * {@link RENAMED_SETTINGS} is set, unless `SHELF_ALLOW_OLD_NAMES=1` says another service owns it.
 * Old names are never read. Errors and warnings name variables only, never a value.
 */
import { RENAMED_SETTINGS, type RenamedSetting, type SettingName } from "./renames.ts";

/** The process environment, or a test's. */
export type SettingsEnv = Readonly<Record<string, string | undefined>>;

/** An old variable that is set, and the name that replaced it. */
export interface SettingRename {
  old: string;
  new: SettingName;
}

/** The value of `name`. Only the `SHELF_*` name is read; an old name never is. */
export function readSetting(env: SettingsEnv, name: SettingName): string | undefined {
  return env[name];
}

/**
 * Every old name set to a non-empty value in `env`, with its new name. `names` narrows the check to
 * the settings a process reads (the MCP server checks only its own three).
 */
export function renamedSettingsIn(
  env: SettingsEnv,
  names: readonly RenamedSetting[] = Object.keys(RENAMED_SETTINGS) as RenamedSetting[],
): SettingRename[] {
  return names.flatMap((name) =>
    RENAMED_SETTINGS[name]
      .filter((old) => {
        const value = env[old];
        return value !== undefined && value !== "";
      })
      .map((old) => ({ old, new: name })),
  );
}

/**
 * The escape hatch: another service in the same environment sets one of the generic old names
 * (a log level, a data directory, a bucket, SMTP settings) for itself. With it, boot warns and
 * starts; the old names are still never read.
 */
export const ALLOW_OLD_NAMES_ENV = "SHELF_ALLOW_OLD_NAMES";

/** The warning logged when the escape hatch lets boot continue past old names. */
export const OLD_NAMES_ALLOWED_MESSAGE = `Old StoryShelf variable names are set and ignored (${ALLOW_OLD_NAMES_ENV}=1)`;

/** Refused boot: old variable names are set. Lists each with its new name, never a value. */
export class RenamedSettingError extends Error {
  override readonly name = "RenamedSettingError";
  readonly renames: readonly SettingRename[];

  constructor(renames: readonly SettingRename[]) {
    const lines = renames.map((rename) => `  ${rename.old} -> ${rename.new}`);
    super(
      `StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then start again:\n${lines.join("\n")}\nIf another service sets one of these names for itself, set ${ALLOW_OLD_NAMES_ENV}=1: StoryShelf then starts and still ignores them.`,
    );
    this.renames = renames;
  }
}

/**
 * The boot guard. Throws {@link RenamedSettingError} when any old name (of `names`) is set. With
 * `SHELF_ALLOW_OLD_NAMES=1` it returns those old names instead, for the caller to log once as a
 * warning (names only); otherwise it returns an empty list.
 */
export function refuseRenamedSettings(
  env: SettingsEnv,
  names?: readonly RenamedSetting[],
): SettingRename[] {
  const renames = renamedSettingsIn(env, names);
  if (renames.length === 0 || env[ALLOW_OLD_NAMES_ENV] === "1") {
    return renames;
  }
  throw new RenamedSettingError(renames);
}

/** The fields of the hatch's warning: each ignored old name with its new one, never a value. */
export function oldNamesAllowedFields(renames: readonly SettingRename[]): { oldNames: string[] } {
  return { oldNames: renames.map((rename) => `${rename.old} -> ${rename.new}`) };
}
