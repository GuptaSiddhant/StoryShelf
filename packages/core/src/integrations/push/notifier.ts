import type {
  MessageNotifierAdapter,
  MessageNotifierProvider,
} from "../../adapters/notifier/index.ts";
import type { Logger } from "../../logger.ts";
import { payloadOf } from "./payload.ts";
import { PushGoneError, sendPush } from "./send.ts";
import { pushChannelConfigSchema } from "./types.ts";
import type { PushChannelConfig } from "./types.ts";
import type { Vapid } from "./vapid.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create the `push` provider (ADR 0048): one adapter per device, addressed to a person.
 * A 404 or 410 answer means the device is gone: `onGone` is told (the host deletes its row) and the
 * send ends without an error, since there is nothing left to retry. Without `onGone` it throws
 * `PushGoneError`.
 */
export function createPushNotifier(
  vapid: Vapid,
  defaults: {
    logger?: Logger;
    onGone?: (device: PushChannelConfig) => Promise<void>;
  } = {},
): MessageNotifierProvider {
  return {
    metadata: getMetadata(),
    create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter {
      const device = pushChannelConfigSchema.parse(opts.config);
      const logger = (opts.logger ?? defaults.logger)?.child({ component: "push" });
      return {
        metadata: getMetadata(),
        async send(input): Promise<void> {
          try {
            await sendPush(vapid, device, payloadOf(input.formatted), input.logger ?? logger);
          } catch (error) {
            if (!(error instanceof PushGoneError) || defaults.onGone === undefined) {
              throw error;
            }
            await defaults.onGone(device);
          }
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
