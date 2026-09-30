import type { NotifierAdapter, NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpText } from "@storyshelf/core/utils";
import { chatTogglesSchema, type ChatToggles } from "./types.ts";

export type { ChatToggles };

declare const __PKG_VERSION__: string | undefined;

/** Validation schema for the Teams workflow-webhook config. */
export const teamsWorkflowConfigSchema = chatTogglesSchema;

/** Teams workflow-webhook chat provider (Adaptive Card message). */
export const teamsWorkflowNotifier: NotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }): NotifierAdapter {
    const config = teamsWorkflowConfigSchema.parse(opts.config);
    return createTeamsAdapter({ config, webhookUrl: opts.secret, logger: opts.logger });
  },
};

interface TeamsAdapterOptions {
  config: ChatToggles;
  webhookUrl?: string;
  logger?: Logger;
}

/** Describe the Teams provider (name, version, config schema). */
export function getMetadata(): NotifierProvider["metadata"] {
  return {
    name: "Microsoft Teams",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Chat messages via Teams workflow webhooks",
    kind: "teams-workflow",
    category: "notifier",
    logo: "teams",
    schema: teamsWorkflowConfigSchema,
  };
}

function createTeamsAdapter(options: TeamsAdapterOptions): NotifierAdapter {
  const logger = options.logger?.child({ component: "notify-chat-teams" });
  return {
    metadata: getMetadata(),
    async send(input): Promise<void> {
      const url = requireWebhookUrl(options.webhookUrl);
      const payload = {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                { type: "TextBlock", text: input.formatted.subject, weight: "Bolder" },
                { type: "TextBlock", text: input.formatted.text, wrap: true },
              ],
            },
          },
        ],
      };
      logger?.debug({ channelId: input.channel.id }, "posting teams message");
      await httpText(url, { method: "POST", json: payload, logger });
      logger?.info({ channelId: input.channel.id }, "teams message posted");
    },
  };
}

/** Workflow URL arrives as the decrypted channel secret. */
function requireWebhookUrl(secret: string | undefined): string {
  if (!secret) {
    throw new Error("Teams channel is missing its workflow URL secret");
  }
  return secret;
}
