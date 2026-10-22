/** Starting a local engine, and telling a browser that would not start from one that crashed. */
import { TargetLaunchError, type BrowserName } from "@storyshelf/core/adapter/capture-runner";
import type { Browser } from "playwright-core";
import type { LocalTarget } from "./targets.ts";

/**
 * Low-memory Chromium flags. Deliberately excludes rendering-affecting flags
 * (`--disable-gpu`, `--single-process`): they can shift pixels or crash pages,
 * which would show up as false visual diffs.
 */
const CHROMIUM_ARGS = [
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--mute-audio",
];

/**
 * Playwright closes its browsers on SIGINT/SIGTERM/SIGHUP by default, which fails a render that a
 * graceful drain is still finishing (`TargetClosedError`). The host owns shutdown: it drains, then
 * closes every browser through `teardown`.
 */
const HOST_OWNS_SIGNALS = {
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
} as const;

/**
 * Launch `entry`'s engine. Playwright is loaded here, on first use, not at import: it costs
 * ~150 ms and tens of MB, which a server that only serves reviews or hosts Storybooks should not
 * pay at boot. A failure is a {@link TargetLaunchError}: the browser never started, so no story is
 * at fault and the job fails at once instead of going through crash isolation.
 */
export async function launchLocal(entry: LocalTarget): Promise<Browser> {
  try {
    const playwright = await loadPlaywright();
    return await launcherOf(entry.target, playwright)(entry.channel);
  } catch (error) {
    throw new TargetLaunchError(entry.target, firstLine(error), { cause: error });
  }
}

let loaded: Promise<typeof import("playwright-core")> | undefined;

/** Load Playwright once, however many renders ask at the same time. */
export async function loadPlaywright(): Promise<typeof import("playwright-core")> {
  loaded ??= import("playwright-core");
  return await loaded;
}

function launcherOf(
  engine: BrowserName,
  playwright: typeof import("playwright-core"),
): (channel: string | undefined) => Promise<Browser> {
  if (engine === "firefox") {
    return async () => await playwright.firefox.launch(HOST_OWNS_SIGNALS);
  }
  if (engine === "webkit") {
    return async () => await playwright.webkit.launch(HOST_OWNS_SIGNALS);
  }
  // Containers ship a tiny /dev/shm; Chromium crashes (looks like OOM) unless it uses /tmp.
  return async (channel) =>
    await playwright.chromium.launch({
      ...HOST_OWNS_SIGNALS,
      args: CHROMIUM_ARGS,
      ...(channel === undefined ? {} : { channel }),
    });
}

/** Playwright's launch errors run to a screenful of install hints; the first line says what failed. */
function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "the browser did not start"
  );
}
