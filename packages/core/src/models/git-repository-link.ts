/**
 * Project repository links (`git_repository_links`, ADR 0054, decisions 2 and 3) and the operator
 * switch for them. A link is `pending` until a site admin approves it; only an `approved` link
 * posts. States move `pending` → `approved` | `refused`, `approved` → `broken` (a definitive
 * refusal from the host, decision 6) and `broken` → `approved` (reconnected). Changing a link's
 * repository, connection or prefix returns it to `pending` and forgets what its approval pinned.
 */
import { and, eq } from "drizzle-orm";
import type { SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { parseOutputs, type StateOutputs } from "../adapters/notifier/outputs.ts";
import type { GitRepositoryLinkRow, GitRepositoryLinkState } from "../schema/git-connection.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";
import { channelHoldsKey, linkKeyOf, sameLinkKey, type LinkKey } from "./git-link-key.ts";
import { GitLinkStateError } from "./git-link-state-error.ts";
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

/** What approving pins: the host's repository id and, for a GitHub App, the installation. */
export interface GitLinkPins {
  hostRepositoryId: string;
  installationId?: string | null | undefined;
}

/** What {@link GitRepositoryLinkModel.change} may change; a change returns the link to `pending`. */
export type GitLinkChange = Partial<
  Pick<GitRepositoryLinkInput, "connectionId" | "host" | "owner" | "repo" | "prefix">
>;

/** Whether operators let project admins link any repository a connection covers (default off). */
export async function anyRepositoryLinkAllowed(settings: SiteSettingsModel): Promise<boolean> {
  return (await settings.get(GIT_LINK_ANY_REPOSITORY_KEY)) === "true";
}

/** The stored outputs of a link, defaults filled in. */
export function linkOutputsOf(link: Pick<GitRepositoryLinkRow, "outputs">): StateOutputs {
  return parseOutputs(link.outputs);
}

/**
 * A new link row: `pending`, or `approved` (with the pins and outputs a move carries over) when
 * `approved` is given. Not yet written; {@link GitRepositoryLinkModel.create} and a channel move
 * insert it.
 */
export function newLinkRow(
  input: GitRepositoryLinkInput,
  key: LinkKey,
  approved?: { approvedBy: string | null; pins?: GitLinkPins; outputs?: StateOutputs },
): GitRepositoryLinkRow {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    projectId: input.projectId,
    connectionId: input.connectionId,
    ...key,
    hostRepositoryId: approved?.pins?.hostRepositoryId ?? null,
    state: approved ? "approved" : "pending",
    reason: null,
    outputs: approved?.outputs ? JSON.stringify(approved.outputs) : "{}",
    installationId: approved?.pins?.installationId ?? null,
    requestedBy: input.requestedBy ?? null,
    approvedBy: approved?.approvedBy ?? null,
    approvedAt: approved ? now : null,
    lastDeliveredAt: null,
    createdAt: now,
    updatedAt: now,
  };
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
   * Request a link, `pending` (or `approved` with `approved`, for a configured link or one a site
   * admin assigns up front). Uniqueness is (host, repository, prefix) over the links and the
   * remaining per-project git channels (decision 3), which the unique index alone cannot see; the
   * index settles two requests racing past the check.
   * @throws GitRepositoryTakenError when either already holds it.
   */
  async create(
    input: GitRepositoryLinkInput,
    approved?: { approvedBy: string | null },
  ): Promise<GitRepositoryLinkRow> {
    const key = linkKeyOf(input);
    await this.#assertFree(key, null);
    try {
      return await this.#insert(input, key, approved);
    } catch (error) {
      if ((await this.findByKey(key)) === null) {
        throw error;
      }
      throw new GitRepositoryTakenError("link");
    }
  }

  async #insert(
    input: GitRepositoryLinkInput,
    key: LinkKey,
    approved: { approvedBy: string | null } | undefined,
  ): Promise<GitRepositoryLinkRow> {
    return (await this.#db.insert(
      this.#tables.gitRepositoryLinks,
      newLinkRow(input, key, approved),
    )) as unknown as GitRepositoryLinkRow;
  }

  /**
   * Stamp the time delivery last posted through the link. Touches nothing else (not `updatedAt`):
   * it is a diagnostic, never a state change.
   */
  async markDelivered(id: string, at: string = new Date().toISOString()): Promise<void> {
    await this.#db.update(this.#tables.gitRepositoryLinks, id, { lastDeliveredAt: at });
  }

  /** One link, or null. */
  async get(id: string): Promise<GitRepositoryLinkRow | null> {
    return (await this.#db.get(
      this.#tables.gitRepositoryLinks,
      id,
    )) as unknown as GitRepositoryLinkRow | null;
  }

  /** The links of a project, oldest first. */
  async list(projectId: string): Promise<GitRepositoryLinkRow[]> {
    const table = this.#tables.gitRepositoryLinks;
    return await this.#sorted(eq(col(table, "projectId"), projectId));
  }

  /** Every link (the System page), or those in `state` (the approval queue), oldest first. */
  async listAll(state?: GitRepositoryLinkState): Promise<GitRepositoryLinkRow[]> {
    const table = this.#tables.gitRepositoryLinks;
    return await this.#sorted(state === undefined ? undefined : eq(col(table, "state"), state));
  }

  async #sorted(where: SQL | undefined): Promise<GitRepositoryLinkRow[]> {
    const rows = (await this.#db.list(
      this.#tables.gitRepositoryLinks,
      where === undefined ? {} : { where },
    )) as unknown as GitRepositoryLinkRow[];
    return rows.toSorted((a, b) => a.id.localeCompare(b.id));
  }

  /** The link holding `key` (host, repository, prefix), or null. */
  async findByKey(key: LinkKey): Promise<GitRepositoryLinkRow | null> {
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

  /**
   * Approve a `pending` link, or reconnect a `broken` one, pinning the host's repository id (and
   * installation) a site admin's coverage check found.
   * @throws GitLinkStateError from any other state.
   */
  async approve(
    id: string,
    pins: GitLinkPins,
    approvedBy: string | null,
  ): Promise<GitRepositoryLinkRow> {
    const now = new Date().toISOString();
    return await this.#move(id, ["pending", "broken"], "approved", {
      state: "approved",
      reason: null,
      hostRepositoryId: pins.hostRepositoryId,
      installationId: pins.installationId ?? null,
      approvedBy,
      approvedAt: now,
    });
  }

  /**
   * Approve a link because configuration declares it (decision 9): it counts as approved and is
   * managed. A link already approved, or broken by its host, on the same connection is left as it
   * is (a broken link waits for a reconnect, decision 6); a new connection forgets the pins, and
   * delivery resolves them again.
   */
  async approveByConfiguration(id: string, connectionId: string): Promise<GitRepositoryLinkRow> {
    const link = await this.get(id);
    if (link === null) {
      throw new GitLinkStateError("approved by configuration", null);
    }
    const sameConnection = link.connectionId === connectionId;
    if (sameConnection && (link.state === "approved" || link.state === "broken")) {
      return link;
    }
    return await this.#write(id, {
      ...(sameConnection ? {} : { hostRepositoryId: null, installationId: null }),
      connectionId,
      state: "approved",
      reason: null,
      approvedBy: null,
      approvedAt: new Date().toISOString(),
    });
  }

  /**
   * Refuse a `pending` link; it keeps its record for the audit trail.
   * @throws GitLinkStateError from any other state.
   */
  async refuse(id: string, reason: string | null = null): Promise<GitRepositoryLinkRow> {
    return await this.#move(id, ["pending"], "refused", { state: "refused", reason });
  }

  /**
   * Mark an `approved` link `broken` after a definitive refusal from the host (decision 6).
   * Resolves to null when the link is gone or no longer approved (another attempt got there first).
   */
  async markBroken(id: string, reason: string): Promise<GitRepositoryLinkRow | null> {
    try {
      return await this.#move(id, ["approved"], "marked broken", { state: "broken", reason });
    } catch (error) {
      if (error instanceof GitLinkStateError) return null;
      throw error;
    }
  }

  /**
   * Return a `broken` link to `approved` with the pins it had: its connection came back (a
   * configured connection restored). A reconnect with a fresh coverage check uses `approve`.
   * @throws GitLinkStateError from any other state.
   */
  async restore(id: string): Promise<GitRepositoryLinkRow> {
    return await this.#move(id, ["broken"], "restored", { state: "approved", reason: null });
  }

  /**
   * Record what delivery learned for an `approved` link: the repository id of a link approved by
   * configuration, or the installation that now covers it. Only an approved link changes.
   */
  async pin(id: string, pins: GitLinkPins): Promise<GitRepositoryLinkRow | null> {
    try {
      return await this.#move(id, ["approved"], "pinned", {
        hostRepositoryId: pins.hostRepositoryId,
        installationId: pins.installationId ?? null,
      });
    } catch (error) {
      if (error instanceof GitLinkStateError) return null;
      throw error;
    }
  }

  /**
   * Change a link's repository, connection or prefix. A real change returns it to `pending` and
   * forgets its approval and pins, so it posts nothing until approved again; an unchanged request
   * leaves it as it is.
   * @throws GitRepositoryTakenError when the new key is held by another link or a channel.
   */
  async change(id: string, change: GitLinkChange): Promise<GitRepositoryLinkRow> {
    const link = await this.get(id);
    if (link === null) {
      throw new GitLinkStateError("changed", null);
    }
    const key = linkKeyOf({ ...link, ...change });
    const connectionId = change.connectionId ?? link.connectionId;
    if (
      sameLinkKey(key, link) &&
      key.prefix === link.prefix &&
      connectionId === link.connectionId
    ) {
      return link;
    }
    await this.#assertFree(key, id);
    return await this.#write(id, {
      ...key,
      connectionId,
      state: "pending",
      reason: null,
      hostRepositoryId: null,
      installationId: null,
      approvedBy: null,
      approvedAt: null,
    });
  }

  /** Store the project's output choices (decision 10); the gate is not one of them. */
  async setOutputs(id: string, outputs: StateOutputs): Promise<GitRepositoryLinkRow> {
    return await this.#write(id, { outputs: JSON.stringify(outputs) });
  }

  /** Delete a link: delivery to its repository stops. */
  async remove(id: string): Promise<void> {
    await this.#db.remove(this.#tables.gitRepositoryLinks, id);
  }

  /**
   * Apply `values` only while the link is still in the state it was read in, and only when that
   * state is one of `from`; a concurrent move in between makes the write miss, which throws.
   */
  async #move(
    id: string,
    from: readonly GitRepositoryLinkState[],
    action: string,
    values: Partial<GitRepositoryLinkRow>,
  ): Promise<GitRepositoryLinkRow> {
    const current = await this.get(id);
    if (current === null || !from.includes(current.state)) {
      throw new GitLinkStateError(action, current?.state ?? null);
    }
    const table = this.#tables.gitRepositoryLinks;
    const row = (await this.#db.updateWhere(
      table,
      id,
      { ...values, updatedAt: new Date().toISOString() },
      eq(col(table, "state"), current.state),
    )) as unknown as GitRepositoryLinkRow | null;
    if (row === null || !moved(row, values)) {
      throw new GitLinkStateError(action, row?.state ?? null);
    }
    return row;
  }

  async #write(id: string, values: Partial<GitRepositoryLinkRow>): Promise<GitRepositoryLinkRow> {
    return (await this.#db.update(this.#tables.gitRepositoryLinks, id, {
      ...values,
      updatedAt: new Date().toISOString(),
    })) as unknown as GitRepositoryLinkRow;
  }

  async #assertFree(key: LinkKey, self: string | null): Promise<void> {
    if (await this.#channelHolds(key)) {
      throw new GitRepositoryTakenError("channel");
    }
    const holder = await this.findByKey(key);
    if (holder !== null && holder.id !== self) {
      throw new GitRepositoryTakenError("link");
    }
  }

  async #channelHolds(key: LinkKey): Promise<boolean> {
    const rows = (await this.#db.list(
      this.#tables.notificationChannels,
    )) as unknown as NotificationChannelRow[];
    return rows.some((row) => channelHoldsKey(row, key));
  }
}

/** Whether the guarded write took: every written value is on the row it answered. */
function moved(row: GitRepositoryLinkRow, values: Partial<GitRepositoryLinkRow>): boolean {
  return Object.entries(values).every(
    ([field, value]) => (row as unknown as Record<string, unknown>)[field] === value,
  );
}
