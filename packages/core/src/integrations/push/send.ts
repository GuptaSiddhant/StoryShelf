import type { Logger } from "../../logger.ts";
import { HttpError, httpStatus, redactSecrets, redactUrlForLog } from "../../utils/index.ts";
import { encryptPayload } from "./encrypt.ts";
import type { PushChannelConfig, PushPayload } from "./types.ts";
import type { Vapid } from "./vapid.ts";

/** Seconds a push service keeps an undelivered message (a day). */
const TTL_SECONDS = 86_400;

/** The push service no longer knows this device (404 or 410): the caller deletes its row. */
export class PushGoneError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`push subscription is gone (HTTP ${String(status)})`);
    this.name = "PushGoneError";
    this.status = status;
  }
}

/** The error a failed send surfaces: no key, endpoint or response body, in message or cause. */
function failureOf(error: unknown): Error {
  if (error instanceof HttpError) {
    if (error.status === 404 || error.status === 410) {
      return new PushGoneError(error.status);
    }
    const message = `push service answered HTTP ${String(error.status)}`;
    return new Error(message, { cause: new Error(message) });
  }
  const text = error instanceof Error ? error.message : String(error);
  const message = `push delivery failed: ${redactSecrets(text)}`;
  return new Error(message, { cause: new Error(message) });
}

/** Headers of one delivery: VAPID identity, encoding and lifetime. */
function requestHeaders(vapid: Vapid, endpoint: string): Record<string, string> {
  return {
    authorization: vapid.authorization(endpoint),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(TTL_SECONDS),
  };
}

/**
 * Deliver one message to one device.
 *
 * @throws {PushGoneError} when the service answers 404 or 410.
 * @throws {Error} for every other failure, with no key, endpoint or response body in its message.
 */
export async function sendPush(
  vapid: Vapid,
  device: PushChannelConfig,
  payload: PushPayload,
  logger?: Logger,
): Promise<void> {
  try {
    const body = encryptPayload(Buffer.from(JSON.stringify(payload)), device.p256dh, device.auth);
    const headers = requestHeaders(vapid, device.endpoint);
    await httpStatus(device.endpoint, {
      method: "POST",
      destination: "project",
      headers,
      body,
      logger,
    });
    logger?.debug({ url: redactUrlForLog(device.endpoint) }, "push delivered");
  } catch (error) {
    throw failureOf(error);
  }
}
