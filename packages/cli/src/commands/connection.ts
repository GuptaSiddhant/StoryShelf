import { normalizeBaseUrl } from "../client.ts";
import { loadStorybookConfig } from "../config.ts";
import { readSetting } from "../settings.ts";
import { warnTokenFlag } from "./token-flag.ts";

/** Server connection options shared by read-only commands. */
export interface ConnectionOptions {
  /** Server base URL. */
  url?: string;
  /** Project slug. */
  slug?: string;
  /** CI token. */
  token?: string;
  /** Custom config file path. */
  config?: string;
  /** Working directory (defaults to process.cwd()). Test seam for fs access. */
  cwd?: string;
}

/** Resolved server connection (all fields present). */
export interface ResolvedConnection {
  url: string;
  slug: string;
  token: string;
}

/**
 * Resolve url/slug/token as flags > env > config file (the token never comes from the file), throwing on the first
 * missing value (same messages as `upload`).
 */
export async function resolveConnection(options: ConnectionOptions): Promise<ResolvedConnection> {
  const cwd = options.cwd ?? process.cwd();
  const cfg = await loadStorybookConfig(cwd, options.config);
  warnTokenFlag(options.token);
  const fields = {
    url: options.url ?? readSetting(process.env, "SHELF_URL") ?? cfg?.url,
    slug: options.slug ?? readSetting(process.env, "SHELF_SLUG") ?? cfg?.slug,
    token: options.token ?? readSetting(process.env, "SHELF_TOKEN"),
  };
  assertConnectionFields(fields);
  return { ...fields, url: normalizeBaseUrl(fields.url) };
}

/** The three values every server command needs. */
export type ConnectionField = "url" | "slug" | "token";

/**
 * What to say when a connection value is missing: the flag, then the specific source that would
 * supply it (never "the generic list"), so `upload`, bare `storyshelf` and the read-only commands agree.
 */
export function missingConnectionMessage(field: ConnectionField): string {
  return MISSING_MESSAGES[field];
}

const MISSING_MESSAGES: Readonly<Record<ConnectionField, string>> = {
  url: "--url is required: no server URL (set SHELF_URL, or put url in .storybook/storyshelf.json)",
  slug: "--slug is required: no project slug (set SHELF_SLUG, or put slug in .storybook/storyshelf.json)",
  token:
    "--token is required: no token (set SHELF_TOKEN in the environment; in CI map the secret to it)",
};

/** Throw on the first missing connection field. */
function assertConnectionFields(fields: {
  url?: string;
  slug?: string;
  token?: string;
}): asserts fields is ResolvedConnection {
  for (const field of ["url", "slug", "token"] as const) {
    if (!fields[field]) {
      throw new Error(missingConnectionMessage(field));
    }
  }
}
