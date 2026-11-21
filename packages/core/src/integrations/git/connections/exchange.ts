/**
 * The manifest flow's last step (ADR 0054, decision 1): the one-time `code` GitHub returns is
 * exchanged within an hour at `POST /app-manifests/{code}/conversions`, which needs no
 * authentication and answers with the App (`id`, `slug`, `owner`, …) plus `pem`, `webhook_secret`,
 * `client_id` and `client_secret` (GitHub REST "Apps" docs, read 2026-11-20).
 */
import { HttpError, httpJson } from "../../../utils/index.ts";
import { apiBase } from "../github-api.ts";

/** What the exchange keeps: the App's identity and its private key. */
export interface ExchangedApp {
  appId: string;
  slug: string;
  name: string;
  /** Login of the account or organization that owns the App. */
  owner: string;
  /** The App's page on GitHub, where the site admin installs it. */
  htmlUrl: string;
  /** PEM private key: store it encrypted at once, never log or return it. */
  privateKey: string;
}

/**
 * Trade the one-time manifest `code` for the App. The webhook secret and the client id and secret
 * are dropped unread. One attempt only: the code is single-use. A refusal names the HTTP status,
 * never the code or GitHub's body.
 */
export async function exchangeManifestCode(code: string, apiUrl?: string): Promise<ExchangedApp> {
  if (!/^[\w-]{1,200}$/u.test(code)) {
    throw new TypeError("Not a GitHub manifest code");
  }
  let answer: Record<string, unknown>;
  try {
    answer = await httpJson<Record<string, unknown>>(
      `${apiBase(apiUrl)}/app-manifests/${code}/conversions`,
      {
        method: "POST",
        headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
        retries: 1,
      },
    );
  } catch (error) {
    const status = error instanceof HttpError ? `HTTP ${error.status}` : "no answer";
    throw new Error(`GitHub did not exchange the manifest code (${status})`, { cause: error });
  }
  return appOf(answer);
}

function appOf(answer: Record<string, unknown>): ExchangedApp {
  const { id, slug, name, owner, html_url: htmlUrl, pem } = answer;
  const login =
    typeof owner === "object" && owner !== null
      ? (owner as Record<string, unknown>)["login"]
      : undefined;
  if (
    typeof id !== "number" ||
    typeof pem !== "string" ||
    typeof slug !== "string" ||
    typeof name !== "string" ||
    typeof login !== "string" ||
    typeof htmlUrl !== "string"
  ) {
    throw new TypeError("GitHub answered the manifest exchange without an App");
  }
  return { appId: String(id), slug, name, owner: login, htmlUrl, privateKey: pem };
}
