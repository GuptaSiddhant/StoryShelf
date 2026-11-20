/**
 * Server-wide git connections (`git_connections`, ADR 0054, decisions 1 and 9): the ones site admins
 * create, and the ones configuration declares. A configured connection wins over a stored row with
 * the same id, which is then listed as ignored. Secrets are encrypted with `SECRET` and leave only
 * through {@link GitConnectionModel.secretOf}, for delivery; every other read returns a
 * {@link GitConnection}, which has no secret field.
 */
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type {
  ConfiguredGitConnection,
  GitConnectionProvider,
  GitConnectionRow,
} from "../schema/git-connection.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";
import { ManagedGitConnectionError } from "./managed-git-connection-error.ts";

/** Tables required by {@link GitConnectionModel}. */
export interface GitConnectionTables {
  gitConnections: Table;
}

/** A connection as the System page and the API see it: never its secret. */
export interface GitConnection {
  id: string;
  provider: GitConnectionProvider;
  name: string;
  apiBase: string | null;
  config: Record<string, unknown>;
  state: string;
  /** Declared in configuration: no edit, rotate or remove in the UI. */
  managed: boolean;
  /** A stored row shadowed by a configured connection with the same id. */
  ignored: boolean;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Input of {@link GitConnectionModel.create}. */
export interface GitConnectionInput {
  provider: GitConnectionProvider;
  name: string;
  apiBase?: string | null;
  /** Non-secret settings (app id, permissions ceiling, token expiry). */
  config?: Record<string, unknown>;
  /** The private key or token; stored encrypted and never returned. */
  secret: string;
  createdBy?: string | null;
}

/** Data operations for git connections. */
export class GitConnectionModel {
  readonly #db: DatabaseAdapter;
  readonly #secret: SecretInput;
  readonly #tables: GitConnectionTables;
  readonly #configured: ReadonlyMap<string, ConfiguredGitConnection>;

  constructor(
    db: DatabaseAdapter,
    secret: SecretInput,
    configured: readonly ConfiguredGitConnection[] = [],
    tables?: GitConnectionTables,
  ) {
    this.#db = db;
    this.#secret = secret;
    this.#configured = new Map(configured.map((connection) => [connection.id, connection]));
    this.#tables = tables ?? { gitConnections: db.tables.gitConnections };
  }

  /** Store a connection a site admin set up; its secret is encrypted before it is written. */
  async create(input: GitConnectionInput): Promise<GitConnection> {
    const now = new Date().toISOString();
    const row = (await this.#db.insert(this.#tables.gitConnections, {
      id: ulid(),
      provider: input.provider,
      name: input.name,
      apiBase: input.apiBase ?? null,
      config: JSON.stringify(input.config ?? {}),
      secretEncrypted: encrypt(this.#secret, input.secret),
      createdBy: input.createdBy ?? null,
      state: "active",
      createdAt: now,
      updatedAt: now,
    })) as unknown as GitConnectionRow;
    return viewOfRow(row, false);
  }

  /** The connection that answers to `id`: the configured one first, else the stored row. */
  async get(id: string): Promise<GitConnection | null> {
    const configured = this.#configured.get(id);
    if (configured) {
      return viewOfConfigured(configured);
    }
    const row = await this.#row(id);
    return row ? viewOfRow(row, false) : null;
  }

  /** Every connection: configured ones first, then stored rows (a shadowed row is marked ignored). */
  async list(): Promise<GitConnection[]> {
    const rows = (await this.#db.list(
      this.#tables.gitConnections,
    )) as unknown as GitConnectionRow[];
    return [
      ...[...this.#configured.values()].map((connection) => viewOfConfigured(connection)),
      ...rows
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((row) => viewOfRow(row, this.#configured.has(row.id))),
    ];
  }

  /**
   * The decrypted secret of the connection that answers to `id`, for delivery and probes only;
   * never return it from a route or log it. Null when there is none.
   */
  async secretOf(id: string): Promise<string | null> {
    const configured = this.#configured.get(id);
    if (configured) {
      return configured.readSecret();
    }
    const row = await this.#row(id);
    return row?.secretEncrypted ? decryptCredential(this.#secret, row.secretEncrypted) : null;
  }

  /**
   * Replace a stored connection's secret (a new key or token) and, for GitLab, its expiry.
   * @throws ManagedGitConnectionError for a configured connection: rotate it in configuration.
   */
  async rotate(
    id: string,
    secret: string,
    config?: Record<string, unknown>,
  ): Promise<GitConnection | null> {
    this.#assertStored(id);
    const row = await this.#row(id);
    if (!row) {
      return null;
    }
    const updated = (await this.#db.update(this.#tables.gitConnections, id, {
      secretEncrypted: encrypt(this.#secret, secret),
      ...(config ? { config: JSON.stringify({ ...parseConfig(row.config), ...config }) } : {}),
      state: "active",
      updatedAt: new Date().toISOString(),
    })) as unknown as GitConnectionRow;
    return viewOfRow(updated, false);
  }

  /**
   * Delete a stored connection.
   * @throws ManagedGitConnectionError for a configured connection: remove it from configuration.
   */
  async remove(id: string): Promise<void> {
    this.#assertStored(id);
    await this.#db.remove(this.#tables.gitConnections, id);
  }

  #assertStored(id: string): void {
    if (this.#configured.has(id)) {
      throw new ManagedGitConnectionError(id);
    }
  }

  async #row(id: string): Promise<GitConnectionRow | null> {
    return (await this.#db.get(
      this.#tables.gitConnections,
      id,
    )) as unknown as GitConnectionRow | null;
  }
}

function viewOfRow(row: GitConnectionRow, ignored: boolean): GitConnection {
  const { secretEncrypted: _secret, config, ...rest } = row;
  return { ...rest, config: parseConfig(config), managed: false, ignored };
}

function viewOfConfigured(connection: ConfiguredGitConnection): GitConnection {
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.name,
    apiBase: connection.apiBase,
    config: { ...connection.config },
    state: "active",
    managed: true,
    ignored: false,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
  };
}

function parseConfig(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
