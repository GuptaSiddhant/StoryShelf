import type { EmailMessage, EmailSender } from "@storyshelf/core/adapter/email-sender";
import type { Logger } from "@storyshelf/core/logger";
import nodemailer from "nodemailer";
import type { SmtpPresetOptions } from "./types.ts";
import { version } from "./version.ts";

/**
 * SMTP transport preset (corporate relay, Postfix, SES-over-SMTP).
 *
 * Requires the optional `nodemailer` peer (`nub add nodemailer`).
 */
export function smtpPreset(options: SmtpPresetOptions & { logger?: Logger }): EmailSender {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure ?? options.port === 465,
    auth: options.user ? { user: options.user, pass: options.pass } : undefined,
  });
  const from = options.from;
  let logger = options.logger?.child({ component: "notify-email-smtp" });
  return {
    metadata: {
      name: "SMTP",
      version: version(),
      kind: "email-smtp",
      category: "notifier",
    },
    setLogger(next: Logger): void {
      logger = next.child({ component: "notify-email-smtp" });
    },
    async send(message: EmailMessage): Promise<void> {
      logger?.debug({ to: message.to, subject: message.subject }, "sending email");
      await transporter.sendMail({
        from: message.from ?? from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
      });
      logger?.info({ to: message.to }, "email sent");
    },
  };
}

/**
 * SMTP sender from the environment (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
 * `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Returns undefined unless
 * `SMTP_HOST` is set, so unconfigured servers keep current behavior.
 *
 * Requires the optional `nodemailer` peer when a sender is built.
 */
export function smtpPresetFromEnv(
  env: Record<string, string | undefined> = process.env,
  logger?: Logger,
): EmailSender | undefined {
  const host = env["SMTP_HOST"];
  const from = env["SMTP_FROM"];
  if (!host || !from) {
    return undefined;
  }
  const port = Number(env["SMTP_PORT"] ?? 587);
  return smtpPreset({
    host,
    port: Number.isSafeInteger(port) && port > 0 ? port : 587,
    secure: env["SMTP_SECURE"] === "1" || env["SMTP_SECURE"] === "true",
    user: env["SMTP_USER"],
    pass: env["SMTP_PASS"],
    from,
    logger,
  });
}
