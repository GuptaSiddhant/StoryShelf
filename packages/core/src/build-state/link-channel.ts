/**
 * The channel a repository link is delivered as (ADR 0054, decision 7): the GitHub or GitLab
 * provider's own config, built from the link and its connection, pinned to the approved repository
 * id. The provider then requests a GitHub installation token for that id only, or addresses the
 * GitLab project by its numeric id.
 */
import type { NotificationChannel } from "../adapters/notifier/types.ts";
import type { GitConnection } from "../models/git-connection.ts";
import type { GitRepositoryLinkRow } from "../schema/git-connection.ts";

/**
 * The channel a link is delivered as: the provider's own config, pinned to the repository id (and,
 * on GitHub, the installation). Null for a provider links do not support or a link without pins.
 */
export function linkChannel(
  link: GitRepositoryLinkRow,
  connection: Pick<GitConnection, "provider" | "apiBase" | "config">,
  secret: string,
): NotificationChannel | null {
  const config = linkConfig(link, connection);
  return config === null
    ? null
    : {
        id: link.id,
        projectId: link.projectId,
        provider: config.provider,
        config: config.values,
        secret,
        events: [],
        enabled: true,
      };
}

type LinkConnectionView = Pick<GitConnection, "provider" | "apiBase" | "config">;

function linkConfig(
  link: GitRepositoryLinkRow,
  connection: LinkConnectionView,
): { provider: string; values: Record<string, unknown> } | null {
  const repositoryId = link.hostRepositoryId;
  if (repositoryId === null) {
    return null;
  }
  if (connection.provider === "github-app") {
    return link.installationId === null
      ? null
      : { provider: "github", values: githubValues(link, connection, link.installationId) };
  }
  if (connection.provider === "gitlab-token") {
    const host = connection.apiBase === null ? {} : { host: connection.apiBase };
    return {
      provider: "gitlab",
      values: { ...repositoryOf(link), ...host, projectId: repositoryId },
    };
  }
  return null;
}

/** A GitHub App channel in `checks` mode, its token limited to the pinned repository id. */
function githubValues(
  link: GitRepositoryLinkRow,
  connection: LinkConnectionView,
  installationId: string,
): Record<string, unknown> {
  const appId = connection.config["appId"];
  return {
    ...repositoryOf(link),
    ...(connection.apiBase === null ? {} : { apiUrl: connection.apiBase }),
    mode: "checks",
    appId: typeof appId === "number" ? String(appId) : appId,
    installationId,
    repositoryId: link.hostRepositoryId,
  };
}

function repositoryOf(link: GitRepositoryLinkRow): Record<string, unknown> {
  return { owner: link.owner, repo: link.repo, ...prefixOf(link) };
}

function prefixOf(link: GitRepositoryLinkRow): { prefix?: string } {
  return link.prefix.length > 0 ? { prefix: link.prefix } : {};
}

/** Whether the connection may post the pull-request comment (its ceiling; GitLab's `api` scope may). */
export function postsComments(connection: Pick<GitConnection, "config">): boolean {
  const posts = connection.config["posts"];
  return !(
    typeof posts === "object" &&
    posts !== null &&
    (posts as Record<string, unknown>)["pullRequests"] === false
  );
}
