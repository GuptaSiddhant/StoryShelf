/**
 * Connecting to a remote browser over a lease (ADR 0007, decision 4): a function `connect` is
 * called per connection, and `release` once the render that used it has ended. The runners own the
 * handshake itself; this owns the pairing, so a lease is released exactly once on every path
 * (finish, failure, cancel, shutdown) and never logged.
 */
import type { Logger } from "../logger.ts";
import { retryConnect } from "../utils/connect-retry.ts";
import { TargetLaunchError } from "./capture-target.ts";
import {
  hasSchemeFor,
  schemesOf,
  type RemoteConnectContext,
  type RemoteConnection,
  type RemoteLeasedConnection,
  type RemoteTarget,
} from "./remote-browser.ts";
import { endAttempt, startAttempt, type Attempt } from "./remote-lease-attempt.ts";
import {
  RemoteConnectError,
  classify,
  connectErrorOf,
  stoppedError,
} from "./remote-lease-error.ts";
import { holdLease, noLease, withDeadline, type HeldConnection } from "./remote-lease-held.ts";

export { RemoteConnectError, type RemoteConnectErrorOptions } from "./remote-lease-error.ts";
export type { HeldConnection } from "./remote-lease-held.ts";
export { onRemoteShutdown, shutdownRemote } from "./remote-lease-shutdown.ts";

/** Which run a connection is for. */
export interface ConnectLeasedContext {
  buildId: string;
  runId: string;
  shardIndex?: number | undefined;
  purpose: RemoteConnectContext["purpose"];
  /** Aborts a pending `connect` when the run is cancelled. */
  signal?: AbortSignal | undefined;
}

/** Options of {@link connectLeased}. */
export interface ConnectLeasedOptions<T> {
  logger?: Logger | undefined;
  /** The handshake over one connection; its failures are retried when connection-level. */
  open: (connection: RemoteConnection) => Promise<T>;
  /** One line saying what failed, with the connection's credentials removed. */
  reasonOf: (error: unknown, connection: RemoteConnection & { lease?: unknown }) => string;
}

type ConnectFn = (
  context: RemoteConnectContext,
) => RemoteLeasedConnection | Promise<RemoteLeasedConnection>;

/**
 * Connect (calling `connect` when it is a function) and open the connection, as one retried
 * attempt: a failed handshake releases its lease as `failed` before the next attempt connects
 * again, so at most one lease is held per connection. On success the caller owns the returned
 * lease and must call {@link HeldConnection.end}; on failure nothing is held and a
 * {@link TargetLaunchError} is thrown.
 */
export async function connectLeased<T>(
  entry: RemoteTarget,
  context: ConnectLeasedContext,
  options: ConnectLeasedOptions<T>,
): Promise<{ value: T; lease: HeldConnection }> {
  const { remote } = entry;
  let current: RemoteConnection & { lease?: unknown } =
    typeof remote.connect === "function" ? { endpoint: "" } : remote.connect;
  let attemptNo = 0;
  try {
    return await retryConnect(
      async () => {
        attemptNo += 1;
        const lease = await acquire(entry, context, attemptNo, options.logger);
        current = lease.connection;
        try {
          return { value: await options.open(lease.connection), lease };
        } catch (error) {
          await lease.end("failed", error);
          throw error;
        }
      },
      {
        retries: remote.retry.attempts,
        backoffMs: remote.retry.backoffMs,
        retryable: (error) => classify(error).retry,
        onRetry: (error, retry, delayMs) => {
          options.logger?.warn(
            { target: entry.target, retry, delayMs, reason: options.reasonOf(error, current) },
            "remote browser connect failed, retrying",
          );
        },
      },
    );
  } catch (error) {
    const reason = options.reasonOf(error, current);
    throw new TargetLaunchError(entry.target, reason, {
      cause: Object.assign(new Error(reason), {
        name: error instanceof Error ? error.name : "Error",
      }),
      transient: !classify(error).unavailable,
    });
  }
}

