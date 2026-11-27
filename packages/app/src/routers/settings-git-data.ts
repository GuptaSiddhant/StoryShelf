/**
 * What Project → Settings → Git shows: the project's repository links joined with their
 * connections. The section exists only while the server has a git connection (ADR 0054; owner,
 * 2026-11-16): without one, project admins never see it.
 */
import { DEFAULT_STATUS_PREFIX } from "@storyshelf/core/adapter/notifier";
import { postsComments } from "@storyshelf/core/build-state";
import { listCoveredRepositories } from "@storyshelf/core/integrations";
import {
  anyRepositoryLinkAllowed,
  GitRepositoryLinkModel,
  linkOutputsOf,
  SiteSettingsModel,
  type GitConnection,
} from "@storyshelf/core/models";
import type { GitRepositoryLinkRow, Project } from "@storyshelf/core/schema";
import { redactSecrets } from "@storyshelf/core/utils";
import { gitConnectionModel } from "../git-admin.ts";
import { proposedPrefix, webHostOf } from "../git-link-request.ts";
import type {
  PickerRepository,
  RepositoryPicker,
  SettingsGitData,
  SettingsGitLink,
} from "../pages/settings-git.tsx";
import { getStore } from "../store.ts";

/** The server's usable git connections (a stored row shadowed by configuration is not one). */
export async function usableConnections(): Promise<GitConnection[]> {
  const all = await gitConnectionModel().list();
  return all.filter((connection) => !connection.ignored);
}

/** Whether configuration declares this link (matched by project id or slug, repository, prefix). */
function isManaged(project: Project, link: GitRepositoryLinkRow): boolean {
  return (getStore().gitConfiguredLinks ?? []).some(
    (entry) =>
      (entry.project === project.id || entry.project === project.slug) &&
      entry.connection === link.connectionId &&
      entry.repository.toLowerCase() === `${link.owner}/${link.repo}` &&
      (entry.prefix ?? "") === link.prefix,
  );
}

function viewOf(
  project: Project,
  link: GitRepositoryLinkRow,
  connections: readonly GitConnection[],
): SettingsGitLink {
  const connection = connections.find((candidate) => candidate.id === link.connectionId);
  return {
    id: link.id,
    repository: `${link.owner}/${link.repo}`,
    url: connection
      ? `https://${webHostOf(connection)}/${link.owner}/${link.repo}`
      : `${link.owner}/${link.repo}`,
    prefix: link.prefix.length > 0 ? link.prefix : DEFAULT_STATUS_PREFIX,
    connectionName: connection?.name ?? "Removed connection",
    state: link.state,
    managed: isManaged(project, link),
    reason: link.reason,
    lastDeliveredAt: link.lastDeliveredAt,
    outputs: linkOutputsOf(link),
    commentAllowed: connection === undefined ? false : postsComments(connection),
  };
}

/** The Git section's data, or null while the server has no connection. */
export async function loadGitSection(project: Project): Promise<SettingsGitData | null> {
  const connections = await usableConnections();
  if (connections.length === 0) {
    return null;
  }
  const rows = await new GitRepositoryLinkModel(getStore().db).list(project.id);
  const links = rows.map((row) => viewOf(project, row, connections));
  return {
    links,
    proposedPrefix: proposedPrefix(project.slug, new Set(links.map((link) => link.prefix))),
  };
}

/** A listing is bounded, so a slow host never holds the form. */
const LIST_TIMEOUT_MS = 10_000;

/**
 * The repositories the server's connections cover, for the link form's picker, or undefined while
 * the operator switch is off: then the provider is never asked, so coverage cannot leak. A
 * connection that fails is skipped and the list is marked cut short; when none can be listed the
 * form falls back to the typed URL.
 */
export async function loadRepositoryPicker(): Promise<RepositoryPicker | undefined> {
  const store = getStore();
  if (!(await anyRepositoryLinkAllowed(new SiteSettingsModel(store.db)))) {
    return undefined;
  }
  const connections = await usableConnections();
  const listings = await Promise.all(
    connections.map(async (connection) => await listOne(connection, connections.length > 1)),
  );
  const repositories = listings.flatMap((listing) => listing?.repositories ?? []);
  if (repositories.length === 0 && listings.every((listing) => listing === null)) {
    return { listed: false };
  }
  return {
    listed: true,
    repositories,
    truncated: listings.some((listing) => listing === null || listing.truncated),
  };
}

/** One connection's repositories, or null when it cannot be listed (logged without a secret). */
async function listOne(
  connection: GitConnection,
  several: boolean,
): Promise<{ repositories: PickerRepository[]; truncated: boolean } | null> {
  const store = getStore();
  try {
    const secret = await gitConnectionModel(store).secretOf(connection.id);
    if (secret === null) {
      return null;
    }
    const covered = await listCoveredRepositories(connection, secret, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    const host = webHostOf(connection);
    return {
      truncated: covered.truncated,
      repositories: covered.repositories.map(({ fullName }) => ({
        url: `https://${host}/${fullName}`,
        label: several ? `${fullName} (${connection.name})` : fullName,
      })),
    };
  } catch (error) {
    store.logger.warn(
      {
        connectionId: connection.id,
        reason: redactSecrets(error instanceof Error ? error.message : "failed"),
      },
      "git repository listing failed",
    );
    return null;
  }
}
