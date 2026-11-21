import { startServer } from "../../node/index.ts";
import type { ServerFlags } from "../args.ts";
import { buildInstance, loadInstance } from "../instance.ts";
import type { CommandContext } from "./context.ts";
import { watchServe, type SpawnWatch } from "./watch.ts";

/** The port: `--port`, then `PORT`, then 3000. */
export function portOf(flags: ServerFlags, env: NodeJS.ProcessEnv): number {
  return flags.port ?? (Number(env["PORT"]) || 3000);
}

/**
 * `serve`: create the app in `serve` mode, set it up, run the instance's `afterSetup` hook, then
 * listen through `startServer`, with SIGINT/SIGTERM draining it. Resolves with the exit code once the
 * server has shut down (1 when the shutdown was incomplete). `--watch` restarts it on changes.
 */
export async function serve(
  ctx: CommandContext,
  deps: { spawnWatch?: SpawnWatch } = {},
): Promise<number> {
  const { flags, io, env } = ctx;
  if (flags.watch === true) return await watchServe(flags, deps.spawnWatch);
  const loaded = await loadInstance(flags.dir ?? process.cwd(), flags.entry);
  const { app, options } = await buildInstance(loaded, "serve", env);
  const server = await startServer({
    app,
    port: portOf(flags, env),
    handleSignals: true,
    beforeListen: async () => {
      await loaded.instance.afterSetup?.({ options, env });
    },
  });
  io.out(`StoryShelf listening on ${server.url}`);
  const result = await server.closed;
  return result.complete ? 0 : 1;
}
