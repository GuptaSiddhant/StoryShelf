/**
 * Server-wide git connections declared in configuration (ADR 0054, decision 9): `githubApp` and
 * `gitlabGroup` build them, and `assertGitOptions` checks a whole `ShelfOptions.git` at startup.
 *
 * A configured connection's secret is read at startup and never written to the database. It is held
 * behind `readSecret()`, a function, so serializing or logging the connection (JSON, pino,
 * `util.inspect`) can never print the key or token.
 */
import { createPrivateKey } from "node:crypto";
import type { GitConnectionProvider } from "../../../schema/git-connection.ts";
import { apiBase as githubApiBase } from "../github-api.ts";
import type {
  ConfiguredGitConnection,
  GitHubAppInput,
  GitLabGroupInput,
  GitLinkConfig,
  ShelfGitOptions,
} from "./types.ts";

const ID_PATTERN = /^[A-Za-z0-9][\w-]{0,63}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** A GitHub App connection, from code or the environment. Throws (naming the id, never the key) on bad input. */
export function githubApp(input: GitHubAppInput): ConfiguredGitConnection {
  const id = checkId(input.id);
  const appId = String(input.appId).trim();
  if (!/^\d+$/u.test(appId)) {
    throw new TypeError(`git connection "${id}": appId must be a number`);
  }
  const privateKey = input.privateKey.replaceAll(String.raw`\n`, "\n").trim();
  assertPrivateKey(id, privateKey);
  const apiBase = input.apiUrl ? githubApiBase(checkUrl(id, "apiUrl", input.apiUrl)) : null;
  return freeze(id, "github-app", input.name ?? "GitHub App", apiBase, privateKey, {
    appId,
    posts: {
      pullRequests: input.posts?.pullRequests ?? true,
      statuses: input.posts?.statuses ?? false,
    },
  });
}

/** A GitLab group (or project) access-token connection. Throws (naming the id, never the token) on bad input. */
export function gitlabGroup(input: GitLabGroupInput): ConfiguredGitConnection {
  const id = checkId(input.id);
  const host = new URL(checkUrl(id, "host", input.host)).origin;
  const token = input.token.trim();
  if (token === "") {
    throw new TypeError(`git connection "${id}": token is empty`);
  }
  if (!DATE_PATTERN.test(input.expiresOn) || Number.isNaN(Date.parse(input.expiresOn))) {
    throw new TypeError(`git connection "${id}": expiresOn must be a date (YYYY-MM-DD)`);
  }
  return freeze(id, "gitlab-token", input.name ?? "GitLab", host, token, {
    expiresOn: input.expiresOn,
  });
}

/**
 * Check `ShelfOptions.git` once at startup: connection ids are unique, and every link names a
 * configured connection or a stored one (`storedIds`, when known) with an `owner/repo` repository.
 */
export function assertGitOptions(git: ShelfGitOptions, storedIds?: ReadonlySet<string>): void {
  const ids = uniqueIds(git);
  for (const link of git.links ?? []) {
    assertLink(link, ids.has(link.connection) || (storedIds?.has(link.connection) ?? true));
  }
}

function uniqueIds(git: ShelfGitOptions): Set<string> {
  const ids = new Set<string>();
  for (const connection of git.connections ?? []) {
    if (ids.has(connection.id)) {
      throw new TypeError(`git connection "${connection.id}" is configured twice`);
    }
    ids.add(connection.id);
  }
  return ids;
}

function assertLink(link: GitLinkConfig, known: boolean): void {
  if (!known) {
    throw new TypeError(
      `git link "${link.repository}" names unknown connection "${link.connection}"`,
    );
  }
  if (!/^[^/\s]+(?:\/[^/\s]+)+$/u.test(link.repository)) {
    throw new TypeError(`git link "${link.repository}" must name a repository as owner/repo`);
  }
}

function freeze(
  id: string,
  provider: GitConnectionProvider,
  name: string,
  apiBase: string | null,
  secret: string,
  config: Record<string, unknown>,
): ConfiguredGitConnection {
  return Object.freeze({
    id,
    provider,
    name,
    apiBase,
    config: Object.freeze(config),
    readSecret: () => secret,
  });
}

function checkId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(`git connection id "${id}" must be 1-64 letters, digits, "_" or "-"`);
  }
  return id;
}

function checkUrl(id: string, field: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`git connection "${id}": ${field} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`git connection "${id}": ${field} must be http(s)`);
  }
  return value;
}

/** Parse the key once, so a bad key fails at startup; the parser's message never carries it. */
function assertPrivateKey(id: string, pem: string): void {
  try {
    createPrivateKey(pem);
  } catch {
    throw new TypeError(`git connection "${id}": privateKey is not a PEM private key`);
  }
}
