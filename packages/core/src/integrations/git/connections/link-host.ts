/**
 * What a repository link asks its host (ADR 0054, decisions 2, 4 and 6): which repository a link
 * names when a site admin approves it, and, after a refused write, whether the link itself still
 * holds. Both answer from the connection's own credentials. Only a definitive negative from the
 * host (GitHub's 404 or 422 for the installation, GitLab's 401, 403 or 404 for the project) says
 * "not covered" or "broken"; a timeout, a 5xx, a network error or a refused App JWT throws, so a
 * caller never breaks a link on an inconclusive answer. Each request is tried once: the job that
 * asked retries as a whole. Nothing here returns or logs a secret.
 */
import { HttpError, httpJson } from "../../../utils/index.ts";
import { apiBase as githubApiBase, githubHeaders } from "../github-api.ts";
import { signAppJwt } from "../github-app.ts";
import { apiBase as gitlabApiBase, gitlabHeaders, projectId } from "../gitlab-api.ts";
import { resolveInstallation } from "./installation.ts";

/** The public side of a connection a lookup reads (a `GitConnection` is one). */
export interface LinkConnection {
  provider: string;
  apiBase: string | null;
  config: Readonly<Record<string, unknown>>;
}

/** The repository a link names, and what an approval pinned (null until then). */
export interface LinkRepository {
  owner: string;
  repo: string;
  hostRepositoryId: string | null;
  installationId: string | null;
}

/** Whether the connection reaches the repository, with the ids an approval pins. */
export type LinkCoverage =
  | { covered: true; hostRepositoryId: string; installationId: string | null }
  | { covered: false };

/** A link that still holds (with the installation that now covers it), or why it is broken. */
export type LinkRecheck =
  | { ok: true; hostRepositoryId: string; installationId: string | null }
  | { ok: false; reason: string };

/** Why a link broke, as the project and the System page show it. */
export const BROKEN_REASONS = {
  uninstalled: "The GitHub App is no longer installed on this repository",
  uncovered: "The GitHub App's installation no longer covers this repository",
  gitlabGone: "GitLab answers that the project is gone or the token cannot read it",
  gitlabToken: "GitLab refused the connection's token",
  unknownProvider: "The connection's provider is not supported",
} as const;

/**
 * The repository `owner/repo` on the connection's host: covered with its numeric id (and, for a
 * GitHub App, the installation), or not covered. Throws on an inconclusive answer.
 */
export async function resolveLinkCoverage(
  connection: LinkConnection,
  secret: string,
  repository: Pick<LinkRepository, "owner" | "repo">,
): Promise<LinkCoverage> {
  if (connection.provider === "github-app") {
    const found = await resolveInstallation(
      appOf(connection, secret),
      repository.owner,
      repository.repo,
    );
    return found.covered
      ? {
          covered: true,
          hostRepositoryId: found.repositoryId,
          installationId: found.installationId,
        }
      : { covered: false };
  }
  if (connection.provider === "gitlab-token") {
    const id = await gitlabProjectId(
      connection,
      secret,
      projectId(repository.owner, repository.repo),
    );
    return typeof id === "string"
      ? { covered: true, hostRepositoryId: id, installationId: null }
      : { covered: false };
  }
  return { covered: false };
}

/**
 * After the host refused a write (401, 403 or 404): does the link itself still hold? A refusal can
 * be about the commit (`--sha` is the uploader's), so a link that still holds is not broken. A
 * GitHub App installation that was replaced is followed to the new one when it covers the same
 * repository id. Throws on an inconclusive answer.
 */
export async function recheckLink(
  connection: LinkConnection,
  secret: string,
  link: LinkRepository,
): Promise<LinkRecheck> {
  if (connection.provider === "github-app") {
    return await recheckGitHub(connection, secret, link);
  }
  if (connection.provider === "gitlab-token") {
    return await recheckGitLab(connection, secret, link);
  }
  return { ok: false, reason: BROKEN_REASONS.unknownProvider };
}

