/** Webhook subscriptions for project events. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Webhook } from "../schema/webhook.ts";
import { decrypt, encrypt } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link WebhookModel}. */
export interface WebhookTables {
  webhooks: Table;
}

/** Data operations for webhook subscriptions. */
export class WebhookModel {
  private readonly tables: WebhookTables;
  private readonly secret?: string;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   * @param secret - Server secret for webhook-secret encryption (throws on write/decrypt when unset).
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: WebhookTables,
    secret?: string,
  ) {
    this.tables = tables ?? { webhooks: db.tables.webhooks };
    this.secret = secret;
  }

  /** List all webhooks for a project. */
  async list(projectId: string): Promise<Webhook[]> {
    return (await this.db.list(this.tables.webhooks, {
      where: eq(
        getTableColumns(this.tables.webhooks)["projectId"] as unknown as SQLWrapper,
        projectId,
      ),
    })) as unknown as Webhook[];
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
    return (await this.db.insert(this.tables.webhooks, {
      id: ulid(),
      projectId,
      url: input.url,
      secretEncrypted: encrypt(this.secret, input.secret),
      events: input.events && input.events.length > 0 ? JSON.stringify(input.events) : null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Webhook;
  }

  /** Decrypt the secret for a stored row (in memory only, at send time). */
  decryptSecret(row: Webhook): string {
    return decrypt(this.secret, row.secretEncrypted);
  }

  /** Fetch a webhook by id scoped to a project, or null if not found. */
  async get(projectId: string, id: string): Promise<Webhook | null> {
    const rows = (await this.db.list(this.tables.webhooks, {
      where: eq(getTableColumns(this.tables.webhooks)["id"] as unknown as SQLWrapper, id),
      limit: 1,
    })) as unknown as Webhook[];
    const found = rows[0] ?? null;
    return found?.projectId === projectId ? found : null;
  }

  /** Remove a webhook if it belongs to the given project. */
  async remove(projectId: string, id: string): Promise<void> {
    const existing = await this.get(projectId, id);
    if (existing) {
      await this.db.remove(this.tables.webhooks, existing.id);
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
