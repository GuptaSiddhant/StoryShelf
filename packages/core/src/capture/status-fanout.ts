import { LOCAL_SHA_PREFIX } from "@storyshelf/affected";
import type { Logger } from "pino";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { buildCommentMarkdown } from "../adapters/git-host/helpers.ts";
import type { CheckStatus, GitHostProvider } from "../adapters/git-host/index.ts";
import {
  StatusConfigModel,
  type ResolvedStatusRow,
  type StatusConfigTables,
} from "../models/status-config.ts";
import type { Project } from "../schema/project.ts";
import type { SecretInput } from "../utils/encrypt.ts";

const UNRESOLVED_MESSAGES = {
  "no-provider": "no provider registered for status config",
  "invalid-config": "invalid status config",
  "undecryptable-token": "failed to decrypt status token",
} as const;

/** Log why a status-config row could not be used. */
function logUnresolved(
  logger: Logger | undefined,
  provider: string,
  failure: Exclude<ResolvedStatusRow, { ok: true }>,
): void {
  const error = "error" in failure ? failure.error : undefined;
  logger?.warn(
    { ...(error === undefined ? {} : { err: error }), provider },
    UNRESOLVED_MESSAGES[failure.reason],
  );
}

/** Post build check statuses (and review comments) to every configured git provider. */
async function postStatusesForBuild(opts: {
  db: DatabaseAdapter;
  tables: StatusConfigTables;
  project: Project;
  sha: string;
  status: CheckStatus;
  url: string;
  providers: GitHostProvider[];
  secret: SecretInput;
  logger?: Logger;
}): Promise<void> {
  if (opts.providers.length === 0) {
    return;
  }
  if (opts.sha.startsWith(LOCAL_SHA_PREFIX)) {
    opts.logger?.info(
      { sha: opts.sha },
      "skipping git provider status for synthetic local identity",
    );
    return;
  }
  const model = new StatusConfigModel(opts.db, opts.tables, opts.secret);
  const rows = await model.list(opts.project.id);
  const ctx = `storyshelf/${opts.project.slug}`;
  await Promise.allSettled(
    rows.map(async (row) => {
      const resolved = model.resolveRow(row, opts.providers);
      if (!resolved.ok) {
        logUnresolved(opts.logger, row.provider, resolved);
        return;
      }
      const { provider, config: parsed, token } = resolved;
      const adapter = provider.create({ config: parsed, token, logger: opts.logger });
      await adapter.setStatus({
        context: ctx,
        gitSha: opts.sha,
        status: opts.status,
        url: opts.url,
      });
      if (adapter.upsertComment) {
        const markdown = buildCommentMarkdown(opts.status, opts.url, ctx);
        await adapter
          .upsertComment({ sha: opts.sha, url: opts.url, status: opts.status, markdown })
          .catch((error: unknown) => {
            opts.logger?.warn({ err: error, provider: row.provider }, "failed to upsert comment");
          });
      }
    }),
  );
}

export { postStatusesForBuild };
