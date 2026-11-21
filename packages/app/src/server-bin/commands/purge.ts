import { adminCall, adminTokenOf } from "../admin-call.ts";
import { withInstance, type CommandContext } from "./context.ts";

interface PurgeResult {
  removedBuilds: number;
  removedBranches?: number;
  removedBaselines?: number;
}

/**
 * `purge`: remove expired builds through the instance's own retention (fenced, ADR 0039). Runs as a
 * `tool`: it never migrates, so the database must already be at this release's level.
 */
export async function purge(ctx: CommandContext): Promise<number> {
  return await withInstance(ctx, "tool", async ({ app, options }) => {
    const { ttlDays } = ctx.flags;
    const result = await adminCall<PurgeResult>(
      app,
      adminTokenOf(options, ctx.env),
      "/api/v1/admin/purge",
      ttlDays === undefined ? {} : { ttlDays },
    );
    ctx.io.out(
      `Removed ${result.removedBuilds} build(s), ${result.removedBranches ?? 0} branch(es) and ${result.removedBaselines ?? 0} baseline(s)`,
    );
    return 0;
  });
}