async function recheckGitHub(
  connection: LinkConnection,
  secret: string,
  link: LinkRepository,
): Promise<LinkRecheck> {
  if (link.hostRepositoryId === null) {
    const coverage = await resolveLinkCoverage(connection, secret, link);
    return coverage.covered
      ? {
          ok: true,
          hostRepositoryId: coverage.hostRepositoryId,
          installationId: coverage.installationId,
        }
      : { ok: false, reason: BROKEN_REASONS.uninstalled };
  }
  const app = { connection, secret, repositoryId: link.hostRepositoryId };
  const known =
    link.installationId === null ? "gone" : await coversRepository(app, link.installationId);
  if (known !== "gone") {
    return known === "covered"
      ? { ok: true, hostRepositoryId: link.hostRepositoryId, installationId: link.installationId }
      : { ok: false, reason: BROKEN_REASONS.uncovered };
  }
  return await followInstallation(app, link);
}

/** The installation was removed: a new one on the same repository may cover the same id. */
async function followInstallation(app: GitHubAppCall, link: LinkRepository): Promise<LinkRecheck> {
  const installationId = await installationOfRepository(app, link);
  const covers = installationId === null ? "gone" : await coversRepository(app, installationId);
  if (covers === "covered") {
    return { ok: true, hostRepositoryId: app.repositoryId, installationId };
  }
  return {
    ok: false,
    reason: covers === "gone" ? BROKEN_REASONS.uninstalled : BROKEN_REASONS.uncovered,
  };
}

interface GitHubAppCall {
  connection: LinkConnection;
  secret: string;
  repositoryId: string;
}

/**
 * Whether the installation still covers the repository id: a token limited to it is granted
 * (`covered`), GitHub answers 422 because the installation cannot reach it (`uncovered`), or 404
 * because the installation is gone (`gone`). The token is dropped unused.
 */
async function coversRepository(
  app: GitHubAppCall,
  installationId: string,
): Promise<"covered" | "uncovered" | "gone"> {
  const base = githubApiBase(app.connection.apiBase ?? undefined);
  try {
    await httpJson(
      `${base}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      {
        method: "POST",
        headers: githubHeaders(signAppJwt(appOf(app.connection, app.secret), Date.now())),
        json: { repository_ids: [Number(app.repositoryId)], permissions: { metadata: "read" } },
        retries: 1,
      },
    );
    return "covered";
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 0;
    if (status === 404 || status === 422) {
      return status === 404 ? "gone" : "uncovered";
    }
    throw error;
  }
}

/** The installation on `owner/repo` now, or null on GitHub's 404. */
async function installationOfRepository(
  app: GitHubAppCall,
  link: LinkRepository,
): Promise<string | null> {
  const base = githubApiBase(app.connection.apiBase ?? undefined);
  const owner = encodeURIComponent(link.owner);
  const repo = encodeURIComponent(link.repo);
  try {
    const answer = await httpJson<{ id?: unknown }>(`${base}/repos/${owner}/${repo}/installation`, {
      headers: githubHeaders(signAppJwt(appOf(app.connection, app.secret), Date.now())),
      retries: 1,
    });
    return typeof answer.id === "number" ? String(answer.id) : null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

async function recheckGitLab(
  connection: LinkConnection,
  secret: string,
  link: LinkRepository,
): Promise<LinkRecheck> {
  const ref = link.hostRepositoryId ?? projectId(link.owner, link.repo);
  const answer = await gitlabProjectId(connection, secret, ref);
  if (typeof answer === "string") {
    return { ok: true, hostRepositoryId: answer, installationId: null };
  }
  return {
    ok: false,
    reason: answer.status === 404 ? BROKEN_REASONS.gitlabGone : BROKEN_REASONS.gitlabToken,
  };
}

/** The project's numeric id, or the definitive refusal (401, 403, 404); anything else throws. */
async function gitlabProjectId(
  connection: LinkConnection,
  token: string,
  ref: string,
): Promise<string | { status: number }> {
  const base = gitlabApiBase(connection.apiBase ?? undefined);
  try {
    const project = await httpJson<{ id?: unknown }>(`${base}/api/v4/projects/${ref}`, {
      headers: gitlabHeaders(token),
      retries: 1,
    });
    if (typeof project.id !== "number") {
      throw new TypeError("GitLab answered without a project id");
    }
    return String(project.id);
  } catch (error) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status)) {
      return { status: error.status };
    }
    throw error;
  }
}

function appOf(
  connection: LinkConnection,
  privateKey: string,
): { appId: string; privateKey: string; apiUrl: string | null } {
  const raw = connection.config["appId"];
  const appId = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  return { appId, privateKey, apiUrl: connection.apiBase };
}