async function acquire(
  entry: RemoteTarget,
  context: ConnectLeasedContext,
  attemptNo: number,
  logger: Logger | undefined,
): Promise<HeldConnection> {
  const { remote } = entry;
  if (typeof remote.connect !== "function") {
    return noLease(remote.connect);
  }
  const attempt = startAttempt(context.signal);
  try {
    const result = await called(entry, context, attemptNo, attempt, logger);
    return await adopt(entry, result, logger);
  } finally {
    endAttempt(attempt);
  }
}

/** The function `connect` under its deadline; a lease that arrives after it is released at once. */
async function called(
  entry: RemoteTarget,
  context: ConnectLeasedContext,
  attemptNo: number,
  attempt: Attempt,
  logger: Logger | undefined,
): Promise<RemoteLeasedConnection> {
  if (attempt.stopped) {
    // Cancelled during a backoff: never call the provider with a signal that is already aborted.
    throw stoppedError();
  }
  const pending = invoke(entry.remote.connect as ConnectFn, {
    engine: entry.engine,
    buildId: context.buildId,
    runId: context.runId,
    shardIndex: context.shardIndex,
    purpose: context.purpose,
    attempt: attemptNo,
    signal: attempt.controller.signal,
  });
  const { acquireMs } = entry.remote.timeouts;
  try {
    return await withDeadline(pending, acquireMs, () => {
      attempt.controller.abort();
      releaseLate(entry, pending, logger).catch(() => {});
      return new RemoteConnectError(`acquire timed out after ${acquireMs} ms`);
    });
  } catch (error) {
    throw await failedConnect(entry, error, attempt, logger);
  }
}

/** Call a sync or async `connect`, so a sync throw is a rejection like any other. */
async function invoke(
  connect: ConnectFn,
  context: RemoteConnectContext,
): Promise<RemoteLeasedConnection> {
  return await connect(context);
}

/** A function `connect`'s failure as the error to throw, releasing a lease it carried. */
async function failedConnect(
  entry: RemoteTarget,
  error: unknown,
  attempt: Attempt,
  logger: Logger | undefined,
): Promise<Error> {
  const converted = error instanceof RemoteConnectError ? error : connectErrorOf(error);
  if (converted.lease !== undefined) {
    await holdLease(entry, converted.lease, { endpoint: "" }, logger).end("failed", converted);
  }
  return attempt.stopped ? stoppedError() : converted;
}

/** Check what a function `connect` returned against what the service declared, then hold it. */
async function adopt(
  entry: RemoteTarget,
  result: RemoteLeasedConnection,
  logger: Logger | undefined,
): Promise<HeldConnection> {
  const problem = problemWith(entry, result);
  if (problem === null) {
    return holdLease(entry, result.lease, result, logger);
  }
  const lease = (result as { lease?: unknown } | null)?.lease;
  if (lease !== undefined) {
    await holdLease(entry, lease, { endpoint: "" }, logger).end("failed");
  }
  throw new RemoteConnectError(problem, { transient: false, scope: "job" });
}

function problemWith(entry: RemoteTarget, result: RemoteLeasedConnection): string | null {
  if (typeof result !== "object" || result === null || typeof result.endpoint !== "string") {
    return "connect must return an object with an endpoint";
  }
  const extra = Object.keys(result).filter(
    (key) => key !== "endpoint" && key !== "headers" && key !== "lease",
  );
  if (extra.length > 0) {
    return `connect returned ${extra.join(", ")}: protocol and reach are declared on remote(), not returned`;
  }
  const { protocol } = entry.remote;
  return hasSchemeFor(protocol, result.endpoint)
    ? null
    : `connect returned an endpoint that is not a ${schemesOf(protocol)} URL`;
}

/** A connection that arrives after its deadline is released at once. */
async function releaseLate(
  entry: RemoteTarget,
  pending: Promise<RemoteLeasedConnection>,
  logger: Logger | undefined,
): Promise<void> {
  const late = await pending.catch(() => null);
  if (late?.lease !== undefined) {
    await holdLease(entry, late.lease, { endpoint: "" }, logger).end("failed");
  }
}
