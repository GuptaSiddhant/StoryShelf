/**
 * The server's git connections (ADR 0054) as the app uses them: one `GitConnectionModel` over the
 * database and the connections configuration declares, and the start-up pass that applies the
 * configured repository links (decision 9). Delivery, the default-branch check and approval read
 * links through this model; a server without connections simply has no approved links to post to.
 */
import type { ResolvedShelfOptions, ShelfConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import {
  GitConnectionModel,
  syncConfiguredLinks,
  type GitLinkSyncResult,
} from "@storyshelf/core/models";
import { credentialKeys } from "./credential-keys.ts";

/** The connections of `options`: configured ones first, then those site admins stored. */
export function gitConnectionsOf(
  options: Pick<ResolvedShelfOptions, "database" | "git">,
  config: ShelfConfig,
): GitConnectionModel {
  return new GitConnectionModel(
    options.database,
    credentialKeys(config),
    options.git?.connections ?? [],
  );
}

/**
 * Apply the configured links and follow removed or restored connections (no secret is read).
 * Resolves to what was done.
 */
export async function syncGitLinks(
  options: Pick<ResolvedShelfOptions, "database" | "git">,
  config: ShelfConfig,
  logger: Logger,
): Promise<GitLinkSyncResult> {
  const result = await syncConfiguredLinks(
    { db: options.database, connections: gitConnectionsOf(options, config), logger },
    options.git?.links ?? [],
  );
  if (result.managed.length > 0 || result.broken > 0 || result.restored > 0) {
    logger.info(
      {
        managed: result.managed.length,
        skipped: result.skipped.length,
        broken: result.broken,
        restored: result.restored,
      },
      "applied the configured git links",
    );
  }
  return result;
}
