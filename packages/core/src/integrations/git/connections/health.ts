/**
 * Health of one git connection, for the System page's Git section and the admin health report
 * (#1090). A probe is one free read: GitHub `GET /app` with the App's JWT, GitLab
 * `GET /personal_access_tokens/self` with the token (it answers for group and project access
 * tokens too). Details never carry a key, a token or GitHub's body: only an HTTP status.
 */
import type { AdapterHealth } from "../../../adapters/metadata.ts";
import { HttpError, httpJson } from "../../../utils/index.ts";
import { apiBase as githubApiBase, githubHeaders } from "../github-api.ts";
import { signAppJwt } from "../github-app.ts";
import { apiBase as gitlabApiBase, gitlabHeaders } from "../gitlab-api.ts";

/** Days before a GitLab token's expiry when site admins are warned. */
export const GITLAB_EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a probe needs of a connection: its public fields (stored or configured). */
export interface ProbedConnection {
  provider: string;
  apiBase: string | null;
  config: Readonly<Record<string, unknown>>;
}

/** {@link AdapterHealth} plus a warning that does not make the connection unusable. */
export interface GitConnectionHealth extends AdapterHealth {
  readonly warning?: string;
}

/** Options of a probe. */
export interface GitHealthOptions {
  now?: number;
  /** Bounds the probe (the health report's own timeout). */
  signal?: AbortSignal;
}

/**
 * Probe a connection with its decrypted `secret`. A GitLab token that expired is not usable even
 * if the host still answers; one that expires within {@link GITLAB_EXPIRY_WARNING_DAYS} warns.
 */
export async function gitConnectionHealth(
  connection: ProbedConnection,
  secret: string,
  options: GitHealthOptions = {},
): Promise<GitConnectionHealth> {
  const now = options.now ?? Date.now();
  if (connection.provider === "github-app") {
    return await githubHealth(connection, secret, now, options.signal);
  }
  if (connection.provider === "gitlab-token") {
    const expiry = gitlabTokenExpiry(connection.config["expiresOn"], now);
    if (expiry.expired) {
      return { ok: false, detail: expiry.message };
    }
    const probe = await gitlabHealth(connection, secret, options.signal);
    return probe.ok && expiry.message ? { ...probe, warning: expiry.message } : probe;
  }
  return { ok: false, detail: `Unknown git connection provider "${connection.provider}"` };
}

/** Where a GitLab token's expiry stands: expired, due within 30 days (a message), or fine. */
export function gitlabTokenExpiry(
  expiresOn: unknown,
  now: number = Date.now(),
): { expired: boolean; message?: string } {
  const at = typeof expiresOn === "string" ? Date.parse(`${expiresOn}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(at)) {
    return { expired: false, message: "Token expiry unknown" };
  }
  const days = Math.ceil((at - now) / DAY_MS);
  if (days <= 0) {
    return { expired: true, message: `Token expired on ${String(expiresOn)}` };
  }
  return days <= GITLAB_EXPIRY_WARNING_DAYS
    ? { expired: false, message: `Token expires on ${String(expiresOn)} (in ${days} days)` }
    : { expired: false };
}

async function githubHealth(
  connection: ProbedConnection,
  privateKey: string,
  now: number,
  signal: AbortSignal | undefined,
): Promise<GitConnectionHealth> {
  const raw = connection.config["appId"];
  const appId = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  try {
    const app = await httpJson<{ slug?: unknown }>(
      `${githubApiBase(connection.apiBase ?? undefined)}/app`,
      {
        headers: githubHeaders(signAppJwt({ appId, privateKey }, now)),
        retries: 1,
        ...(signal ? { signal } : {}),
      },
    );
    return { ok: true, detail: typeof app.slug === "string" ? `App ${app.slug}` : "App reachable" };
  } catch (error) {
    return { ok: false, detail: failure("GitHub", error) };
  }
}

async function gitlabHealth(
  connection: ProbedConnection,
  token: string,
  signal: AbortSignal | undefined,
): Promise<GitConnectionHealth> {
  try {
    const self = await httpJson<{ active?: unknown; revoked?: unknown }>(
      `${gitlabApiBase(connection.apiBase ?? undefined)}/api/v4/personal_access_tokens/self`,
      { headers: gitlabHeaders(token), retries: 1, ...(signal ? { signal } : {}) },
    );
    return self.active === false || self.revoked === true
      ? { ok: false, detail: "Token is revoked or inactive" }
      : { ok: true, detail: "Token active" };
  } catch (error) {
    return { ok: false, detail: failure("GitLab", error) };
  }
}

/** A refusal names the status only; anything else is "unreachable" (no message, no URL). */
function failure(host: string, error: unknown): string {
  return error instanceof HttpError
    ? `${host} answered HTTP ${error.status}`
    : `${host} unreachable`;
}
