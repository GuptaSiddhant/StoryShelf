/**
 * Thrown by a running job's progress and log hooks once its attempt was abandoned (the job's
 * deadline passed, so a redelivery may already be running): the old invocation stops at its next
 * checkpoint and writes nothing more. Nothing in the capture path may swallow or report it.
 */
export class JobAbortedError extends Error {
  constructor(reason: unknown) {
    super(reason instanceof Error ? reason.message : "job aborted", { cause: reason });
    this.name = "JobAbortedError";
  }
}

/** Throw a {@link JobAbortedError} when `signal` is aborted; do nothing otherwise. */
export function throwIfJobAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new JobAbortedError(signal.reason);
  }
}
