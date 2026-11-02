import type { Logger } from "pino";
import { WebhookModel, type WebhookTables } from "../models/webhook.ts";
import type { Webhook } from "../schema/webhook.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import { hmacSha256 } from "../utils/hash.ts";
import { httpStatus } from "../utils/http.ts";
import type { DatabaseAdapter } from "./database.ts";

/**
 * Deliver an event to every subscribed webhook of a project.
 *
 * @param db - Database adapter for loading subscriptions.
 * @param tables - Webhook table handles.
 * @param projectId - Project whose webhooks receive the event.
 * @param event - Event name (e.g. "baseline:created").
 * @param data - Event payload.
 * @param secret - Server secret for decrypting webhook secrets (in memory only).
 * @param logger - Optional logger for per-delivery outcomes.
 */
export async function emitWebhookEvent(
  db: DatabaseAdapter,
  tables: WebhookTables,
  projectId: string,
  event: string,
  data: Record<string, unknown>,
  secret: SecretInput,
  logger?: Logger,
): Promise<void> {
  const webhookModel = new WebhookModel(db, tables, secret);
  const webhooks = await webhookModel.list(projectId);
  const eventPayload: WebhookEvent = {
    event,
    projectId,
    data,
    timestamp: new Date().toISOString(),
  };

  await Promise.allSettled(
    webhooks.map(async (webhook) => {
      const events = WebhookModel.eventsOf(webhook);
      if (events.length > 0 && !events.includes(event)) {
        return;
      }
      await deliverToWebhook(webhookModel, webhook, eventPayload, logger);
    }),
  );
}

/** Decrypt, send, and log one webhook delivery (failures stay non-fatal). */
async function deliverToWebhook(
  webhookModel: WebhookModel,
  webhook: Webhook,
  eventPayload: WebhookEvent,
  logger: Logger | undefined,
): Promise<void> {
  let plaintext: string;
  try {
    plaintext = webhookModel.decryptSecret(webhook);
  } catch {
    // Undecryptable secret (e.g. rotated server SECRET) — skip, don't leak
    logger?.warn({ webhookId: webhook.id }, "skipping webhook with undecryptable secret");
    return;
  }
  try {
    // A non-2xx answer throws HttpError, so only a delivery the subscriber accepted is "delivered".
    await sendWebhook(webhook.url, plaintext, eventPayload, logger);
    logger?.info({ webhookId: webhook.id, host: hostOf(webhook.url) }, "webhook delivered");
  } catch (error) {
    // Webhook delivery failures are non-fatal
    logger?.warn(
      { webhookId: webhook.id, host: hostOf(webhook.url), err: error },
      "webhook delivery failed",
    );
  }
}

/** Outbound webhook payload delivered to subscribers. */
export interface WebhookEvent {
  event: string;
  projectId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/** Hostname of a webhook URL for logs (never the full URL — may carry secrets). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "[invalid-url]";
  }
}

/**
 * POST one event through `httpStatus` (default timeout and retry policy). The signature covers the
 * exact body string, and `json` serializes the event with the same `JSON.stringify`.
 */
async function sendWebhook(
  url: string,
  secret: string,
  event: WebhookEvent,
  logger: Logger | undefined,
): Promise<void> {
  await httpStatus(url, {
    method: "POST",
    json: event,
    headers: {
      "X-StoryShelf-Event": event.event,
      "X-StoryShelf-Signature": hmacSha256(secret, JSON.stringify(event)),
    },
    ...(logger ? { logger } : {}),
  });
}
