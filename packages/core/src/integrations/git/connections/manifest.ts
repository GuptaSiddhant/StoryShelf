/**
 * Creating a GitHub App from a manifest (ADR 0054, decision 1), checked against GitHub's
 * "Registering a GitHub App from a manifest" and REST "Apps" docs (2026-11-20):
 *
 * - the form posts `manifest` (JSON) to `/settings/apps/new` or
 *   `/organizations/<org>/settings/apps/new` on the web host, with an optional `state` query
 *   parameter GitHub returns to `redirect_url` unchanged;
 * - `url` and `hook_attributes.url` are required; `hook_attributes.active` defaults to true;
 * - the returned `code` is exchanged within the hour (`exchange.ts`).
 *
 * The caller builds every URL from the confirmed public origin; nothing here reads a request.
 */
import { apiBase } from "../github-api.ts";
import type { GitHubAppPosts } from "./types.ts";

/** The absolute URLs a manifest names, all on the confirmed public origin. */
export interface AppManifestInput {
  /** The App's name on GitHub (unique on the host; GitHub asks for another one if taken). */
  name: string;
  /** The App's homepage: the server's public origin. */
  homepageUrl: string;
  /** Where GitHub returns with `code` and `state`. */
  redirectUrl: string;
  /** A path that answers 404: StoryShelf receives no webhooks, the hook stays inactive. */
  webhookUrl: string;
  /** Optional posts beyond the required check runs. */
  posts?: GitHubAppPosts | undefined;
}

/** The manifest GitHub reads (snake_case fields as documented). */
export interface GitHubAppManifest {
  name: string;
  url: string;
  description: string;
  public: false;
  redirect_url: string;
  hook_attributes: { url: string; active: false };
  default_permissions: Record<string, "read" | "write">;
  default_events: [];
}

/**
 * The manifest of a private App with what ADR 0054 needs: Checks write (the merge gate), Contents
 * read (compare only), Pull requests write for the comment and Commit statuses write, each when
 * chosen. GitHub adds Metadata read to every App on its own.
 */
export function githubAppManifest(input: AppManifestInput): GitHubAppManifest {
  const permissions: Record<string, "read" | "write"> = { checks: "write", contents: "read" };
  if (input.posts?.pullRequests ?? true) {
    permissions["pull_requests"] = "write";
  }
  if (input.posts?.statuses === true) {
    permissions["statuses"] = "write";
  }
  return {
    name: input.name,
    url: absolute(input.homepageUrl),
    description: "StoryShelf posts visual-test and review results on pull requests.",
    public: false,
    redirect_url: absolute(input.redirectUrl),
    hook_attributes: { url: absolute(input.webhookUrl), active: false },
    default_permissions: permissions,
    default_events: [],
  };
}

/**
 * Where the site admin's browser posts the manifest: the personal or organization form on the web
 * host of `apiUrl` (github.com, or a GitHub Enterprise Server's own host), carrying `state`.
 */
export function manifestFormUrl(options: {
  state: string;
  organization?: string | undefined;
  apiUrl?: string | undefined;
}): string {
  const org = options.organization?.trim();
  if (org !== undefined && org !== "" && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(org)) {
    throw new TypeError("Not a GitHub organization name");
  }
  const path = org ? `/organizations/${org}/settings/apps/new` : "/settings/apps/new";
  const url = new URL(path, webHost(options.apiUrl));
  url.searchParams.set("state", options.state);
  return url.toString();
}

/** The web origin of an API base: `https://github.com`, or the GHES host of `…/api/v3`. */
export function webHost(apiUrl?: string): string {
  const base = new URL(apiBase(apiUrl));
  return base.hostname === "api.github.com" ? "https://github.com" : base.origin;
}

function absolute(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Manifest URLs must be http(s)");
  }
  return url.toString();
}
