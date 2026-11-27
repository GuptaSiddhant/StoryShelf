/**
 * The repositories a git connection covers (ADR 0054, decision 2), for the repository picker that
 * shows only while the operator switch lets project admins link any covered repository: a GitHub
 * App's installation repositories, a GitLab token's group projects. Every list is paginated and
 * bounded by {@link MAX_REPOSITORY_PAGES}; a list cut short says so (`truncated`). A failure throws
 * {@link RepositoryListError}, whose message names the host and an HTTP status only, never a body,
 * a URL or a credential, so a caller may log or show it.
 */
import { HttpError, httpJson } from "../../../utils/index.ts";
import { apiBase as githubApiBase, githubHeaders } from "../github-api.ts";
import { signAppJwt } from "../github-app.ts";
import { apiBase as gitlabApiBase, gitlabHeaders } from "../gitlab-api.ts";
import type { LinkConnection } from "./link-host.ts";

/** Hard cap on host pages read for one listing, across installations. */
export const MAX_REPOSITORY_PAGES = 5;

/** Repositories asked per page (the maximum both hosts allow). */
export const REPOSITORIES_PER_PAGE = 100;

/** At most this many installations of one App are read. */
export const MAX_INSTALLATIONS = 10;

/** One covered repository, as `owner/repo` (a GitLab path may hold subgroups). */
export interface CoveredRepository {
  fullName: string;
}

/** The covered repositories, sorted, and whether the list was cut short by a cap. */
export interface CoveredRepositories {
  repositories: CoveredRepository[];
  truncated: boolean;
}

/** Options of {@link listCoveredRepositories}. */
export interface ListRepositoriesOptions {
  now?: number;
  /** Bounds the whole listing. */
  signal?: AbortSignal;
}

/** The listing failed; the message is safe to log and to show (host and status only). */
export class RepositoryListError extends Error {
  constructor(host: string, cause: unknown) {
    super(
      cause instanceof HttpError ? `${host} answered HTTP ${cause.status}` : `${host} unreachable`,
    );
    this.name = "RepositoryListError";
  }
}

/** Pages left to read: shared by every request of one listing. */
interface Budget {
  pages: number;
  truncated: boolean;
  signal: AbortSignal | undefined;
}

/**
 * The repositories `connection` covers, read with its decrypted `secret`. Throws
 * {@link RepositoryListError} when the host refuses or cannot be reached.
 */
export async function listCoveredRepositories(
  connection: LinkConnection,
  secret: string,
  options: ListRepositoriesOptions = {},
): Promise<CoveredRepositories> {
  const budget: Budget = { pages: MAX_REPOSITORY_PAGES, truncated: false, signal: options.signal };
  const github = connection.provider === "github-app";
  if (!github && connection.provider !== "gitlab-token") {
    return { repositories: [], truncated: false };
  }
  try {
    const names = github
      ? await githubRepositories(connection, secret, options.now ?? Date.now(), budget)
      : await gitlabRepositories(connection, secret, budget);
    return {
      repositories: [...new Set(names)].toSorted().map((fullName) => ({ fullName })),
      truncated: budget.truncated,
    };
  } catch (error) {
    throw new RepositoryListError(github ? "GitHub" : "GitLab", error);
  }
}

/**
 * Read pages of `url` until a short page, the page cap or the shared budget. `names` maps one
 * page's answer to repository names.
 */
async function readPages(
  url: string,
  headers: Record<string, string>,
  budget: Budget,
  names: (answer: unknown) => string[],
  page = 1,
): Promise<string[]> {
  if (budget.pages <= 0) {
    budget.truncated = true;
    return [];
  }
  budget.pages -= 1;
  const answer = await httpJson<unknown>(`${url}${url.includes("?") ? "&" : "?"}page=${page}`, {
    headers,
    retries: 1,
    ...(budget.signal ? { signal: budget.signal } : {}),
  });
  const batch = names(answer);
  return batch.length < REPOSITORIES_PER_PAGE
    ? batch
    : [...batch, ...(await readPages(url, headers, budget, names, page + 1))];
}

function stringsOf(list: unknown, key: string): string[] {
  return Array.isArray(list)
    ? (list as unknown[]).flatMap((entry) => {
        const value =
          typeof entry === "object" && entry !== null
            ? (entry as Record<string, unknown>)[key]
            : undefined;
        return typeof value === "string" ? [value] : [];
      })
    : [];
}

async function githubRepositories(
  connection: LinkConnection,
  privateKey: string,
  now: number,
  budget: Budget,
): Promise<string[]> {
  const raw = connection.config["appId"];
  const appId = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  const base = githubApiBase(connection.apiBase ?? undefined);
  const headers = githubHeaders(signAppJwt({ appId, privateKey }, now));
  const all = await readPages(
    `${base}/app/installations?per_page=${REPOSITORIES_PER_PAGE}`,
    headers,
    budget,
    idsOf,
  );
  budget.truncated ||= all.length > MAX_INSTALLATIONS;
  const lists = await Promise.all(
    all
      .slice(0, MAX_INSTALLATIONS)
      .map(async (id) => await installationRepositories(base, headers, id, budget)),
  );
  return lists.flat();
}

function idsOf(list: unknown): string[] {
  return Array.isArray(list)
    ? (list as unknown[]).flatMap((entry) => {
        const id =
          typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : null;
        return typeof id === "number" ? [String(id)] : [];
      })
    : [];
}

/** One installation's repositories, read with a short-lived token that is never kept or logged. */
async function installationRepositories(
  base: string,
  appHeaders: Record<string, string>,
  installationId: string,
  budget: Budget,
): Promise<string[]> {
  const grant = await httpJson<{ token?: unknown }>(
    `${base}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: appHeaders,
      json: { permissions: { metadata: "read" } },
      retries: 1,
      ...(budget.signal ? { signal: budget.signal } : {}),
    },
  );
  if (typeof grant.token !== "string") {
    throw new TypeError("GitHub answered without an installation token");
  }
  return await readPages(
    `${base}/installation/repositories?per_page=${REPOSITORIES_PER_PAGE}`,
    githubHeaders(grant.token),
    budget,
    (answer) => stringsOf((answer as { repositories?: unknown } | null)?.repositories, "full_name"),
  );
}

/** The group's projects (subgroups included); a token with no group lists the projects it is a member of. */
async function gitlabRepositories(
  connection: LinkConnection,
  token: string,
  budget: Budget,
): Promise<string[]> {
  const base = gitlabApiBase(connection.apiBase ?? undefined);
  const group = connection.config["group"];
  const path =
    typeof group === "string" && group.length > 0
      ? `/groups/${encodeURIComponent(group)}/projects?include_subgroups=true`
      : "/projects?membership=true";
  return await readPages(
    `${base}/api/v4${path}&simple=true&archived=false&per_page=${REPOSITORIES_PER_PAGE}`,
    gitlabHeaders(token),
    budget,
    (list) => stringsOf(list, "path_with_namespace"),
  );
}
