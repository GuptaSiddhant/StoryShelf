/**
 * Connecting to a remote browser over a lease (ADR 0007, decision 4): a function `connect` is
 * called per connection, and `release` once the render that used it has ended. The runners own the
 * handshake itself; this owns the pairing, so a lease is released exactly once on every path
 * (finish, failure, cancel, shutdown) and never logged.
 */
import type { Logger } from "../logger.ts";
import { isRetryableConnectError, retryConnect } from "../utils/connect-retry.ts";
import { TargetLaunchError } from "./capture-target.ts";
import {
  hasSchemeFor,
  schemesOf,
  type RemoteConnectContext,
  type RemoteConnection,
  type RemoteLeaseOutcome,
  type RemoteLeasedConnection,
  type RemoteTarget,
} from "./remote-browser.ts";

/** What a connect failure means for the retry loop and for the target. */
export interface RemoteConnectErrorOptions {
  /** `false` stops the retries and fails the job (default `true`: retried). */
  transient?: boolean | undefined;
  /**
   * For `transient: false`: `target` (default) also marks the target unavailable until restart,
   * `job` fails only this job and keeps the target offered (a per-shard server that is gone).
   */
  scope?: "target" | "job" | undefined;
  /** A lease the failed `connect` already took, released as `failed`. */
  lease?: unknown;
  cause?: unknown;
}

/** An error a function `connect` throws to say how the runner should treat the failure. */
export class RemoteConnectError extends Error {
  override readonly name = "RemoteConnectError";
  readonly transient: boolean;
  readonly scope: "target" | "job";
  readonly lease: unknown;

  constructor(message: string, options: RemoteConnectErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.transient = options.transient ?? true;
    this.scope = options.scope ?? "target";
    this.lease = options.lease;
  }
}

/** A connection held until its render ends. */
export interface HeldConnection {
  /** The connection to open (with its lease, for scrubbing): the function's result, or the fixed object. */
  readonly connection: RemoteConnection & { lease?: unknown };
  /** Release the lease with how the render ended; later calls do nothing (the first outcome wins). */
  end(outcome: RemoteLeaseOutcome, error?: unknown): Promise<void>;
}

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

/** A `connect` attempt in flight: aborted by its deadline, a cancel or shutdown. */
interface Attempt {
  readonly controller: AbortController;
  stopped: boolean;
  stop(): void;
  /** Stop listening to the run's signal, so retries do not pile up listeners on it. */
  detach(): void;
}

/** Marks the error of a `connect` abandoned because the run was cancelled or the process is shutting down. */
const STOPPED = Symbol("remote connect stopped");

function stoppedError(): Error {
  return Object.assign(new Error("cancelled while connecting"), { [STOPPED]: true });
}

type ConnectFn = (
  context: RemoteConnectContext,
) => RemoteLeasedConnection | Promise<RemoteLeasedConnection>;

const held = new Set<HeldConnection>();
const attempts = new Set<Attempt>();
const shutdownHooks = new Set<() => Promise<void>>();
const warnedNoLease = new Set<string>();

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

/**
 * Stop everything remote this process holds, for a runner shutting down: abort pending `connect`
 * calls, release every lease still held as `cancelled`, then run the shutdown hooks (pools close
 * their resources). A server is not left running by a process that is gone.
 */
export async function shutdownRemote(): Promise<void> {
  for (const attempt of attempts) {
    attempt.stop();
  }
  await Promise.all(
    [...held].map(async (lease) => {
      await lease.end("cancelled");
    }),
  );
  await Promise.all(
    [...shutdownHooks].map(async (hook) => {
      await hook();
    }),
  );
}

/** Run `hook` on shutdown; returns the function that unregisters it. */
export function onRemoteShutdown(hook: () => Promise<void>): () => void {
  shutdownHooks.add(hook);
  return () => {
    shutdownHooks.delete(hook);
  };
}

/** What a connect error means: whether to retry it, and whether it marks the target unavailable. */
function classify(error: unknown): { retry: boolean; unavailable: boolean } {
  if (typeof error === "object" && error !== null && STOPPED in error) {
    return { retry: false, unavailable: false };
  }
  if (error instanceof RemoteConnectError) {
    return { retry: error.transient, unavailable: !error.transient && error.scope !== "job" };
  }
  const retry = isRetryableConnectError(error);
  return { retry, unavailable: !retry };
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
    attempts.delete(attempt);
    attempt.detach();
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

function connectErrorOf(error: unknown): RemoteConnectError {
  const flags = (typeof error === "object" && error !== null ? error : {}) as {
    transient?: unknown;
    scope?: unknown;
    lease?: unknown;
  };
  return new RemoteConnectError(
    `acquire failed: ${error instanceof Error ? error.message : String(error)}`,
    {
      cause: error,
      transient: flags.transient !== false,
      scope: flags.scope === "job" ? "job" : "target",
      lease: flags.lease,
    },
  );
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

function startAttempt(parent: AbortSignal | undefined): Attempt {
  const controller = new AbortController();
  const onAbort = (): void => {
    attempt.stop();
  };
  const attempt: Attempt = {
    controller,
    stopped: false,
    stop: () => {
      attempt.stopped = true;
      controller.abort();
    },
    detach: () => {
      parent?.removeEventListener("abort", onAbort);
    },
  };
  attempts.add(attempt);
  if (parent?.aborted === true) {
    attempt.stop();
  } else {
    parent?.addEventListener("abort", onAbort, { once: true });
  }
  return attempt;
}

/** `pending`, or the error `onTimeout` makes after `ms`. */
async function withDeadline<T>(
  pending: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(onTimeout());
    }, ms);
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
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

function noLease(connection: RemoteConnection): HeldConnection {
  return {
    connection,
    end: async () => {
      await Promise.resolve();
    },
  };
}

function holdLease(
  entry: RemoteTarget,
  lease: unknown,
  connection: RemoteConnection,
  logger: Logger | undefined,
): HeldConnection {
  const { release, timeouts } = entry.remote;
  if (lease === undefined) {
    if (release !== undefined && !warnedNoLease.has(entry.target)) {
      warnedNoLease.add(entry.target);
      logger?.warn(
        { target: entry.target },
        "remote release is set but connect returned no lease, so release is skipped",
      );
    }
    return noLease(connection);
  }
  let ended = false;
  const connectionHeld: HeldConnection = {
    connection: { ...connection, lease },
    end: async (outcome, error) => {
      if (ended) {
        return;
      }
      ended = true;
      held.delete(connectionHeld);
      await runRelease(
        entry,
        async () => {
          await release?.(lease as never, { outcome, error });
        },
        timeouts.releaseMs,
        { logger, outcome },
      );
    },
  };
  held.add(connectionHeld);
  return connectionHeld;
}

async function runRelease(
  entry: RemoteTarget,
  call: () => Promise<void>,
  timeoutMs: number,
  log: { logger: Logger | undefined; outcome: RemoteLeaseOutcome },
): Promise<void> {
  try {
    await withDeadline(call(), timeoutMs, () =>
      Object.assign(new Error(`release timed out after ${timeoutMs} ms`), {
        name: "ReleaseTimeout",
      }),
    );
  } catch (error) {
    // Never the lease or the error text: either can carry a credential.
    log.logger?.warn(
      {
        target: entry.target,
        outcome: log.outcome,
        err: error instanceof Error ? error.name : "Error",
      },
      "remote browser release failed",
    );
  }
}
