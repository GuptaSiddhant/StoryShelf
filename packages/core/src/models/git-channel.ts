/**
 * Per-project git channels while they remain (ADR 0054, decision 8). From release N+1 no new one is
 * accepted: a site admin moves each to an approved repository link, and in release N+2
 * ({@link GIT_CHANNELS_STOP_RELEASE}) a channel nobody moved stops posting.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { GitConnectionProvider } from "../schema/git-connection.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { channelKeyOf, connectionHost } from "./git-link-key.ts";

/** The release in which per-project git credentials are removed and unmoved channels stop (#1125). */
export const GIT_CHANNELS_STOP_RELEASE = "0.19.0";

/** Why a new per-project git channel is refused, and where to go instead. */
export const GIT_CHANNELS_CLOSED =
  "Per-project git channels are no longer accepted. A site admin connects GitHub or GitLab once " +
  "for the server on System › Git; then link the repository on Project → Settings › Git.";

/** How a channel authenticates: a GitHub App's key, a GitHub token, or a GitLab token. */
export type GitChannelKind = "github-app" | "github-token" | "gitlab-token";

/** A project's git channel, as the move reads it: never its secret. */
export interface PerProjectGitChannel {
  id: string;
  projectId: string;
  kind: GitChannelKind;
  /** API host, lower case (`api.github.com`, `gitlab.example.com`). */
  host: string;
  /** Owner and repository, lower case, as a link stores them. */
  owner: string;
  repo: string;
  /** The status prefix; the empty string is the default, as on a link. */
  prefix: string;
  /** A GitHub App channel's App id; null otherwise. */
  appId: string | null;
  /** The API base the channel posts to; null for the public host. */
  apiUrl: string | null;
  enabled: boolean;
  /** The row's last change: a move posts it back, so a channel edited meanwhile is not moved. */
  updatedAt: string;
}

/** The project git channel a row holds, or null for any other row. */
export function perProjectGitChannelOf(row: NotificationChannelRow): PerProjectGitChannel | null {
  const key = channelKeyOf(row);
  if (key === null || row.projectId === null) {
    return null;
  }
  const config = parseConfig(row.config);
  const app = row.provider === "github" && config["mode"] === "checks";
  const apiUrl = row.provider === "github" ? config["apiUrl"] : config["host"];
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.provider === "gitlab" ? "gitlab-token" : app ? "github-app" : "github-token",
    ...key,
    appId: app && typeof config["appId"] === "string" ? config["appId"] : null,
    apiUrl: typeof apiUrl === "string" && apiUrl !== "" ? apiUrl : null,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

/** Every project's git channel, oldest first. */
export async function listPerProjectGitChannels(
  db: DatabaseAdapter,
): Promise<PerProjectGitChannel[]> {
  const rows = (await db.list(
    db.tables.notificationChannels,
  )) as unknown as NotificationChannelRow[];
  return rows
    .map((row) => perProjectGitChannelOf(row))
    .filter((channel): channel is PerProjectGitChannel => channel !== null)
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

/** The connection provider a channel moves to: GitHub channels to an App (never a token). */
export function connectionProviderFor(
  channel: Pick<PerProjectGitChannel, "kind">,
): GitConnectionProvider {
  return channel.kind === "gitlab-token" ? "gitlab-token" : "github-app";
}

/** Whether a connection can take over a channel: the right provider on the same API host. */
export function connectionFits(
  channel: Pick<PerProjectGitChannel, "kind" | "host">,
  connection: { provider: string; apiBase: string | null; ignored?: boolean },
): boolean {
  return (
    connection.ignored !== true &&
    connection.provider === connectionProviderFor(channel) &&
    connectionHost(connection.provider, connection.apiBase) === channel.host
  );
}

function parseConfig(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
