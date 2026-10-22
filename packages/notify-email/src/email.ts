import type { EmailSender } from "@storyshelf/core/adapter/email-sender";
import type {
  MessageNotifierAdapter,
  MessageNotifierProvider,
} from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { emailChannelConfigSchema } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Defaults applied when a channel omits sender identity. */
export interface EmailNotifierDefaults {
  from?: string;
  replyTo?: string;
}

/**
 * Create the `email` channel provider over a shared transport.
 * The same {@link EmailSender} can also serve auth mail (invites, resets).
 */
export function createEmailNotifier(
  sender: EmailSender,
  defaults: EmailNotifierDefaults & { logger?: Logger } = {},
): MessageNotifierProvider {
  return {
    metadata: getMetadata(),
    create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter {
      const config = emailChannelConfigSchema.parse(opts.config);
      const logger = (opts.logger ?? defaults.logger)?.child({ component: "notify-email" });
      return {
        metadata: getMetadata(),
        async send(input): Promise<void> {
          logger?.debug({ channelId: input.channel.id }, "sending email notification");
          await sender.send({
            to: config.to,
            subject: input.formatted.subject,
            text: input.formatted.text,
            html: input.formatted.html,
            from: config.from ?? defaults.from,
            replyTo: config.replyTo ?? defaults.replyTo,
          });
          logger?.info({ channelId: input.channel.id, to: config.to }, "email sent");
        },
      };
    },
  };
}

/** Describe the email provider (name, version, config schema). */
export function getMetadata(): MessageNotifierProvider["metadata"] {
  return {
    name: "Email",
    version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
    description: "Email notifications over a shared SMTP/HTTP transport",
    kind: "email",
    category: "notifier",
    schema: emailChannelConfigSchema,
  };
}
