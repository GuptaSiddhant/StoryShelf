/** A `connect` attempt in flight, so a cancel or shutdown can reach it (ADR 0007, decision 4). */

/** A `connect` attempt in flight: aborted by its deadline, a cancel or shutdown. */
export interface Attempt {
  readonly controller: AbortController;
  stopped: boolean;
  stop(): void;
  /** Stop listening to the run's signal, so retries do not pile up listeners on it. */
  detach(): void;
}

const attempts = new Set<Attempt>();

/** Start an attempt tied to the run's signal; a signal already aborted stops it at once. */
export function startAttempt(parent?: AbortSignal): Attempt {
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

/** The attempt is over: forget it and stop listening to the run's signal. */
export function endAttempt(attempt: Attempt): void {
  attempts.delete(attempt);
  attempt.detach();
}

/** Stop every attempt still pending (shutdown). */
export function stopAllAttempts(): void {
  for (const attempt of attempts) {
    attempt.stop();
  }
}
