/**
 * Email integration (ADR 0049): SMTP/SES/Mailpit/log/HTTP presets plus the `email` channel provider.
 * One transport serves notification channels and (optionally) auth mail. Importing this module
 * never loads `nodemailer`; only building an SMTP transport does.
 */
import type { NotifierProvider } from "../../adapters/notifier/provider.ts";
import { createEmailNotifier } from "./email.ts";
import { unconfiguredSender } from "./unconfigured.ts";

export { createEmailNotifier } from "./email.ts";
export type { EmailNotifierDefaults } from "./email.ts";
export { httpPreset } from "./http.ts";
export { logPreset } from "./log.ts";
export { mailpitPreset } from "./mailpit.ts";
export { sesPreset, sesPresetFromEnv } from "./ses.ts";
export { NODEMAILER_RANGE, smtpPreset, smtpPresetFromEnv } from "./smtp.ts";
export { emailChannelConfigSchema } from "./types.ts";
export type {
  EmailChannelConfig,
  HttpPresetOptions,
  SesPresetOptions,
  SmtpPresetOptions,
} from "./types.ts";

/** The built-in `email` notifier: registered always, inactive until a transport is configured. */
export function builtInEmailNotifier(): NotifierProvider {
  return createEmailNotifier(unconfiguredSender());
}
