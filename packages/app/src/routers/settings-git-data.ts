/**
 * What Project → Settings → Git shows: the project's repository links joined with their
 * connections. The section exists only while the server has a git connection (ADR 0054; owner,
 * 2026-11-16): without one, project admins never see it.
 */
import { DEFAULT_STATUS_PREFIX } from "@storyshelf/core/adapter/notifier";
import { postsComments } from "@storyshelf/core/capture";
import { GitRepositoryLinkModel, linkOutputsOf, type GitConnection } from "@storyshelf/core/models";
import type { GitRepositoryLinkRow, Project } from "@storyshelf/core/schema";
import { proposedPrefix } from "../git-link-request.ts";
import type { SettingsGitData, SettingsGitLink } from "../pages/settings-git.tsx";
import { getStore } from "../store.ts";

/** The server's usable git connections (a stored row shadowed by configuration is not one). */
export async function usableConnections(): Promise<GitConnection[]> {
  const all = (await getStore().gitConnections?.list()) ?? [];
  return all.filter((connection) => !connection.ignored);
}

/** Whether configuration declares this link (matched by project id or slug, repository, prefix). */
function isManaged(project: Project, link: GitRepositoryLinkRow): boolean {
  return (getStore().gitConfiguredLinks ?? []).some(
    (entry) =>
      (entry.project === project.id || entry.project === project.slug) &&
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
    prefix: link.prefix.length > 0 ? link.prefix : DEFAULT_STATUS_PREFIX,
    connectionName: connection?.name ?? "Removed connection",
    state: link.state,
    managed: isManaged(project, link),
    reason: link.reason,
    lastDeliveredAt: null,
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
