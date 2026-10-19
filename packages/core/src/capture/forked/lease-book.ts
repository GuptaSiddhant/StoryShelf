/** Progress leases for jobs out with the capture child: no progress within the lease means the child is hung. */
import { ProgressLease } from "../job-lease.ts";

/** One {@link ProgressLease} per in-flight receipt. A `leaseMs` of 0 disables the whole book. */
export class LeaseBook {
  readonly #leaseMs: number;
  readonly #onExpired: (receipt: string) => void;
  readonly #leases = new Map<string, ProgressLease>();

  constructor(leaseMs: number, onExpired: (receipt: string) => void) {
    this.#leaseMs = leaseMs;
    this.#onExpired = onExpired;
  }

  /** Start watching a delivered job. */
  start(receipt: string): void {
    if (this.#leaseMs <= 0) {
      return;
    }
    this.stop(receipt);
    const lease = new ProgressLease(this.#leaseMs);
    this.#leases.set(receipt, lease);
    lease.expired.then(
      () => {
        if (this.#leases.get(receipt) === lease) {
          this.#leases.delete(receipt);
          this.#onExpired(receipt);
        }
      },
      () => {},
    );
  }

  /** The job under `receipt` made progress. */
  touch(receipt: string): void {
    this.#leases.get(receipt)?.touch();
  }

  /** The job ended (or was taken back); stop watching it. */
  stop(receipt: string): void {
    this.#leases.get(receipt)?.stop();
    this.#leases.delete(receipt);
  }

  stopAll(): void {
    for (const lease of this.#leases.values()) {
      lease.stop();
    }
    this.#leases.clear();
  }
}
