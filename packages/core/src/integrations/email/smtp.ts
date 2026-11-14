import type { Transporter } from "nodemailer";
import type { EmailMessage, EmailSender } from "../../adapters/email-sender.ts";
import type { Logger } from "../../logger.ts";
import type { SmtpPresetOptions } from "./types.ts";
import { version } from "./version.ts";

/** The `nodemailer` range core accepts as an optional peer (keep equal to `peerDependencies`). */
export const NODEMAILER_RANGE = "^10.2.1";

/** Load the optional `nodemailer` peer, or throw with an install hint (never at import time). */
async function loadNodemailer(): Promise<typeof import("nodemailer")> {
  try {
    return await import("nodemailer");
  } catch (error) {
    throw new Error(`SMTP needs the nodemailer package: install nodemailer@${NODEMAILER_RANGE}`, {
      cause: error,
    });
  }
}

/**
 * SMTP transport preset (corporate relay, Postfix, SES-over-SMTP).
 *
 * Loads the optional `nodemailer` peer here, so a missing peer fails at startup, not on first send.
 */
export async function smtpPreset(
  options: SmtpPresetOptions & { logger?: Logger },
): Promise<EmailSender> {
  const nodemailer = await loadNodemailer();
  const transporter: Transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure ?? options.port === 465,
    requireTLS: options.requireTLS,
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
 * Needs the optional `nodemailer` peer when a sender is built.
 */
export async function smtpPresetFromEnv(
  env: Record<string, string | undefined> = process.env,
  logger?: Logger,
): Promise<EmailSender | undefined> {
  const options = smtpOptionsFromEnv(env);
  return options ? await smtpPreset({ ...options, logger }) : undefined;
}

/** The SMTP options in `env`, or undefined unless `SMTP_HOST` and `SMTP_FROM` are both set. */
function smtpOptionsFromEnv(
  env: Record<string, string | undefined>,
): SmtpPresetOptions | undefined {
  const host = env["SMTP_HOST"];
  const from = env["SMTP_FROM"];
  if (!host || !from) {
    return undefined;
  }
  const port = Number(env["SMTP_PORT"] ?? 587);
  return {
    host,
    port: Number.isSafeInteger(port) && port > 0 ? port : 587,
    secure: env["SMTP_SECURE"] === "1" || env["SMTP_SECURE"] === "true",
    user: env["SMTP_USER"],
    pass: env["SMTP_PASS"],
    from,
  };
}
