/**
 * Row types of `git_connections` and `git_repository_links` (ADR 0054): one credential per git
 * host account, and the repositories a project links through it.
 */

/** How a connection authenticates against its host. */
export type GitConnectionProvider = "github-app" | "gitlab-token";

/** A configured or operator-created connection to a git host. */
export interface GitConnectionRow {
  /** Stable id; a connection that comes from configuration keeps the id it is configured with. */
  id: string;
  provider: GitConnectionProvider;
  name: string;
  /** API base of the host (GitHub Enterprise Server, self-managed GitLab); null for the public host. */
  apiBase: string | null;
  /** JSON, never secrets: app id, account, permissions ceiling, token expiry. */
  config: string;
  /** AES-256-GCM secret (app private key or token); rotated with the other credentials. */
  secretEncrypted: string | null;
  /** User that created it; null for a configured connection. */
  createdBy: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
}

/** Where a repository link stands. */
export type GitRepositoryLinkState = "pending" | "approved" | "refused" | "broken";

/** A project's link to one repository (and status prefix) through a connection. */
export interface GitRepositoryLinkRow {
  id: string;
  projectId: string;
  connectionId: string;
  /** Host of the connection's API, lower case; part of the uniqueness key. */
  host: string;
  /** Repository owner, lower case. */
  owner: string;
  /** Repository name, lower case. */
  repo: string;
  /** The host's own repository id, once known. */
  hostRepositoryId: string | null;
  /** Status-name prefix; the empty string when the link uses the default. */
  prefix: string;
  state: GitRepositoryLinkState;
  /** Why a link is `refused` or `broken`, as shown to the project. */
  reason: string | null;
  /** JSON of what the link posts: storybook status, comment mode, annotations. */
  outputs: string;
  /** Cached installation id of a GitHub App connection. */
  installationId: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
