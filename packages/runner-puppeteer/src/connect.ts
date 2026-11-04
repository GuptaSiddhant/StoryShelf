import {
  connectLeased,
  scrubConnection,
  type ConnectLeasedContext,
  type RemoteConnection,
  type RemoteTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
/** Connecting to a remote browser: retried when the service is unreachable or full, a clear error when it is not. */
import { errorText } from "@storyshelf/core/utils";
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

/** How much of an error is read, and how much of its first line is kept, once the connection's secrets are out. */
const SCAN_LENGTH = 4000;
const REASON_LENGTH = 500;

/** What failed, in one bounded line with the credentials removed. */
export function reasonOf(
  error: unknown,
  connection: RemoteConnection & { lease?: unknown },
): string {
  // The connection's secrets go first, whole, then the pattern redaction, then the cut.
  const text = errorText(error, {
    maxLength: SCAN_LENGTH,
    scrub: (shown) => scrubConnection(shown, connection),
  });
  const line =
    text
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "the connection failed";
  return line.slice(0, REASON_LENGTH);
}
