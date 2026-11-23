/**
 * The uniqueness key of a repository link (ADR 0054, decision 3): host, repository and prefix, all
 * compared the way the host compares them. Per-project git channels count too while they remain.
 */
import { DEFAULT_STATUS_PREFIX } from "../adapters/notifier/state.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";

/** Host, owner and repository in lower case, and the prefix as stored (empty = default). */
export interface LinkKey {
  host: string;
  owner: string;
  repo: string;
  prefix: string;
}

/** The key of a request: lower-cased host and repository; an absent prefix is the default. */
export function linkKeyOf(input: {
  host: string;
  owner: string;
  repo: string;
  prefix?: string | undefined;
}): LinkKey {
  return {
    host: input.host.toLowerCase(),
    owner: input.owner.toLowerCase(),
    repo: input.repo.toLowerCase(),
    prefix: input.prefix ?? "",
  };
}

/** Whether two keys name the same gate: same repository on the same host under the same prefix. */
export function sameLinkKey(a: LinkKey, b: LinkKey): boolean {
  return (
    a.host === b.host &&
    a.owner === b.owner &&
    a.repo === b.repo &&
    effectivePrefix(a.prefix) === effectivePrefix(b.prefix)
  );
}

/** Whether a project's git channel posts to the gate `key` names. */
export function channelHoldsKey(row: NotificationChannelRow, key: LinkKey): boolean {
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
}

/**
 * The host a connection's API answers on, lower case: a GitHub App's API base (api.github.com by
 * default) or a GitLab origin (gitlab.com by default). Links of the connection carry it.
 */
export function connectionHost(provider: string, apiBase: string | null): string {
  const fallback = provider === "gitlab-token" ? "gitlab.com" : "api.github.com";
  return hostOf(apiBase) ?? fallback;
}

/** Host of a channel's API: GitHub's `apiUrl` or GitLab's `host`, else the public host of its provider. */
function channelHost(provider: string, config: Record<string, unknown>): string {
  const url = provider === "gitlab" ? config["host"] : config["apiUrl"];
  return hostOf(url) ?? (provider === "gitlab" ? "gitlab.com" : "api.github.com");
}

function hostOf(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    // An unparsable value never matches a real host.
    return null;
  }
}

function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b;
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
