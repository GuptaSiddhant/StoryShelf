/** Connecting to a remote browser: retried when the service is unreachable or full, a clear error when it is not. */
import {
  TargetLaunchError,
  scrubConnection,
  type RemoteConnection,
  type RemoteTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import { isRetryableConnectError, retryConnect } from "@storyshelf/core/utils";
import type { Browser } from "playwright-core";
import { loadPlaywright } from "./launch.ts";
import { playwrightVersion } from "./version.ts";

/**
 * Connect to `entry`'s service and return its browser. Connection-level failures are retried with
 * backoff, so a provider outage or a full plan costs time and not a story crash; what is left
 * is a {@link TargetLaunchError}, which fails the job at once (a wrong version or credential also
 * marks the target unavailable, a service that is merely down does not). Nothing in a message
 * carries the endpoint or its credentials.
 */
export async function connectRemote(entry: RemoteTarget, logger?: Logger): Promise<Browser> {
  const { remote, target } = entry;
  const connection = remote.connect(entry.engine);
  try {
    const playwright = await loadPlaywright();
    return await retryConnect(async () => await connectOnce(playwright, entry, connection), {
      retries: remote.connectRetries,
      backoffMs: remote.connectBackoffMs,
      onRetry: (error, retry, delayMs) => {
        logger?.warn(
          { target, retry, delayMs, reason: reasonOf(error, connection) },
          "remote browser connect failed, retrying",
        );
      },
    });
  } catch (error) {
    throw new TargetLaunchError(target, reasonOf(error, connection), {
      cause: scrubbedCause(error, connection),
      transient: isRetryableConnectError(error),
    });
  }
}

async function connectOnce(
  playwright: typeof import("playwright-core"),
  entry: RemoteTarget,
  connection: RemoteConnection,
): Promise<Browser> {
  const { headers, endpoint } = connection;
  if (connection.protocol === "cdp") {
    return await playwright.chromium.connectOverCDP(endpoint, {
      timeout: entry.remote.connectTimeoutMs,
      ...(headers === undefined ? {} : { headers }),
    });
  }
  return await playwright[entry.engine === "chrome" ? "chromium" : entry.engine].connect(endpoint, {
    timeout: entry.remote.connectTimeoutMs,
    ...(headers === undefined ? {} : { headers }),
    ...(connection.exposeNetwork === undefined ? {} : { exposeNetwork: connection.exposeNetwork }),
  });
}

/** What failed, in one line, with the version mismatch spelled out and the credentials removed. */
function reasonOf(error: unknown, connection: RemoteConnection): string {
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

function scrubbedCause(error: unknown, connection: RemoteConnection): Error {
  const copy = new Error(reasonOf(error, connection));
  copy.name = error instanceof Error ? error.name : "Error";
  return copy;
}
