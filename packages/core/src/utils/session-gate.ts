/** Per-target session caps for remote browsers, shared by every render in the process (ADR 0007, decision 4). */

/** Runs work under a fixed number of sessions. */
export interface SessionGate {
  /** Sessions the plan allows. */
  readonly size: number;
  /** Run `fn` once a session is free. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

const gates = new Map<string, SessionGate>();

/**
 * The gate of `target`, created on first use. One gate per target for the whole process, so
 * concurrent shards share the cap instead of multiplying it. A later call with another `sessions`
 * keeps the first gate: the size is the runner's configuration and does not change under it.
 */
export function sessionGateFor(target: string, sessions: number): SessionGate {
  let gate = gates.get(target);
  if (gate === undefined) {
    gate = createSessionGate(sessions);
    gates.set(target, gate);
  }
  return gate;
}

/** A gate of its own (not shared through {@link sessionGateFor}); `size` below 1 counts as 1. */
export function createSessionGate(size: number): SessionGate {
  const limit = Math.max(1, Math.floor(size));
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
    } else {
      next();
    }
  };
  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };
  return {
    size: limit,
    run: async (fn) => {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
