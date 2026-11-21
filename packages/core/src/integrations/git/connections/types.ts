/** Types of server-wide git connections and the links declared with them (ADR 0054). */
import type { ConfiguredGitConnection } from "../../../schema/git-connection.ts";

export type { ConfiguredGitConnection };

/** A repository link declared in configuration: approved, and managed by configuration. */
export interface GitLinkConfig {
  /** The `id` of a connection (configured or stored). */
  connection: string;
  /** Project id or slug. */
  project: string;
  /** `owner/repo` (a GitLab group path may hold further slashes). */
  repository: string;
  /** Status-name prefix; absent means the default. */
  prefix?: string;
}

/** `ShelfOptions.git`: connections and links managed by configuration. */
export interface ShelfGitOptions {
  connections?: ConfiguredGitConnection[];
  links?: GitLinkConfig[];
}

/** What posting a GitHub App may do beyond the required check runs (ADR 0054, decision 10). */
export interface GitHubAppPosts {
  /** The pull-request comment (Pull requests: write). */
  pullRequests?: boolean;
  /** Plain commit statuses instead of check runs (Commit statuses: write). */
  statuses?: boolean;
}

/** Input of {@link githubApp}. */
export interface GitHubAppInput {
  id: string;
  appId: string | number;
  /** PEM private key; a one-line key with literal `\n` is accepted. */
  privateKey: string;
  /** GitHub Enterprise Server API base (`https://ghes.example.com/api/v3`). */
  apiUrl?: string | undefined;
  name?: string | undefined;
  posts?: GitHubAppPosts | undefined;
}

/** Input of {@link gitlabGroup}. */
export interface GitLabGroupInput {
  id: string;
  /** GitLab origin, e.g. `https://gitlab.com`. */
  host: string;
  /** A group or project access token with the `api` scope. */
  token: string;
  /** The token's expiry, `YYYY-MM-DD`; site admins are warned 30 days before. */
  expiresOn: string;
  name?: string | undefined;
}
