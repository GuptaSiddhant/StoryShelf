import type { EmailSender } from "../../adapters/email-sender.ts";
import type { Logger } from "../../logger.ts";
import { smtpPreset } from "./smtp.ts";

/** Mailpit/Mailhog preset for local development (no real delivery). */
export async function mailpitPreset(
  options: { from?: string; host?: string; port?: number; logger?: Logger } = {},
): Promise<EmailSender> {
  return await smtpPreset({
    host: options.host ?? "localhost",
    port: options.port ?? 1025,
    from: options.from ?? "storyshelf@localhost",
    logger: options.logger,
  });
}
