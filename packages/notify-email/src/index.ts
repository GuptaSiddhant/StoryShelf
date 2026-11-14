/**
 * @deprecated The email integration moved into `@storyshelf/core` (ADR 0049). This package only
 * re-exports it for one minor release; import from `@storyshelf/core/integrations` instead.
 */
export {
  createEmailNotifier,
  emailChannelConfigSchema,
  httpPreset,
  logPreset,
  mailpitPreset,
  smtpPreset,
  smtpPresetFromEnv,
} from "@storyshelf/core/integrations";
export type {
  EmailChannelConfig,
  EmailNotifierDefaults,
  HttpPresetOptions,
  SmtpPresetOptions,
} from "@storyshelf/core/integrations";
