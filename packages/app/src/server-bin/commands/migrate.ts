import type { ServerFlags } from "../args.ts";
import { loadInstance } from "../instance.ts";
import type { Io } from "../io.ts";

/**
 * `migrate`: run the adapters' setup, which applies the database migrations (ADR 0053: migrate,
 * then roll the new version out), and exit without listening. Setup is idempotent.
 */
export async function migrate(flags: ServerFlags, io: Io): Promise<number> {
  const { app } = await loadInstance(flags.dir ?? process.cwd());
  try {
    await app.lifecycle.setup();
    io.out("Migrations and adapter setup completed.");
    return 0;
  } finally {
    await app.lifecycle.teardown();
  }
}
