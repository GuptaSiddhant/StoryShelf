/** Connecting to a remote browser: retried when the service is unreachable or full, a clear error when it is not. */
import {
  connectLeased,
  scrubConnection,
  type ConnectLeasedContext,
  type RemoteConnection,
  type RemoteTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import type { BrowserAcquisition } from "./session.ts";

/**
 * Connect to `entry`'s service and return the browser with its ownership: the run must disconnect
 * it, never close it, and releases the service's lease (a function `connect`'s `lease`) exactly
 * once when the session ends. Connection-level failures are retried with backoff, so a provider
 * outage or a full plan costs time and not a story crash; what is left is a `TargetLaunchError`,
 * which fails the job at once (a refused credential also marks the target unavailable, a service
 * that is merely down does not). No message carries the endpoint, its credentials or the lease.
 */
export async function connectRemote(
  entry: RemoteTarget,
  context: ConnectLeasedContext,
  logger?: Logger,
): Promise<BrowserAcquisition> {
  const { value, lease } = await connectLeased(entry, context, {
    logger,
    open: async (connection) => await connectOnce(connection, entry.remote.timeouts.connectMs),
    reasonOf,
  });
  return {
    browser: value,
    ownership: "connected",
    releaseLease: async (outcome, error) => {
      await lease.end(outcome, error);
    },
  };
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
function reasonOf(error: unknown, connection: RemoteConnection & { lease?: unknown }): string {
  const text = error instanceof Error ? error.message : String(error);
  const line =
    text
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "the connection failed";
  return scrubConnection(line, connection);
}
