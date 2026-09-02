import type { DatabaseAdapter } from "./database.ts";
import { WebhookModel } from "../models/webhook.ts";
import { hmacSha256 } from "../utils/hash.ts";

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
