/** StoryShelf's own environment variables: the renamed table, the reader and the boot guard (#1308). */
export {
  RENAMED_SETTINGS,
  UNPREFIXED_ALLOWED,
  type RenamedSetting,
  type SettingName,
} from "./renames.ts";
export {
  ALLOW_OLD_NAMES_ENV,
  OLD_NAMES_ALLOWED_MESSAGE,
  oldNamesAllowedFields,
  readSetting,
  refuseRenamedSettings,
  renamedSettingsIn,
  RenamedSettingError,
  type SettingRename,
  type SettingsEnv,
} from "./read.ts";
