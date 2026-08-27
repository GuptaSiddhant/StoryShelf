import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { webhooks, type Webhook } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

export interface WebhookCreateInput {
  url: string;
  events?: string[];
  secret: string;
}

export class WebhookModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(projectId: string): Promise<Webhook[]> {
    return await this.db.list(webhooks, { where: eq(webhooks.projectId, projectId) });
  }

  async create(projectId: string, input: WebhookCreateInput): Promise<Webhook> {
    const now = new Date().toISOString();
    return await this.db.insert(webhooks, {
      id: ulid(),
      projectId,
      url: input.url,
      secret: input.secret,
      events: input.events && input.events.length > 0 ? JSON.stringify(input.events) : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(projectId: string, id: string): Promise<Webhook | null> {
    const rows = await this.db.list(webhooks, { where: eq(webhooks.id, id), limit: 1 });
    const found = rows[0] ?? null;
    return found?.projectId === projectId ? found : null;
  }

  async remove(projectId: string, id: string): Promise<void> {
    const existing = await this.get(projectId, id);
    if (existing) {
      await this.db.remove(webhooks, existing.id);
    }
  }

  static eventsOf(webhook: Webhook): string[] {
    if (!webhook.events) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(webhook.events);
      return Array.isArray(parsed) ? parsed.filter((event): event is string => typeof event === "string") : [];
    } catch {
      return [];
    }
  }
}

export type { Webhook };