import type { ShelfAppMode } from "../../app-types.ts";
import type { ServerFlags } from "../args.ts";
import { buildInstance, loadInstance, type BuiltInstance } from "../instance.ts";
import type { Io } from "../io.ts";

/** What a command runs with. */
export interface CommandContext {
  flags: ServerFlags;
  io: Io;
  /** The process environment, with `.env` already applied. */
  env: NodeJS.ProcessEnv;
}

/**
 * Load the instance, build its app in `mode`, run `fn`, and tear the app down afterwards (also when
 * `fn` throws). The tool commands pass `tool`, which never sets up, migrates or polls.
 */
export async function withInstance<T>(
  ctx: CommandContext,
  mode: ShelfAppMode,
  fn: (built: BuiltInstance) => Promise<T>,
): Promise<T> {
  const loaded = await loadInstance(ctx.flags.dir ?? process.cwd(), ctx.flags.entry);
  const built = await buildInstance(loaded, mode, ctx.env);
  try {
    return await fn(built);
  } finally {
    await built.app.lifecycle.teardown();
  }
}
