import type {
  MessageNotifierAdapter,
  MessageNotifierProvider,
} from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpText } from "@storyshelf/core/utils";
import { chatTogglesSchema, type ChatToggles } from "./types.ts";

export type { ChatToggles };

declare const __PKG_VERSION__: string | undefined;

/** Validation schema for the Slack incoming-webhook config. */
export const slackWebhookConfigSchema = chatTogglesSchema;

/** Slack incoming-webhook chat provider (Block Kit section + fallback text). */
export const slackWebhookNotifier: MessageNotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter {
    const config = slackWebhookConfigSchema.parse(opts.config);
    return createSlackAdapter({ config, webhookUrl: opts.secret, logger: opts.logger });
  },
};

interface SlackAdapterOptions {
  config: ChatToggles;
  webhookUrl?: string;
  logger?: Logger;
}

/** Describe the Slack provider (name, version, config schema). */
export function getMetadata(): MessageNotifierProvider["metadata"] {
  return {
    name: "Slack",
    version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
    description: "Chat messages via Slack incoming webhooks",
    kind: "slack-webhook",
    category: "notifier",
    logo: "slack",
    schema: slackWebhookConfigSchema,
  };
}

function createSlackAdapter(options: SlackAdapterOptions): MessageNotifierAdapter {
  const logger = options.logger?.child({ component: "notify-chat-slack" });
  return {
    metadata: getMetadata(),
    async send(input): Promise<void> {
      const url = requireWebhookUrl(options.webhookUrl);
      const payload = {
        text: input.formatted.subject,
        username: options.config.username,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: input.formatted.markdown },
          },
        ],
      };
      logger?.debug({ channelId: input.channel.id }, "posting slack message");
      await httpText(url, { method: "POST", json: payload, logger });
      logger?.info({ channelId: input.channel.id }, "slack message posted");
    },
  };
}

/** Incoming-webhook URL arrives as the decrypted channel secret. */
function requireWebhookUrl(secret: string | undefined): string {
  if (!secret) {
    throw new Error("Slack channel is missing its webhook URL secret");
  }
  return secret;
}
