import { adminCall } from "../admin-call.ts";
import type { ServerFlags } from "../args.ts";
import { loadInstance } from "../instance.ts";
import type { Io } from "../io.ts";

interface PurgeResult {
  removedBuilds: number;
  removedBranches?: number;
  removedBaselines?: number;
}

/** `purge`: remove expired builds through the instance's own retention (fenced, ADR 0039). */
export async function purge(flags: ServerFlags, io: Io): Promise<number> {
  const { app } = await loadInstance(flags.dir ?? process.cwd());
  try {
    await app.lifecycle.setup();
    const result = await adminCall<PurgeResult>(
      app,
      "/api/v1/admin/purge",
      flags.ttlDays === undefined ? {} : { ttlDays: flags.ttlDays },
    );
    io.out(
      `Removed ${result.removedBuilds} build(s), ${result.removedBranches ?? 0} branch(es) and ${result.removedBaselines ?? 0} baseline(s)`,
    );
    return 0;
  } finally {
    await app.lifecycle.teardown();
  }
}
