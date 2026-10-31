/** Starting a local browser, and telling one that would not start from one that crashed. */
import { TargetLaunchError } from "@storyshelf/core/adapter/capture-runner";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import type { LocalTarget } from "./targets.ts";

/**
 * Sandbox flags for containers plus low-memory flags. Rendering-affecting flags
 * (`--disable-gpu`, `--single-process`) are excluded: they can shift pixels.
 */
const DEFAULT_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--mute-audio",
];

/**
 * Puppeteer closes its browser on SIGINT/SIGTERM/SIGHUP by default, which fails a render that a
 * graceful drain is still finishing. The host owns shutdown: it drains, and each render releases
 * the browser it launched (or disconnects the one it connected to).
 */
const HOST_OWNS_SIGNALS = {
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
} as const;

/**
 * Launch `entry`'s browser. A failure is a {@link TargetLaunchError}: the browser never started, so
 * no story is at fault and the job fails at once instead of going through crash isolation.
 */
export async function launchLocal(
  entry: LocalTarget,
  args: string[] | undefined,
): Promise<Browser> {
  try {
    return await puppeteer.launch({
      ...HOST_OWNS_SIGNALS,
      headless: true,
      executablePath: entry.executablePath,
      args: args ?? DEFAULT_ARGS,
    });
  } catch (error) {
    throw new TargetLaunchError(entry.target, firstLine(error), { cause: error });
  }
}

/** Launch errors carry a long log tail; the first line says what failed. */
function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "the browser did not start"
  );
}
