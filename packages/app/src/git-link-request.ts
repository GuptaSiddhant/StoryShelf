/**
 * What a project admin types into the repository-link form (ADR 0054, decision 2): a repository
 * URL and a status prefix. The URL names the host, the host picks the server's connection, and
 * nothing here tells the admin whether the repository exists or is covered.
 */
import { connectionHost } from "@storyshelf/core/models";
import type { GitConnection } from "@storyshelf/core/models";

/** A repository named by a URL or an `owner/repo` path. */
export interface ParsedRepository {
  /** Lower-case web host (`github.com`), or null when only `owner/repo` was typed. */
  host: string | null;
  owner: string;
  repo: string;
}

const REPOSITORY_PATH = /^\/?(?<owner>[\w.-]+(?:\/[\w.-]+)*)\/(?<repo>[\w.-]+?)(?:\.git)?\/?$/u;

function fromPath(host: string | null, path: string): ParsedRepository | null {
  const groups = REPOSITORY_PATH.exec(path)?.groups;
  return groups?.["owner"] !== undefined && groups["repo"] !== undefined
    ? { host, owner: groups["owner"], repo: groups["repo"] }
    : null;
}

/** `https://github.com/acme/widgets`, `…/widgets.git` or `acme/widgets`; null for anything else. */
export function parseRepositoryUrl(text: string): ParsedRepository | null {
  const value = text.trim();
  if (value.length === 0 || value.length > 300) {
    return null;
  }
  if (!value.includes("://")) {
    return fromPath(null, value);
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? fromPath(url.host.toLowerCase(), url.pathname) : null;
  } catch {
    return null;
  }
}

/** The host people browse a connection's repositories on: `github.com` for the public API host. */
export function webHostOf(connection: Pick<GitConnection, "provider" | "apiBase">): string {
  const host = connectionHost(connection.provider, connection.apiBase);
  return host === "api.github.com" ? "github.com" : host;
}

/**
 * The connection a repository URL belongs to: the one on its host, or the only connection when
 * `owner/repo` was typed without a host. Null when none or several match (the form then says to
 * type the full URL; it does not say which hosts exist).
 */
export function connectionFor(
  connections: readonly GitConnection[],
  repository: ParsedRepository,
): GitConnection | null {
  const usable = connections.filter((connection) => !connection.ignored);
  const matches =
    repository.host === null
      ? usable
      : usable.filter((connection) => webHostOf(connection) === repository.host);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** The prefix a form proposes: the default while free, then the project slug, then slug-N. */
export function proposedPrefix(slug: string, taken: ReadonlySet<string>): string {
  const base = slug.toLowerCase().replaceAll(/[^a-z0-9-]/gu, "-");
  if (!taken.has("storyshelf")) {
    return "storyshelf";
  }
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/** Why a prefix is refused, or null: letters, digits, `-`, `_` and `.`, at most 40 characters. */
export function prefixProblem(prefix: string): string | null {
  return /^[\w.-]{1,40}$/u.test(prefix)
    ? null
    : "Use 1–40 letters, digits, dots, dashes or underscores";
}
