/**
 * Repository links declared in configuration (ADR 0054, decision 9), applied once at startup. A
 * configured link counts as approved and follows decision 3: it is created approved, or an existing
 * link of the same project on the same repository and prefix is approved by configuration. A link
 * held by another project or a git channel is not taken over; it is reported. Links whose
 * connection is gone are marked `broken` instead of deleted, so restoring the connection (in
 * configuration or the database) restores them at the next start.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { GitLinkConfig } from "../integrations/git/connections/types.ts";
import type { Logger } from "../logger.ts";
import type { GitRepositoryLinkRow } from "../schema/git-connection.ts";
import type { Project } from "../schema/project.ts";
import type { GitConnection, GitConnectionModel } from "./git-connection.ts";
import { connectionHost, linkKeyOf } from "./git-link-key.ts";
import { GitRepositoryLinkModel } from "./git-repository-link.ts";
import { GitRepositoryTakenError } from "./git-repository-taken-error.ts";
import { ProjectModel } from "./project.ts";

/** The reason on a link whose connection was removed; the next start restores it once it is back. */
export const CONNECTION_REMOVED_REASON = "Its git connection was removed";

/** What the sync did. */
export interface GitLinkSyncResult {
  /** Ids of the links configuration manages (approved now). */
  managed: string[];
  /** Configured links not applied, with why (unknown project or connection, already taken). */
  skipped: { repository: string; reason: string }[];
  broken: number;
  restored: number;
}

/** What syncing needs. */
export interface GitLinkSyncDeps {
  db: DatabaseAdapter;
  connections: GitConnectionModel;
  logger: Logger;
}

/** Apply `configured` links, then break or restore links by whether their connection exists. */
export async function syncConfiguredLinks(
  deps: GitLinkSyncDeps,
  configured: readonly GitLinkConfig[],
): Promise<GitLinkSyncResult> {
  const result: GitLinkSyncResult = { managed: [], skipped: [], broken: 0, restored: 0 };
  for (const entry of configured) {
    // oxlint-disable-next-line no-await-in-loop -- links are applied in order; two may share a key
    const applied = await applyLink(deps, entry);
    if (typeof applied === "string") {
      result.skipped.push({ repository: entry.repository, reason: applied });
      deps.logger.warn(
        { repository: entry.repository, reason: applied },
        "configured git link not applied",
      );
    } else {
      result.managed.push(applied.id);
    }
  }
  await followConnections(deps, result);
  return result;
}

async function applyLink(
  deps: GitLinkSyncDeps,
  entry: GitLinkConfig,
): Promise<GitRepositoryLinkRow | string> {
  const resolved = await resolveEntry(deps, entry);
  if (typeof resolved === "string") {
    return resolved;
  }
  const { project, connection } = resolved;
  const input = {
    projectId: project.id,
    connectionId: connection.id,
    ...repositoryOf(entry, connection),
  };
  const links = new GitRepositoryLinkModel(deps.db);
  const existing = await links.findByKey(linkKeyOf(input));
  if (existing !== null) {
    return existing.projectId === project.id
      ? await links.approveByConfiguration(existing.id, connection.id)
      : "linked by another project";
  }
  return await createApproved(links, input);
}

/** A new link approved by configuration, or why the repository and prefix are taken. */
async function createApproved(
  links: GitRepositoryLinkModel,
  input: Parameters<GitRepositoryLinkModel["create"]>[0],
): Promise<GitRepositoryLinkRow | string> {
  try {
    return await links.create(input, { approvedBy: null });
  } catch (error) {
    if (error instanceof GitRepositoryTakenError) return `already used by a git ${error.takenBy}`;
    throw error;
  }
}

/** The project (by id or slug) and connection a configured link names, or which one is unknown. */
async function resolveEntry(
  deps: GitLinkSyncDeps,
  entry: GitLinkConfig,
): Promise<{ project: Project; connection: GitConnection } | string> {
  const projects = new ProjectModel(deps.db);
  const project = (await projects.get(entry.project)) ?? (await projects.getBySlug(entry.project));
  const connection = await deps.connections.get(entry.connection);
  if (project === null || connection === null) {
    return project === null ? "unknown project" : "unknown connection";
  }
  return { project, connection };
}

/** Host, owner (a GitLab group path may hold slashes), repository and prefix of a configured link. */
function repositoryOf(
  entry: GitLinkConfig,
  connection: GitConnection,
): { host: string; owner: string; repo: string; prefix?: string } {
  const cut = entry.repository.lastIndexOf("/");
  return {
    host: connectionHost(connection.provider, connection.apiBase),
    owner: entry.repository.slice(0, cut),
    repo: entry.repository.slice(cut + 1),
    ...(entry.prefix === undefined ? {} : { prefix: entry.prefix }),
  };
}

/** Break approved links whose connection is gone; restore those broken only for that reason. */
async function followConnections(deps: GitLinkSyncDeps, result: GitLinkSyncResult): Promise<void> {
  const links = new GitRepositoryLinkModel(deps.db);
  const ids = new Set((await deps.connections.list()).filter((c) => !c.ignored).map((c) => c.id));
  for (const link of await links.listAll()) {
    const present = ids.has(link.connectionId);
    if (link.state === "approved" && !present) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of rows, once per start
      result.broken += (await links.markBroken(link.id, CONNECTION_REMOVED_REASON)) ? 1 : 0;
    } else if (link.state === "broken" && present && link.reason === CONNECTION_REMOVED_REASON) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of rows, once per start
      await links.restore(link.id);
      result.restored += 1;
    }
  }
}
