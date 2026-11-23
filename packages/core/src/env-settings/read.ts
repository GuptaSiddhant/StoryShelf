/** Moved to `@storyshelf/common/settings` (#1334); re-exported so core's subpaths keep their names. */
export {
  ALLOW_OLD_NAMES_ENV,
  OLD_NAMES_ALLOWED_MESSAGE,
  oldNamesAllowedFields,
  readS3Bucket,
  readSetting,
  refuseRenamedSettings,
  renamedSettingsIn,
  RenamedSettingError,
  type SettingRename,
  type SettingsEnv,
} from "@storyshelf/common/settings";
