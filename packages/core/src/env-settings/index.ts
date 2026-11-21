/** StoryShelf's own environment variables: the alias table and its one reader (#1308). */
export {
  SETTING_ALIASES,
  UNPREFIXED_ALLOWED,
  type AliasedSetting,
  type SettingName,
} from "./aliases.ts";
export {
  aliasesOf,
  readSetting,
  renamedSettingsIn,
  SettingConflictError,
  warnRenamedSettings,
  type SettingRename,
  type SettingsEnv,
  type SettingsWarnLogger,
} from "./read.ts";
