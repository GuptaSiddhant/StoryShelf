/** `mapLimit` with a live, self-adjusting limit. */
import type { AdaptiveConcurrency } from "./adaptive-concurrency.ts";

/**
 * Like `mapLimit`, but the limit is read live from `controller` and every finished item is fed
 * back to it. `fn` reports a timeout it handled itself with `timedOut: true`.
 */
export async function mapAdaptive<T, R>(
  items: readonly T[],
  controller: AdaptiveConcurrency,
  fn: (item: T, index: number) => Promise<{ value: R; timedOut?: boolean }>,
): Promise<R[]> {
  return await new AdaptiveRun(items, controller, fn).run();
}

class AdaptiveRun<T, R> {
  private readonly results: R[];
  private next = 0;
  private active = 0;
  private failure: { error: Error } | null = null;
  private finish: { resolve: (value: R[]) => void; reject: (error: Error) => void } | null = null;

  constructor(
    private readonly items: readonly T[],
    private readonly controller: AdaptiveConcurrency,
    private readonly fn: (item: T, index: number) => Promise<{ value: R; timedOut?: boolean }>,
  ) {
    this.results = Array.from<R>({ length: items.length });
  }

  async run(): Promise<R[]> {
    return await new Promise<R[]>((resolve, reject) => {
      this.finish = { resolve, reject };
      this.pump();
    });
  }

  private pump(): void {
    while (this.canLaunch()) {
      this.launch(this.next);
      this.next += 1;
    }
    if (this.active === 0 && (this.failure || this.next >= this.items.length)) {
      if (this.failure) {
        this.finish?.reject(this.failure.error);
      } else {
        this.finish?.resolve(this.results);
      }
    }
  }

  private canLaunch(): boolean {
    return !this.failure && this.active < this.controller.limit && this.next < this.items.length;
  }

  private launch(index: number): void {
    this.active += 1;
    const started = performance.now();
    this.fn(this.items[index] as T, index).then(
      (outcome) => {
        this.results[index] = outcome.value;
        this.controller.observe({
          durationMs: performance.now() - started,
          timedOut: outcome.timedOut,
        });
        this.settle();
      },
      (error: unknown) => {
        this.failure ??= { error: error instanceof Error ? error : new Error(String(error)) };
        this.settle();
      },
    );
  }

  private settle(): void {
    this.active -= 1;
    this.pump();
  }
}
