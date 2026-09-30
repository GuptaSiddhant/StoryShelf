/**
 * Email notification transport: SMTP/Mailpit/log/HTTP presets plus the
 * `email` channel provider. One transport serves notification channels
 * and (optionally) auth mail — wire the same sender into both.
 */
import { httpPreset, logPreset, mailpitPreset, smtpPreset, smtpPresetFromEnv } from "./client.ts";
import { createEmailNotifier } from "./email.ts";

/** SMTP transport preset (corporate relay, Postfix, SES-over-SMTP). */
export { smtpPreset };
/** SMTP sender from `SMTP_*` environment (undefined unless configured). */
export { smtpPresetFromEnv };
/** Mailpit/Mailhog preset for local development (no real delivery). */
export { mailpitPreset };
/** Log-only preset for tests and unconfigured servers (no delivery). */
export { logPreset };
/** HTTP email-API preset (Resend/Postmark-style JSON endpoint). */
export { httpPreset };
/** `email` channel provider over a shared transport. */
export { createEmailNotifier };

export type { EmailNotifierDefaults } from "./email.ts";
export type { EmailChannelConfig, HttpPresetOptions, SmtpPresetOptions } from "./types.ts";
export { emailChannelConfigSchema } from "./types.ts";
