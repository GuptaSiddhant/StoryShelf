import { readSetting } from "@storyshelf/core/config";
/** Resolved connection settings for the MCP server. */
export interface McpConfig {
  /** StoryShelf server base URL (no trailing slash). */
  url: string;
  /** API token (project CI token, member token, or admin token). Optional over HTTP. */
  token?: string;
  /** Default project slug used when a tool call omits `project`. */
  slug?: string;
}

/**
 * Read the connection from the environment (same variables as the CLI:
 * `SHELF_URL`, `SHELF_TOKEN`, `SHELF_SLUG`).
 *
 * @throws When no server URL is configured.
 */
export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<McpConfig> = {},
): McpConfig {
  const url = overrides.url ?? readSetting(env, "SHELF_URL");
  if (!url) {
    throw new Error("SHELF_URL is required (or pass --url)");
  }
  const token = overrides.token ?? readSetting(env, "SHELF_TOKEN");
  const slug = overrides.slug ?? readSetting(env, "SHELF_SLUG");
  return {
    url: url.replace(/\/+$/u, ""),
    ...(token ? { token } : {}),
    ...(slug ? { slug } : {}),
  };
}
