import type { ShelfOptions } from "@storyshelf/core/config";
import type { ShelfAppMode } from "../../app-types.ts";
import { packageVersion } from "../../package-version.ts";
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

/**
 * Let a `tool` command use the database's fenced retention (ADR 0039) when this release already
 * prepared it: the adapter decides from reads alone and throws one line naming the fix otherwise
 * (`serve` or `migrate` once). Only a `testing` deployment needs it (without testing, retention is
 * not fenced), and an adapter without the hook keeps failing closed as before.
 */
export async function activateToolRetention(options: ShelfOptions): Promise<void> {
  if (!options.testing) return;
  await options.database.activateRetentionReadOnly?.({ release: packageVersion() });
}
