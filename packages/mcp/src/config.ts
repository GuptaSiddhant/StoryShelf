import {
  OLD_NAMES_ALLOWED_MESSAGE,
  oldNamesAllowedFields,
  readSetting,
  refuseRenamedSettings,
} from "@storyshelf/common/settings";

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
 * @throws When no server URL is configured, or an old name of these variables is set (#1308).
 */
export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<McpConfig> = {},
): McpConfig {
  warnIgnoredOldNames(refuseRenamedSettings(env, ["SHELF_URL", "SHELF_TOKEN", "SHELF_SLUG"]));
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

/** With SHELF_ALLOW_OLD_NAMES=1, one stderr line naming the ignored old variables (never values). */
function warnIgnoredOldNames(renames: ReturnType<typeof refuseRenamedSettings>): void {
  if (renames.length > 0) {
    const names = oldNamesAllowedFields(renames).oldNames.join(", ");
    process.stderr.write(`storyshelf-mcp: ${OLD_NAMES_ALLOWED_MESSAGE}: ${names}\n`);
  }
}
