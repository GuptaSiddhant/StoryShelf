import type { Logger } from "pino";

import { StatusConfigModel } from "../models/status-config.ts";
import type { GitAdapter } from "../adapters/status.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Project } from "../schema.ts";

async function postStatusesForBuild(opts: {
  db: DatabaseAdapter;
  project: Project;
  sha: string;
  status: import("../adapters/status.ts").CheckStatus;
  url: string;
  providers: GitAdapter[];
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
      const adapter = provider.withConfig({ config: parsed, token, logger: opts.logger });
      await adapter.setStatus(ctx, opts.sha, opts.status, opts.url);
    }),
  );
}

export { postStatusesForBuild };
