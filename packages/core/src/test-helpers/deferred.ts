/**
 * A promise a test resolves by hand, for asserting concurrency and ordering without sleeping.
 * Tests wait on `promise` to observe an in-flight state, then call `resolve()` to let it finish.
 */

/** A manually settled promise. */
export interface Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

/** Create a promise the test settles explicitly. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

/** A gate that holds every waiter until opened, then lets all future calls through. */
export interface Latch {
  wait(): Promise<void>;
  open(): void;
  readonly opened: boolean;
}

/** Create a latch that stays open once opened. */
export function createLatch(): Latch {
  let opened = false;
  const waiters: Deferred[] = [];
  return {
    wait: () => {
      if (opened) return Promise.resolve();
      const waiter = deferred();
      waiters.push(waiter);
      return waiter.promise;
    },
    open: () => {
      opened = true;
      for (const waiter of waiters.splice(0)) waiter.resolve();
    },
    get opened() {
      return opened;
    },
  };
}

/** A set of deferreds a test can release one at a time, in order. */
export interface ReleaseQueue {
  /** The next deferred to hand to a task. */
  next(): Promise<void>;
  /** Release the oldest waiter. */
  release(): void;
  /** Release every waiter created so far. */
  releaseAll(): void;
  /** Waiters created but not released yet. */
  readonly pending: number;
}

/** Create a FIFO release queue. */
export function createReleaseQueue(): ReleaseQueue {
  const waiters: Deferred[] = [];
  return {
    next: () => {
      const waiter = deferred();
      waiters.push(waiter);
      return waiter.promise;
    },
    release: () => {
      waiters.shift()?.resolve();
    },
    releaseAll: () => {
      for (const waiter of waiters.splice(0)) waiter.resolve();
    },
    get pending() {
      return waiters.length;
    },
  };
}
