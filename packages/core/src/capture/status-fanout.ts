import type { Logger } from "pino";

import { StatusConfigModel } from "../models/status-config.ts";
import type { CheckStatus, GitHostProvider } from "../adapters/git-host.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Project } from "../schema.ts";

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
      await adapter.setStatus(ctx, opts.sha, opts.status, opts.url);
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

function buildCommentMarkdown(status: CheckStatus, url: string, context: string): string {
  switch (status) {
    case "pending":
      return `Visual tests pending for \`${context}\` — [View build](${url})`;
    case "success":
      return `Visual tests passed for \`${context}\` — [View build](${url})`;
    case "failure":
      return `Visual changes detected for \`${context}\` — [View build](${url})`;
    default:
      return `Visual tests \`${status}\` for \`${context}\` — [View build](${url})`;
  }
}

export { postStatusesForBuild };
