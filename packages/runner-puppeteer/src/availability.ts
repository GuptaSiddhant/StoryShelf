/** Telling which declared local engines can launch, without launching anything (ADR 0007, decision 7). */
import type { RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { existsSync } from "node:fs";
import type { LocalTarget } from "./targets.ts";

/** Injectable file check, so tests need no browsers installed. */
type Exists = (path: string) => boolean;

/**
 * Each local target as a {@link RunnerTarget}. `puppeteer-core` ships no browser, so a target is
 * `ready` only when it has an executable that exists: its own, the runner's, or the one named by
 * `PUPPETEER_EXECUTABLE_PATH`, which `puppeteer-core` itself reads.
 */
export function verifyLocalTargets(
  targets: readonly LocalTarget[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: Exists = existsSync,
): RunnerTarget[] {
  return targets.map((entry) => ({
    target: entry.target,
    reach: "loopback",
    status: statusOf(entry, env, exists),
  }));
}

function statusOf(
  entry: LocalTarget,
  env: Readonly<Record<string, string | undefined>>,
  exists: Exists,
): RunnerTarget["status"] {
  const path = entry.executablePath ?? envPath(entry, env);
  if (path === undefined) {
    return {
      unavailable: "no executablePath (puppeteer-core ships no browser): set `executablePath`",
    };
  }
  return exists(path) ? "ready" : { unavailable: `executable not found at ${path}` };
}

/** `PUPPETEER_EXECUTABLE_PATH` is for the bundled engine, never for `chrome`. */
function envPath(
  entry: LocalTarget,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const path = env["PUPPETEER_EXECUTABLE_PATH"];
  return entry.target === "chromium" && path ? path : undefined;
}
