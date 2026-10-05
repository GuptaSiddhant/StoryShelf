import type { EmailMessage, EmailSender } from "@storyshelf/core/adapter/email-sender";
import type { Logger } from "@storyshelf/core/logger";
import { httpText } from "@storyshelf/core/utils";
import type { HttpPresetOptions } from "./types.ts";
import { version } from "./version.ts";

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
