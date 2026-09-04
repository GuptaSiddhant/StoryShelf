import type { Logger } from "pino";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { buildCommentMarkdown } from "../adapters/git-host/helpers.ts";
import type { CheckStatus, GitHostProvider } from "../adapters/git-host/index.ts";
import { StatusConfigModel } from "../models/status-config.ts";
import type { Project } from "../schema.ts";

/** Post build check statuses (and review comments) to every configured git provider. */
async function postStatusesForBuild(opts: {
  db: DatabaseAdapter;
  project: Project;
  sha: string;
  status: CheckStatus;
  url: string;
  providers: GitHostProvider[];
  secret: string | undefined;
  logger?: Logger;
}): Promise<void> {
  if (opts.providers.length === 0) {
    return;
  }
  const model = new StatusConfigModel(opts.db, opts.secret);
  const rows = await model.list(opts.project.id);
  const ctx = `storyshelf/${opts.project.slug}`;
  await Promise.allSettled(
    rows.map(async (row) => {
      const provider = opts.providers.find((p) => p.metadata.kind === row.provider);
      if (!provider) {
        opts.logger?.warn({ provider: row.provider }, "no provider registered for status config");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.config);
        provider.metadata.schema.parse(parsed);
      } catch (error: unknown) {
        opts.logger?.warn({ err: error, provider: row.provider }, "invalid status config");
        return;
      }
      let token: string;
      try {
        token = model.decryptToken(row);
      } catch (error: unknown) {
        opts.logger?.warn({ err: error }, "failed to decrypt status token");
        return;
      }
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
