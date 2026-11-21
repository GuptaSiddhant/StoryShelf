/** StoryShelf's own environment variables: the renamed table, the reader and the boot guard (#1308). */
export {
  RENAMED_SETTINGS,
  UNPREFIXED_ALLOWED,
  type RenamedSetting,
  type SettingName,
} from "./renames.ts";
export {
  readSetting,
  refuseRenamedSettings,
  renamedSettingsIn,
  RenamedSettingError,
  type SettingRename,
  type SettingsEnv,
} from "./read.ts";
