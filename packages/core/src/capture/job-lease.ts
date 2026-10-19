/** Progress lease for in-process capture jobs: the same expiry idea as a remote queue's visibility timeout. */

/** What a running job calls to prove it is still making progress. */
export interface JobLease {
  /** Record progress; pushes the expiry out by a full lease. */
  touch(): void;
}

/**
 * A lease renewed by progress rather than a timer.
 *
 * A timer heartbeat inside the same process would keep renewing even when the capture is hung, so
 * liveness is reported by the job itself (every attempt-log line, i.e. each stage and render
 * progress). If nothing is touched for `leaseMs`, {@link expired} resolves.
 */
export class ProgressLease implements JobLease {
  /** Resolves once, when no progress was seen for a full lease. Never resolves when disabled or stopped. */
  readonly expired: Promise<true>;
  private lastTouch = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly expire: () => void;

  constructor(private readonly leaseMs: number) {
    const { promise, resolve } = Promise.withResolvers<true>();
    this.expired = promise;
    this.expire = (): void => {
      resolve(true);
    };
    if (leaseMs > 0) {
      this.arm(leaseMs);
    }
  }

  touch(): void {
    this.lastTouch = Date.now();
  }

  /** Stop watching; idempotent. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private arm(delayMs: number): void {
    this.timer = setTimeout(
      () => {
        this.check();
      },
      Math.max(1, delayMs),
    );
    this.timer.unref();
  }

  private check(): void {
    if (this.stopped) {
      return;
    }
    const idleMs = Date.now() - this.lastTouch;
    if (idleMs >= this.leaseMs) {
      this.stopped = true;
      this.expire();
      return;
    }
    this.arm(this.leaseMs - idleMs);
  }
}
