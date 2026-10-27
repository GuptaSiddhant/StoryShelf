/** A connection held until its render ends, and the one release it owes (ADR 0007, decision 4). */
import type { Logger } from "../logger.ts";
import type { RemoteConnection, RemoteLeaseOutcome, RemoteTarget } from "./remote-browser.ts";

/** A connection held until its render ends. */
export interface HeldConnection {
  /** The connection to open (with its lease, for scrubbing): the function's result, or the fixed object. */
  readonly connection: RemoteConnection & { lease?: unknown };
  /** Release the lease with how the render ended; later calls do nothing (the first outcome wins). */
  end(outcome: RemoteLeaseOutcome, error?: unknown): Promise<void>;
}

const held = new Set<HeldConnection>();
const warnedNoLease = new Set<string>();

/** Release every lease still held, as `cancelled`. */
export async function releaseAllHeld(): Promise<void> {
  await Promise.all(
    [...held].map(async (lease) => {
      await lease.end("cancelled");
    }),
  );
}

/** `pending`, or the error `onTimeout` makes after `ms`. */
export async function withDeadline<T>(
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

export function noLease(connection: RemoteConnection): HeldConnection {
  return {
    connection,
    end: async () => {
      await Promise.resolve();
    },
  };
}

/**
 * Hold `lease` for `connection`: `end` calls the service's `release` once, bounded by
 * `timeouts.releaseMs`, and a failing or hanging release is logged (class only) and never thrown.
 * No lease means nothing to release: a warning says so once per target when `release` is set.
 */
export function holdLease(
  entry: RemoteTarget,
  lease: unknown,
  connection: RemoteConnection,
  logger?: Logger,
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
