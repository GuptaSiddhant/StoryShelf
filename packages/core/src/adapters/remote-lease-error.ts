/** How a connect failure is classified (ADR 0007, decision 4): retried or not, and what it does to the target. */
import { isRetryableConnectError } from "../utils/connect-retry.ts";

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

/** Marks the error of a `connect` abandoned because the run was cancelled or the process is shutting down. */
const STOPPED = Symbol("remote connect stopped");

/** The error of a `connect` that was cancelled or cut short by shutdown: never retried. */
export function stoppedError(): Error {
  return Object.assign(new Error("cancelled while connecting"), { [STOPPED]: true });
}

/** What a connect error means: whether to retry it, and whether it marks the target unavailable. */
export function classify(error: unknown): { retry: boolean; unavailable: boolean } {
  if (typeof error === "object" && error !== null && STOPPED in error) {
    return { retry: false, unavailable: false };
  }
  if (error instanceof RemoteConnectError) {
    return { retry: error.transient, unavailable: !error.transient && error.scope !== "job" };
  }
  const retry = isRetryableConnectError(error);
  return { retry, unavailable: !retry };
}

/** A provider's thrown value as a {@link RemoteConnectError}: transient unless it says `transient: false`. */
export function connectErrorOf(error: unknown): RemoteConnectError {
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
