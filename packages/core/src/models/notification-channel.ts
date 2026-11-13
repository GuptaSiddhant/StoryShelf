/** Project and site-wide notification channel subscriptions. */
import { eq, isNull } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { isStateProvider, type NotifierProvider } from "../adapters/notifier/provider.ts";
import type { NotificationChannel } from "../adapters/notifier/types.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { checkOutboundUrl, outboundReasonText } from "../utils/outbound.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link NotificationChannelModel}. */
export interface NotificationChannelTables {
  notificationChannels: Table;
}

/** Result of {@link NotificationChannelModel.validateInput}. */
export type ChannelValidation =
  | { ok: true }
  | {
      ok: false;
      field: "provider" | "config" | "secret";
      message: string;
      /** Per-field problems of an invalid config, keyed by the first path segment. */
      issues?: { path: string; message: string }[];
    };

/** Input for creating a notification channel. */
export interface NotificationChannelCreateInput {
  projectId: string | null;
  provider: string;
  config: Record<string, unknown>;
  secret?: string;
  events?: string[];
  enabled?: boolean;
}

/** Data operations for notification channels. */
export class NotificationChannelModel {
  private readonly tables: NotificationChannelTables;
  private readonly secret?: SecretInput;
  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles (defaults to the adapter's tables).
   * @param secret - Server secret for channel-secret encryption.
   */
  constructor(db: DatabaseAdapter, tables?: NotificationChannelTables, secret?: SecretInput) {
    this.db = db;
    this.tables = tables ?? { notificationChannels: db.tables.notificationChannels };
    this.secret = secret;
  }

  /** List channels for a project. */
  async list(projectId: string): Promise<NotificationChannelRow[]> {
    return (await this.db.list(this.tables.notificationChannels, {
      where: eq(col(this.tables.notificationChannels, "projectId"), projectId),
    })) as unknown as NotificationChannelRow[];
  }

  /** List site-wide admin channels (`project_id IS NULL`). */
  async listSystem(): Promise<NotificationChannelRow[]> {
    return (await this.db.list(this.tables.notificationChannels, {
      where: isNull(col(this.tables.notificationChannels, "projectId")),
    })) as unknown as NotificationChannelRow[];
  }

  /** Create a channel (secret encrypted at rest when provided). */
  async create(input: NotificationChannelCreateInput): Promise<NotificationChannelRow> {
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.notificationChannels, {
      id: ulid(),
      projectId: input.projectId,
      provider: input.provider,
      config: JSON.stringify(input.config),
      secretEncrypted: input.secret ? encrypt(this.secret, input.secret) : null,
      events: input.events && input.events.length > 0 ? JSON.stringify(input.events) : null,
      enabled: input.enabled ?? true,
      lastError: null,
      lastErrorAt: null,
      lastDeliveredAt: null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as NotificationChannelRow;
  }

  /** Fetch a channel by id, or null. */
  async get(id: string): Promise<NotificationChannelRow | null> {
    const rows = (await this.db.list(this.tables.notificationChannels, {
      where: eq(col(this.tables.notificationChannels, "id"), id),
      limit: 1,
    })) as unknown as NotificationChannelRow[];
    return rows[0] ?? null;
  }

  /** Remove a channel by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.notificationChannels, id);
  }

  /**
   * Turn a stored row into the send-ready view providers take, with the secret decrypted
   * in memory. Returns null when the secret cannot be decrypted with the configured keys.
   */
  toView(row: NotificationChannelRow): NotificationChannel | null {
    let secret: string | undefined;
    try {
      secret = row.secretEncrypted ? this.decryptSecret(row) : undefined;
    } catch {
      return null;
    }
    return {
      id: row.id,
      projectId: row.projectId,
      provider: row.provider,
      config: NotificationChannelModel.configOf(row),
      secret,
      events: NotificationChannelModel.eventsOf(row),
      enabled: row.enabled,
      ...(row.lastError === null || row.lastError === undefined
        ? {}
        : { lastError: row.lastError }),
    };
  }

  /** Decrypt the secret for a stored row (in memory only, at send time). */
  decryptSecret(row: NotificationChannelRow): string {
    if (!row.secretEncrypted) {
      throw new Error("Channel has no secret");
    }
    return decryptCredential(this.secret, row.secretEncrypted);
  }

  /**
   * Record the outcome of a delivery attempt. A failure keeps the sanitized error with its time and
   * leaves `lastDeliveredAt` as it was; a success stamps `lastDeliveredAt` and clears the error.
   * An aborted `signal` (the attempt's deadline passed) stops it before the write.
   */
  async recordOutcome(id: string, error?: string, signal?: AbortSignal): Promise<void> {
    const row = await this.get(id);
    signal?.throwIfAborted();
    if (!row) {
      return;
    }
    const now = new Date().toISOString();
    await this.db.update(
      this.tables.notificationChannels,
      id,
      error === undefined
        ? { lastError: null, lastErrorAt: null, lastDeliveredAt: now }
        : { lastError: error, lastErrorAt: now },
    );
  }

  /**
   * Validate channel input against the matching notifier's schema. With `scope`, also
   * enforce what `state` providers (git hosts) need: a project and a token. Then the outbound
   * guard checks the destination URLs (chat webhook URL in `secret`, GitLab `host`); it runs
   * again at send time, which stays the real check because DNS can change.
   */
  static async validateInput(
    notifiers: readonly NotifierProvider[],
    provider: string,
    config: unknown,
    scope?: { projectId: string | null; hasSecret: boolean },
    secret?: string,
  ): Promise<ChannelValidation> {
    const shape = NotificationChannelModel.validateShape(notifiers, provider, config, scope);
    return shape.ok ? await destinationProblem(provider, config, secret) : shape;
  }

  private static validateShape(
    notifiers: readonly NotifierProvider[],
    provider: string,
    config: unknown,
    scope?: { projectId: string | null; hasSecret: boolean },
  ): ChannelValidation {
    const descriptor = notifiers.find((candidate) => candidate.metadata.kind === provider);
    if (!descriptor) {
      return { ok: false, field: "provider", message: `Unknown provider: ${provider}` };
    }
    const parsed = descriptor.metadata.schema.safeParse(config);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: String(issue.path[0] ?? ""),
        message: issue.message,
      }));
      return { ok: false, field: "config", message: parsed.error.message, issues };
    }
    return scope && isStateProvider(descriptor) ? stateScopeProblem(scope) : { ok: true };
  }

  /** Whether the provider kind delivers state (git hosts), so it needs a project and a token. */
  static isStateKind(notifiers: readonly NotifierProvider[], provider: string): boolean {
    const descriptor = notifiers.find((candidate) => candidate.metadata.kind === provider);
    return descriptor !== undefined && isStateProvider(descriptor);
  }

  /** Decode the JSON-serialized event list of a channel. */
  static eventsOf(row: NotificationChannelRow): string[] {
    return decodeEvents(row.events);
  }

  /** Decode the JSON-serialized config of a channel. */
  static configOf(row: NotificationChannelRow): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(row.config);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}

