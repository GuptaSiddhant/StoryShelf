import type { EmailSender } from "@storyshelf/core/adapter/email-sender";
import type { Logger } from "@storyshelf/core/logger";
import { smtpPreset } from "./smtp.ts";

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
