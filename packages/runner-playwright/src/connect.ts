/** Connecting to a remote browser: retried when the service is unreachable or full, a clear error when it is not. */
import {
  connectLeased,
  scrubConnection,
  type ConnectLeasedContext,
  type RemoteConnection,
  type RemoteTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import type { Browser } from "playwright-core";
import { holdLease } from "./browser.ts";
import { loadPlaywright } from "./launch.ts";
import { playwrightVersion } from "./version.ts";

/**
 * Connect to `entry`'s service and return its browser, holding the service's lease (a function
 * `connect`'s `lease`) until the browser is closed through `closeBrowser`/`safeCloseBrowser`.
 * Connection-level failures are retried with backoff, so a provider outage or a full plan costs
 * time and not a story crash; what is left is a `TargetLaunchError`, which fails the job at once
 * (a wrong version or credential also marks the target unavailable, a service that is merely down
 * does not). Nothing in a message carries the endpoint, its credentials or the lease.
 */
export async function connectRemote(
  entry: RemoteTarget,
  context: ConnectLeasedContext,
  logger?: Logger,
): Promise<Browser> {
  const playwright = await loadPlaywright();
  const { value, lease } = await connectLeased(entry, context, {
    logger,
    open: async (connection) => await connectOnce(playwright, entry, connection),
    reasonOf,
  });
  holdLease(value, lease);
  return value;
}

async function connectOnce(
  playwright: typeof import("playwright-core"),
  entry: RemoteTarget,
  connection: RemoteConnection,
): Promise<Browser> {
  const { headers, endpoint } = connection;
  const timeout = entry.remote.timeouts.connectMs;
  if (entry.remote.protocol === "cdp") {
    return await playwright.chromium.connectOverCDP(endpoint, {
      timeout,
      ...(headers === undefined ? {} : { headers }),
    });
  }
  return await playwright[entry.engine === "chrome" ? "chromium" : entry.engine].connect(endpoint, {
    timeout,
    ...(headers === undefined ? {} : { headers }),
    ...(entry.reach === "loopback" ? { exposeNetwork: "<loopback>" } : {}),
  });
}

/** What failed, in one line, with the version mismatch spelled out and the credentials removed. */
function reasonOf(error: unknown, connection: RemoteConnection & { lease?: unknown }): string {
  const text = error instanceof Error ? error.message : String(error);
  const mismatch = versionMismatch(text);
  if (mismatch !== null) {
    return mismatch;
  }
  const line =
    text
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "the connection failed";
  return scrubConnection(line, connection);
}

/**
 * A Playwright server of another version answers the handshake with a box naming both versions;
 * restate it with the one this runner has, so the operator knows which side to move.
 */
function versionMismatch(text: string): string | null {
  const server = /server version:\s*v?([\d.]+)/u.exec(text)?.[1];
  const client = /client version:\s*v?([\d.]+)/u.exec(text)?.[1];
  if (server === undefined || client === undefined) {
    return null;
  }
  return `Playwright version mismatch: the server runs v${server} but this runner's playwright-core is ${playwrightVersion()}; run the server at exactly ${playwrightVersion()} (see the self-hosted farm guide)`;
}
