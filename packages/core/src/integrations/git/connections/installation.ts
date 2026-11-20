/**
 * Which installation of a GitHub App covers a repository (ADR 0054, decision 4). The installation
 * is always asked of GitHub with the App's own JWT, never taken from the `installation_id` a
 * browser brings back, which anyone can craft.
 *
 * - `GET /repos/{owner}/{repo}/installation` (JWT) answers the installation, or 404 when the App
 *   is not installed on the repository (or it does not exist: GitHub does not tell the two apart).
 * - `POST /app/installations/{id}/access_tokens` with `repositories: [repo]` answers a token and
 *   the `repositories` it covers, each with its numeric `id`. The token is dropped unused.
 */
import { HttpError, httpJson } from "../../../utils/index.ts";
import { apiBase, githubHeaders } from "../github-api.ts";
import { signAppJwt } from "../github-app.ts";

/** A GitHub App's own credentials (no installation yet). */
export interface GitHubAppIdentity {
  appId: string;
  privateKey: string;
  /** GitHub Enterprise Server API base; absent means api.github.com. */
  apiUrl?: string | null | undefined;
}

/** The answer of {@link resolveInstallation}: covered with ids, or definitively not. */
export type InstallationLookup =
  | { covered: true; installationId: string; repositoryId: string; fullName: string }
  | { covered: false };

const NAME = /^[\w.-]{1,100}$/u;

/**
 * The installation that covers `owner/repo` and the repository's numeric id. `{ covered: false }`
 * only when GitHub answers 404, a definitive negative; any other failure (timeout, 5xx, a refused
 * JWT) throws, so a caller never breaks a link on an inconclusive answer (decision 6).
 */
export async function resolveInstallation(
  app: GitHubAppIdentity,
  owner: string,
  repo: string,
  now: number = Date.now(),
): Promise<InstallationLookup> {
  if (!NAME.test(owner) || !NAME.test(repo)) {
    throw new TypeError("Not a GitHub repository name");
  }
  const base = apiBase(app.apiUrl ?? undefined);
  const headers = githubHeaders(signAppJwt(app, now));
  const installationId = await installationOf(
    `${base}/repos/${owner}/${repo}/installation`,
    headers,
  );
  if (installationId === null) {
    return { covered: false };
  }
  const repository = await coveredRepository(base, headers, installationId, repo);
  return repository === null
    ? { covered: false }
    : { covered: true, installationId, ...repository };
}

/** The installation id, or null on GitHub's 404; anything else inconclusive throws. */
async function installationOf(
  url: string,
  headers: Record<string, string>,
): Promise<string | null> {
  let installation: { id?: unknown };
  try {
    installation = await httpJson(url, { headers });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
  if (typeof installation.id !== "number") {
    throw new TypeError("GitHub answered without an installation id");
  }
  return String(installation.id);
}

async function coveredRepository(
  base: string,
  headers: Record<string, string>,
  installationId: string,
  repo: string,
): Promise<{ repositoryId: string; fullName: string } | null> {
  const answer = await httpJson<{ repositories?: unknown }>(
    `${base}/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers, json: { repositories: [repo], permissions: { metadata: "read" } } },
  );
  const list = Array.isArray(answer.repositories) ? (answer.repositories as unknown[]) : [];
  const found = list.find(
    (entry): entry is { id: number; full_name: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)["id"] === "number" &&
      typeof (entry as Record<string, unknown>)["full_name"] === "string",
  );
  return found ? { repositoryId: String(found.id), fullName: found.full_name } : null;
}
