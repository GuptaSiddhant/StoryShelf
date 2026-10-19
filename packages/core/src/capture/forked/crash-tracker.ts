/** Counts child crashes inside a sliding window, to tell a flaky child from a crash loop. */
export class CrashTracker {
  readonly #limit: number;
  readonly #windowMs: number;
  #times: number[] = [];

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Record a crash; true when this one reaches the limit within the window. */
  record(now: number = Date.now()): boolean {
    this.#times = [...this.#times.filter((time) => now - time < this.#windowMs), now];
    return this.#times.length >= this.#limit;
  }
}
