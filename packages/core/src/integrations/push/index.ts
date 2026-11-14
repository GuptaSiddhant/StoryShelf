/** Web push integration (ADR 0048, ADR 0049): VAPID (RFC 8292) and `aes128gcm` (RFC 8291). */
import { vapidConfigFromEnv } from "./config.ts";
import { encryptPayload, MAX_PLAINTEXT_BYTES } from "./encrypt.ts";
import { createPushNotifier } from "./notifier.ts";
import { payloadOf } from "./payload.ts";
import { PushGoneError, sendPush } from "./send.ts";
import { MAX_ENDPOINT_LENGTH, pushChannelConfigSchema } from "./types.ts";
import { createVapid, signVapidJwt } from "./vapid.ts";

/** `push` message provider over one VAPID identity. */
export { createPushNotifier };
/** VAPID configuration from `SHELF_VAPID_*` (undefined: push is off). */
export { vapidConfigFromEnv };
/** Deliver one message to one device. */
export { sendPush, PushGoneError };
/** RFC 8291 payload encryption and RFC 8292 signing. */
export { encryptPayload, MAX_PLAINTEXT_BYTES, signVapidJwt };
/** The VAPID identity (key pair checked once, key held as a `KeyObject`). */
export { createVapid };
/** What a device shows, from a formatted notification. */
export { payloadOf };
export { MAX_ENDPOINT_LENGTH, pushChannelConfigSchema };
export type { Vapid } from "./vapid.ts";
export type { PushChannelConfig, PushPayload, VapidConfig } from "./types.ts";
