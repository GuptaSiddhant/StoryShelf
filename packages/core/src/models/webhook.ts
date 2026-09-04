/** Webhook subscriptions for project events. */
import { eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { webhooks } from "../schema-tables.ts";
import type { Webhook } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

/** Input for creating a webhook subscription. */
export interface WebhookCreateInput {
  url: string;
  events?: string[];
  secret: string;
}

/** Data operations for webhook subscriptions. */
export class WebhookModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /** List all webhooks for a project. */
  async list(projectId: string): Promise<Webhook[]> {
    return await this.db.list(webhooks, { where: eq(webhooks.projectId, projectId) });
  }

  /**
   * Create a webhook subscription for a project.
   *
   * @param projectId - Project ID.
   * @param input - Webhook creation input.
   * @returns The created webhook.
   */
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

  /** Fetch a webhook by id scoped to a project, or null if not found. */
  async get(projectId: string, id: string): Promise<Webhook | null> {
    const rows = await this.db.list(webhooks, { where: eq(webhooks.id, id), limit: 1 });
    const found = rows[0] ?? null;
    return found?.projectId === projectId ? found : null;
  }

  /** Remove a webhook if it belongs to the given project. */
  async remove(projectId: string, id: string): Promise<void> {
    const existing = await this.get(projectId, id);
    if (existing) {
      await this.db.remove(webhooks, existing.id);
    }
  }

  /** Decode the JSON-serialized event list of a webhook. */
  static eventsOf(webhook: Webhook): string[] {
    if (!webhook.events) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(webhook.events);
      return Array.isArray(parsed)
        ? parsed.filter((event): event is string => typeof event === "string")
        : [];
    } catch {
      return [];
    }
  }
}

export type { Webhook };
