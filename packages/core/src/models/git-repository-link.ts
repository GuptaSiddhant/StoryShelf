/** Project repository links (`git_repository_links`, epic #1117) and the operator switch for them. */
import { and, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { DEFAULT_STATUS_PREFIX } from "../adapters/notifier/state.ts";
import type { GitRepositoryLinkRow } from "../schema/git-connection.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";
import { GitRepositoryTakenError } from "./git-repository-taken-error.ts";
import type { SiteSettingsModel } from "./site-settings.ts";

/** `site_settings` key of the operator switch: project admins may link any repository a connection covers. */
export const GIT_LINK_ANY_REPOSITORY_KEY = "git_link_any_repository";

/** Tables required by {@link GitRepositoryLinkModel}. */
export interface GitRepositoryLinkTables {
  gitRepositoryLinks: Table;
  notificationChannels: Table;
}

/** Input for requesting a link; the link starts `pending`. */
export interface GitRepositoryLinkInput {
  projectId: string;
  connectionId: string;
  /** Host of the connection's API (`api.github.com`, `ghes.example.com`). */
  host: string;
  owner: string;
  repo: string;
  /** Status-name prefix; empty or absent means the default prefix. */
  prefix?: string;
  requestedBy?: string;
}

/** Whether operators let project admins link any repository a connection covers (default off). */
export async function anyRepositoryLinkAllowed(settings: SiteSettingsModel): Promise<boolean> {
  return (await settings.get(GIT_LINK_ANY_REPOSITORY_KEY)) === "true";
}

/** Host of a channel's API: GitHub's `apiUrl` or GitLab's `host`, else the public host of its provider. */
function channelHost(provider: string, config: Record<string, unknown>): string {
  const url = provider === "gitlab" ? config["host"] : config["apiUrl"];
  if (typeof url === "string") {
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      // Fall through: an unparsable value never matches a real host.
    }
  }
  return provider === "gitlab" ? "gitlab.com" : "api.github.com";
}

function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b;
}

interface LinkKey {
  host: string;
  owner: string;
  repo: string;
  prefix: string;
}

/** Data operations for repository links. */
export class GitRepositoryLinkModel {
  readonly #db: DatabaseAdapter;
  readonly #tables: GitRepositoryLinkTables;

  constructor(db: DatabaseAdapter, tables?: GitRepositoryLinkTables) {
    this.#db = db;
    this.#tables = tables ?? {
      gitRepositoryLinks: db.tables.gitRepositoryLinks,
      notificationChannels: db.tables.notificationChannels,
    };
  }

  /**
   * Request a link. Uniqueness is (host, repository, prefix) over the links and the remaining
   * per-project git channels (decision 3), which the unique index alone cannot see; the index
   * settles two requests racing past the check.
   * @throws GitRepositoryTakenError when either already holds it.
   */
  async create(input: GitRepositoryLinkInput): Promise<GitRepositoryLinkRow> {
    const key: LinkKey = {
      host: input.host.toLowerCase(),
      owner: input.owner.toLowerCase(),
      repo: input.repo.toLowerCase(),
      prefix: input.prefix ?? "",
    };
    if (await this.#channelHolds(key)) {
      throw new GitRepositoryTakenError("channel");
    }
    if ((await this.#linkHolds(key)) !== null) {
      throw new GitRepositoryTakenError("link");
    }
    try {
      return await this.#insert(input, key);
    } catch (error) {
      if ((await this.#linkHolds(key)) === null) {
        throw error;
      }
      throw new GitRepositoryTakenError("link");
    }
  }

  async #insert(input: GitRepositoryLinkInput, key: LinkKey): Promise<GitRepositoryLinkRow> {
    const now = new Date().toISOString();
    return (await this.#db.insert(this.#tables.gitRepositoryLinks, {
      id: ulid(),
      projectId: input.projectId,
      connectionId: input.connectionId,
      ...key,
      hostRepositoryId: null,
      state: "pending",
      reason: null,
      outputs: "{}",
      installationId: null,
      requestedBy: input.requestedBy ?? null,
      approvedBy: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as GitRepositoryLinkRow;
  }

  /** The links of a project. */
  async list(projectId: string): Promise<GitRepositoryLinkRow[]> {
    const table = this.#tables.gitRepositoryLinks;
    return (await this.#db.list(table, {
      where: eq(col(table, "projectId"), projectId),
    })) as unknown as GitRepositoryLinkRow[];
  }

  async #linkHolds(key: LinkKey): Promise<GitRepositoryLinkRow | null> {
    const table = this.#tables.gitRepositoryLinks;
    const rows = (await this.#db.list(table, {
      where: and(
        eq(col(table, "host"), key.host),
        eq(col(table, "owner"), key.owner),
        eq(col(table, "repo"), key.repo),
        eq(col(table, "prefix"), key.prefix),
      ),
      limit: 1,
    })) as unknown as GitRepositoryLinkRow[];
    return rows[0] ?? null;
  }

  async #channelHolds(key: LinkKey): Promise<boolean> {
    const rows = (await this.#db.list(
      this.#tables.notificationChannels,
    )) as unknown as NotificationChannelRow[];
    return rows.some((row) => {
      if (row.projectId === null || (row.provider !== "github" && row.provider !== "gitlab")) {
        return false;
      }
      const config = parseConfig(row.config);
      return (
        channelHost(row.provider, config) === key.host &&
        sameText(config["owner"], key.owner) &&
        sameText(config["repo"], key.repo) &&
        effectivePrefix(config["prefix"]) === effectivePrefix(key.prefix)
      );
    });
  }
}

function effectivePrefix(prefix: unknown): string {
  return typeof prefix === "string" && prefix.length > 0 ? prefix : DEFAULT_STATUS_PREFIX;
}

function parseConfig(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
