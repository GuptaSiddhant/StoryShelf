import type { NotifierAdapter, NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { z } from "zod";

declare const __PKG_VERSION__: string | undefined;

/** Validation schema for the log provider config (accepts anything). */
export const logConfigSchema = z.object({}).loose();

/** Log-only chat provider for tests, dev, and unconfigured servers. */
export const logNotifier: NotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }): NotifierAdapter {
    logConfigSchema.parse(opts.config);
    const logger = opts.logger?.child({ component: "notify-chat-log" }) ?? opts.logger;
    return {
      metadata: getMetadata(),
      // oxlint-disable-next-line eslint/require-await -- send is async by contract
      async send(input): Promise<void> {
        logger?.info(
          { channelId: input.channel.id, subject: input.formatted.subject },
          "chat notification (log)",
        );
      },
    };
  },
};

/** Describe the log provider (name, version, config schema). */
export function getMetadata(): NotifierProvider["metadata"] {
  return {
    name: "Log",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Chat notifications to the server log (tests and dev)",
    kind: "log",
    category: "notifier",
    schema: logConfigSchema,
  };
}
