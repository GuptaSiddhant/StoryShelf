import type {
  MessageNotifierAdapter,
  MessageNotifierProvider,
} from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpText } from "@storyshelf/core/utils";
import { z } from "zod";

/** What a project admin may set on a channel of this kind; the URL is the secret, not config. */
export const webhookConfigSchema = z.object({ prefix: z.string().min(1).optional() });

/** A chat-style provider that POSTs `{ subject, text }` as JSON to the channel's webhook URL. */
export const jsonWebhookNotifier: MessageNotifierProvider = {
  metadata: {
    name: "JSON webhook",
    version: "0.0.0",
    kind: "json-webhook",
    category: "notifier",
    audience: "room",
    schema: webhookConfigSchema,
  },
  create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter {
    const config = webhookConfigSchema.parse(opts.config); // an invalid config throws here
    const logger = opts.logger?.child({ component: "notify-json-webhook" });
    const url = opts.secret;
    return {
      metadata: jsonWebhookNotifier.metadata,
      async send({ channel, formatted }): Promise<void> {
        if (!url) throw new Error("JSON webhook channel is missing its URL secret");
        const subject = config.prefix ? `${config.prefix} ${formatted.subject}` : formatted.subject;
        // The URL was set by a project admin, so mark it `project`: https and public only.
        await httpText(url, {
          method: "POST",
          json: { subject, text: formatted.text },
          destination: "project",
          logger,
        });
        logger?.info({ channelId: channel.id }, "webhook posted"); // never log `url`
      },
    };
  },
};
