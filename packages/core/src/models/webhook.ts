/** Webhook subscriptions for project events. */
import { eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import { webhooks } from "../schema/webhook.ts";
import type { Webhook } from "../schema/webhook.ts";
import { decrypt, encrypt } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";

/** Data operations for webhook subscriptions. */
export class WebhookModel {
  /**
   * @param db - Database adapter.
   * @param secret - Server secret for webhook-secret encryption (throws on write/decrypt when unset).
   */
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly secret?: string,
  ) {}

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
      secretEncrypted: encrypt(this.secret, input.secret),
      events: input.events && input.events.length > 0 ? JSON.stringify(input.events) : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Decrypt the secret for a stored row (in memory only, at send time). */
  decryptSecret(row: Webhook): string {
    return decrypt(this.secret, row.secretEncrypted);
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

/** Input for creating a webhook subscription. */
export interface WebhookCreateInput {
  url: string;
  events?: string[];
  secret: string;
}
