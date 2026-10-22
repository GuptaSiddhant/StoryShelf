/** Connecting to a remote browser: retried when the service is unreachable or full, a clear error when it is not. */
import {
  TargetLaunchError,
  scrubConnection,
  type RemoteConnection,
  type RemoteTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import { isRetryableConnectError, retryConnect } from "@storyshelf/core/utils";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";

/**
 * Connect to `entry`'s service and return its browser. Connection-level failures are retried with
 * backoff, so a provider outage or a full plan costs time and not a story crash; what is left is
 * a {@link TargetLaunchError}, which fails the job at once (a refused credential also marks the
 * target unavailable, a service that is merely down does not). No message carries the endpoint
 * or its credentials.
 */
export async function connectRemote(entry: RemoteTarget, logger?: Logger): Promise<Browser> {
  const { remote, target } = entry;
  const connection = remote.connect(entry.engine);
  try {
    return await retryConnect(async () => await connectOnce(connection, remote.connectTimeoutMs), {
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
      cause: new Error(reasonOf(error, connection)),
      transient: isRetryableConnectError(error),
    });
  }
}

async function connectOnce(connection: RemoteConnection, timeoutMs: number): Promise<Browser> {
  const isHttp = connection.endpoint.startsWith("http");
  return await puppeteer.connect({
    ...(isHttp ? { browserURL: connection.endpoint } : { browserWSEndpoint: connection.endpoint }),
    protocolTimeout: timeoutMs,
    ...(connection.headers === undefined ? {} : { headers: connection.headers }),
  });
}

/** What failed, in one line, with the endpoint and credentials removed. */
function reasonOf(error: unknown, connection: RemoteConnection): string {
  const text = error instanceof Error ? error.message : String(error);
  const line =
    text
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "the connection failed";
  return scrubConnection(line, connection);
}
