import type { Logger } from "../logger.ts";
/**
 * Leasing a remote browser connection (ADR 0007, decision 4): `acquire` before the handshake,
 * `release` once the render that used it has ended. The runners own the handshake itself; this owns
 * the pairing, so a lease is released exactly once on every path (finish, failure, cancel,
 * shutdown) and never logged.
 */
import { isRetryableConnectError, retryConnect } from "../utils/connect-retry.ts";
import { TargetLaunchError } from "./capture-target.ts";
import {
  reachOf,
  type RemoteConnection,
  type RemoteLeaseContext,
  type RemoteLeaseOutcome,
  type RemoteLeasedConnection,
  type RemoteTarget,
} from "./remote-browser.ts";

/** A connection that is held until its render ends. */
export interface HeldConnection {
  /** The connection to open: `acquire`'s result, or `connect`'s when the service has no `acquire`. */
  readonly connection: RemoteConnection;
  /** Release the lease with how the render ended; later calls do nothing (the first outcome wins). */
  end(outcome: RemoteLeaseOutcome): Promise<void>;
}

/** Options of {@link connectLeased}. */
export interface ConnectLeasedOptions<T> {
  logger?: Logger | undefined;
  /** The handshake over one connection; its failures are retried when connection-level. */
  open: (connection: RemoteConnection) => Promise<T>;
  /** One line saying what failed, with the connection's credentials removed. */
  reasonOf: (error: unknown, connection: RemoteConnection) => string;
  /** Whether a handshake error is permanent; defaults to the connection-error rule. */
  retryable?: (error: unknown) => boolean;
}

/** `acquire` failed (threw, timed out or broke its contract). */
class AcquireError extends Error {
  override readonly name = "AcquireError";
  readonly transient: boolean;

  constructor(message: string, options: { cause?: unknown; transient: boolean }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.transient = options.transient;
  }
}

const held = new Set<HeldConnection>();

/**
 * Acquire (when the service has `acquire`) and open a connection, as one retried attempt: a failed
 * handshake releases its lease as `failed` before the next attempt acquires again, so at most one
 * lease is held per connection. On success the caller owns the returned lease and must call
 * {@link HeldConnection.end}; on failure nothing is held and a {@link TargetLaunchError} is thrown
 * (`transient` unless the provider's error says `transient: false` or the handshake error is
 * permanent).
 */
export async function connectLeased<T>(
  entry: RemoteTarget,
  context: Pick<RemoteLeaseContext, "buildId" | "shardIndex">,
  options: ConnectLeasedOptions<T>,
): Promise<{ value: T; lease: HeldConnection }> {
  const { remote, target } = entry;
  // What scrubs an acquire failure: the lease is not there yet, `connect`'s shape stands in.
  const template = remote.connect(entry.engine);
  const retryable = (error: unknown): boolean =>
    error instanceof AcquireError
      ? error.transient
      : (options.retryable ?? isRetryableConnectError)(error);
  let current: RemoteConnection = template;
  try {
    return await retryConnect(
      async () => {
        const lease = await acquireConnection(entry, context, options.logger);
        current = lease.connection;
        try {
          return { value: await options.open(lease.connection), lease };
        } catch (error) {
          await lease.end("failed");
          throw error;
        }
      },
      {
        retries: remote.connectRetries,
        backoffMs: remote.connectBackoffMs,
        retryable,
        onRetry: (error, retry, delayMs) => {
          options.logger?.warn(
            { target, retry, delayMs, reason: options.reasonOf(error, current) },
            "remote browser connect failed, retrying",
          );
        },
      },
    );
  } catch (error) {
    const reason = options.reasonOf(error, current);
    throw new TargetLaunchError(target, reason, {
      cause: Object.assign(new Error(reason), {
        name: error instanceof Error ? error.name : "Error",
      }),
      transient: retryable(error),
    });
  }
}

/**
 * Release every lease still held, as `cancelled`: for a runner shutting down, so a provider's
 * server is not left running by a process that is gone.
 */
export async function releaseAllLeases(): Promise<void> {
  await Promise.all(
    [...held].map(async (lease) => {
      await lease.end("cancelled");
    }),
  );
}

async function acquireConnection(
  entry: RemoteTarget,
  context: Pick<RemoteLeaseContext, "buildId" | "shardIndex">,
  logger: Logger | undefined,
): Promise<HeldConnection> {
  const { remote } = entry;
  if (remote.acquire === undefined) {
    return {
      connection: remote.connect(entry.engine),
      end: async () => {
        await Promise.resolve();
      },
    };
  }
  const acquired = await acquireWithin(
    entry,
    remote.acquire,
    { engine: entry.engine, ...context },
    logger,
  );
  const { lease, ...connection } = acquired;
  const connectionHeld = holdLease(entry, lease, connection, logger);
  if (reachOf(connection) !== entry.reach) {
    await connectionHeld.end("failed");
    throw new AcquireError(
      `acquire returned a connection that ${entry.reach === "loopback" ? "lacks" : "sets"} exposeNetwork, unlike connect(): the reach of a target cannot change`,
      { transient: false },
    );
  }
  return connectionHeld;
}

/** What `acquire` returns: the connection and its lease. */
type Acquired = RemoteLeasedConnection;

/** `acquire` under its timeout; a lease that arrives after the timeout is released at once. */
async function acquireWithin(
  entry: RemoteTarget,
  acquire: (context: RemoteLeaseContext) => Promise<Acquired>,
  context: RemoteLeaseContext,
  logger: Logger | undefined,
): Promise<Acquired> {
  const pending = acquire(context);
  try {
    return await withDeadline(pending, entry.remote.acquireTimeoutMs, async (late) => {
      await holdLease(entry, late.lease, late, logger).end("failed");
    });
  } catch (error) {
    throw acquireErrorOf(error);
  }
}

/** `pending`, or a transient timeout error; `onLate` gets a value that settles after the deadline. */
async function withDeadline<T>(
  pending: Promise<T>,
  ms: number,
  onLate: (late: T) => Promise<void>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new AcquireError(`acquire timed out after ${ms} ms`, { transient: true }));
    }, ms);
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
    if (timedOut) {
      pending.then(onLate, () => {});
    }
  }
}

/** A provider's error as an {@link AcquireError}: transient unless it says `transient: false`. */
function acquireErrorOf(error: unknown): AcquireError {
  if (error instanceof AcquireError) {
    return error;
  }
  return new AcquireError(
    `acquire failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error, transient: (error as { transient?: unknown } | null)?.transient !== false },
  );
}

function holdLease(
  entry: RemoteTarget,
  lease: unknown,
  connection: RemoteConnection,
  logger: Logger | undefined,
): HeldConnection {
  let ended = false;
  const connectionHeld: HeldConnection = {
    connection,
    end: async (outcome) => {
      if (ended) {
        return;
      }
      ended = true;
      held.delete(connectionHeld);
      try {
        await entry.remote.release?.(lease, outcome);
      } catch (error) {
        // Never the lease or the error text: either can carry a credential.
        logger?.warn(
          { target: entry.target, outcome, err: error instanceof Error ? error.name : "Error" },
          "remote browser release failed",
        );
      }
    },
  };
  held.add(connectionHeld);
  return connectionHeld;
}
