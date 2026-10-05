import { loadStorybookConfig } from "../config.ts";

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
 * Resolve url/slug/token as flags > config file > env, throwing on the first
 * missing value (same messages as `upload`).
 */
export async function resolveConnection(options: ConnectionOptions): Promise<ResolvedConnection> {
  const cwd = options.cwd ?? process.cwd();
  const cfg = await loadStorybookConfig(cwd, options.config);
  const fields = {
    url: options.url ?? cfg?.url ?? process.env["STORYSHELF_URL"],
    slug: options.slug ?? cfg?.slug ?? process.env["STORYSHELF_SLUG"],
    token: options.token ?? process.env["STORYSHELF_TOKEN"] ?? process.env["SHELF_TOKEN"],
  };
  assertConnectionFields(fields);
  return fields;
}

/** Throw on the first missing connection field. */
function assertConnectionFields(fields: {
  url?: string;
  slug?: string;
  token?: string;
}): asserts fields is ResolvedConnection {
  if (!fields.url) {
    throw new Error("--url is required (or .storybook/storyshelf.json / STORYSHELF_URL)");
  }
  if (!fields.slug) {
    throw new Error("--slug is required (or .storybook/storyshelf.json / STORYSHELF_SLUG)");
  }
  if (!fields.token) {
    throw new Error("--token is required (or STORYSHELF_TOKEN env)");
  }
}
