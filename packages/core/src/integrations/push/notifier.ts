import type {
  MessageNotifierAdapter,
  MessageNotifierProvider,
} from "../../adapters/notifier/index.ts";
import type { Logger } from "../../logger.ts";
import { sendPush } from "./send.ts";
import { pushChannelConfigSchema } from "./types.ts";
import type { PushPayload, VapidConfig } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create the `push` provider (ADR 0048): one adapter per device, addressed to a person.
 * A 404 or 410 answer throws `PushGoneError` so the caller deletes the device's row.
 */
export function createPushNotifier(
  vapid: VapidConfig,
  defaults: { logger?: Logger; link?: (text: string) => string | undefined } = {},
): MessageNotifierProvider {
  return {
    metadata: getMetadata(),
    create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter {
      const device = pushChannelConfigSchema.parse(opts.config);
      const logger = (opts.logger ?? defaults.logger)?.child({ component: "push" });
      return {
        metadata: getMetadata(),
        async send(input): Promise<void> {
          const payload: PushPayload = {
            title: input.formatted.subject,
            body: input.formatted.text,
          };
          await sendPush(vapid, device, payload, input.logger ?? logger);
        },
      };
    },
  };
}

/** Describe the push provider. */
export function getMetadata(): MessageNotifierProvider["metadata"] {
  return {
    name: "Web push",
    version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
    description: "Web push to a person's browsers (RFC 8291, RFC 8292)",
    kind: "push",
    category: "notifier",
    audience: "person",
    schema: pushChannelConfigSchema,
  };
}
