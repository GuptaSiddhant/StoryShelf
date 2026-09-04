import { WebhookModel } from "../models/webhook.ts";
import { hmacSha256 } from "../utils/hash.ts";
import type { DatabaseAdapter } from "./database.ts";

/** Outbound webhook payload delivered to subscribers. */
export interface WebhookEvent {
  event: string;
  projectId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

async function sendWebhook(url: string, secret: string, event: WebhookEvent): Promise<void> {
  const body = JSON.stringify(event);
  const signature = hmacSha256(secret, body);
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-StoryShelf-Event": event.event,
      "X-StoryShelf-Signature": signature,
    },
    body,
  });
}

/**
 * Deliver an event to every subscribed webhook of a project.
 *
 * @param db - Database adapter for loading subscriptions.
 * @param projectId - Project whose webhooks receive the event.
 * @param event - Event name (e.g. "baseline:created").
 * @param data - Event payload.
 */
export async function emitWebhookEvent(
  db: DatabaseAdapter,
  projectId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const webhookModel = new WebhookModel(db);
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
      try {
        await sendWebhook(webhook.url, webhook.secret, eventPayload);
      } catch {
        // Webhook delivery failures are non-fatal
      }
    }),
  );
}
