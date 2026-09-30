import type { EmailMessage, EmailSender } from "@storyshelf/core/adapter/email-sender";
import type { Logger } from "@storyshelf/core/logger";
import { httpText } from "@storyshelf/core/utils";
import nodemailer from "nodemailer";
import type { HttpPresetOptions, SmtpPresetOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Package version injected at build via __PKG_VERSION__. */
function version(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}

/** SMTP transport preset (corporate relay, Postfix, SES-over-SMTP). */
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

/** Mailpit/Mailhog preset for local development (no real delivery). */
export function mailpitPreset(
  options: { from?: string; host?: string; port?: number; logger?: Logger } = {},
): EmailSender {
  return smtpPreset({
    host: options.host ?? "localhost",
    port: options.port ?? 1025,
    from: options.from ?? "storyshelf@localhost",
    logger: options.logger,
  });
}

/**
 * SMTP sender from the environment (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
 * `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Returns undefined unless
 * `SMTP_HOST` is set, so unconfigured servers keep current behavior.
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

/** Log-only preset for tests and unconfigured servers (no delivery). */
export function logPreset(options: { logger?: Logger } = {}): EmailSender {
  let logger = options.logger?.child({ component: "notify-email-log" });
  return {
    metadata: { name: "Log", version: version(), kind: "email-log", category: "notifier" },
    setLogger(next: Logger): void {
      logger = next.child({ component: "notify-email-log" });
    },
    // oxlint-disable-next-line eslint/require-await -- send is async by contract
    async send(message: EmailMessage): Promise<void> {
      logger?.info({ to: message.to, subject: message.subject }, "email notification (log)");
    },
  };
}

/** HTTP email-API preset (Resend/Postmark-style JSON endpoint). */
export function httpPreset(options: HttpPresetOptions & { logger?: Logger }): EmailSender {
  let logger = options.logger?.child({ component: "notify-email-http" });
  return {
    metadata: {
      name: "HTTP",
      version: version(),
      kind: "email-http",
      category: "notifier",
    },
    setLogger(next: Logger): void {
      logger = next.child({ component: "notify-email-http" });
    },
    async send(message: EmailMessage): Promise<void> {
      logger?.debug({ to: message.to, subject: message.subject }, "sending email via HTTP");
      await httpText(options.url, {
        method: "POST",
        headers: options.headers,
        json: {
          from: message.from ?? options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        logger,
      });
      logger?.info({ to: message.to }, "email sent via HTTP");
    },
  };
}
