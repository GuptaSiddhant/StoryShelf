import { startServer } from "../../node/index.ts";
import type { ServerFlags } from "../args.ts";
import { loadInstance } from "../instance.ts";
import type { Io } from "../io.ts";

/** The port: `--port`, then `PORT`, then 3000. */
export function portOf(flags: ServerFlags, env: NodeJS.ProcessEnv): number {
  return flags.port ?? (Number(env["PORT"]) || 3000);
}

/**
 * `serve`: set the instance up and listen through `startServer`, with SIGINT/SIGTERM draining it.
 * Resolves with the exit code once the server has shut down (1 when the shutdown was incomplete).
 */
export async function serve(flags: ServerFlags, io: Io, env = process.env): Promise<number> {
  const { app } = await loadInstance(flags.dir ?? process.cwd());
  const server = await startServer({ app, port: portOf(flags, env), handleSignals: true });
  io.out(`StoryShelf listening on ${server.url}`);
  const result = await server.closed;
  return result.complete ? 0 : 1;
}
