import { withInstance, type CommandContext } from "./context.ts";

/**
 * `migrate`: create the app in `migrate` mode and run its setup, which is the database's setup (the
 * migrations) and nothing else: no storage or runner setup, no consumer, no timers (ADR 0053:
 * migrate, then roll the new version out). Setup is idempotent.
 */
export async function migrate(ctx: CommandContext): Promise<number> {
  return await withInstance(ctx, "migrate", async ({ app }) => {
    await app.lifecycle.setup();
    ctx.io.out("Migrations completed.");
    return 0;
  });
}