/** Refuse a chat webhook URL or GitLab host that is private or local; never echoes an address. */
async function destinationProblem(
  provider: string,
  config: unknown,
  secret: string | undefined,
): Promise<ChannelValidation> {
  const host = (config as { host?: unknown } | null)?.host;
  const [field, url] =
    provider === "slack" || provider === "teams"
      ? (["secret", secret] as const)
      : provider === "gitlab" && typeof host === "string"
        ? (["config", host] as const)
        : ([null, undefined] as const);
  if (field === null || !url) {
    return { ok: true };
  }
  const reason = await checkOutboundUrl(url);
  if (reason === null) {
    return { ok: true };
  }
  const message = outboundReasonText(reason);
  return field === "secret"
    ? { ok: false, field, message }
    : { ok: false, field, message, issues: [{ path: "host", message }] };
}

/** Git channels belong to one project and carry their own token. */
function stateScopeProblem(scope: {
  projectId: string | null;
  hasSecret: boolean;
}): ChannelValidation {
  if (scope.projectId === null) {
    return { ok: false, field: "provider", message: "Git channels belong to a project" };
  }
  return scope.hasSecret
    ? { ok: true }
    : { ok: false, field: "secret", message: "A git channel needs a token or private key" };
}

/** Decode a JSON event list column (empty = all events). */
function decodeEvents(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((event): event is string => typeof event === "string")
      : [];
  } catch {
    return [];
  }
}
