/**
 * StoryShelf's own environment variables (#1308): `readSetting` reads a `SHELF_*` name, and
 * `refuseRenamedSettings` is the boot guard that refuses to start while an old name from
 * {@link RENAMED_SETTINGS} is set. Old names are never read. Errors name variables only, never a value.
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

/** Refused boot: old variable names are set. Lists each with its new name, never a value. */
export class RenamedSettingError extends Error {
  override readonly name = "RenamedSettingError";
  readonly renames: readonly SettingRename[];

  constructor(renames: readonly SettingRename[]) {
    const lines = renames.map((rename) => `  ${rename.old} -> ${rename.new}`);
    super(
      `StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then start again:\n${lines.join("\n")}`,
    );
    this.renames = renames;
  }
}

/** The boot guard: throws {@link RenamedSettingError} when any old name (of `names`) is set. */
export function refuseRenamedSettings(env: SettingsEnv, names?: readonly RenamedSetting[]): void {
  const renames = renamedSettingsIn(env, names);
  if (renames.length > 0) {
    throw new RenamedSettingError(renames);
  }
}
