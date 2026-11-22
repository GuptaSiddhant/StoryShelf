import { spawn } from "node:child_process";
import type { ServerFlags } from "../args.ts";

/** Runs `node <args>` with inherited output and resolves with its exit code. */
export type SpawnWatch = (args: readonly string[]) => Promise<number>;

/** The arguments of the watching child: Node's `--watch`, this bin, and `serve` without `--watch`. */
export function watchArgs(script: string, flags: ServerFlags): string[] {
  return [
    "--watch",
    script,
    "serve",
    ...(flags.dir === undefined ? [] : ["--dir", flags.dir]),
    ...(flags.entry === undefined ? [] : ["--entry", flags.entry]),
    ...(flags.port === undefined ? [] : ["--port", String(flags.port)]),
  ];
}

const defaultSpawn: SpawnWatch = async (args) =>
  await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [...args], { stdio: "inherit" });
    const relay = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    process.on("SIGINT", relay);
    process.on("SIGTERM", relay);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", relay);
      process.off("SIGTERM", relay);
      resolve(code ?? (signal === null ? 1 : 0));
    });
  });

/**
 * `serve --watch`: run this bin under Node's own `--watch`, which restarts it when the instance
 * module or a file it imports changes. The bin is the script that was started (`process.argv[1]`),
 * so it works from `node_modules/.bin` and from a path alike.
 */
export async function watchServe(
  flags: ServerFlags,
  spawnWatch: SpawnWatch = defaultSpawn,
  script = process.argv[1] ?? "",
): Promise<number> {
  return await spawnWatch(watchArgs(script, flags));
}
