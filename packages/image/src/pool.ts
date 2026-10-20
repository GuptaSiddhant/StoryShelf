/** A small `worker_threads` pool that runs `diffImages` off the main thread. */
import type { Worker } from "node:worker_threads";
import type { ImageEngine } from "./codec.ts";
import { loadCodec } from "./codecs.ts";
import { diffImages, identicalResult } from "./engine.ts";
import type { DiffOptions, DiffResult } from "./options.ts";
import type { DiffRequest, DiffResponse } from "./protocol.ts";
import { fromTransferred, toTransferable } from "./transfer.ts";

/** Options for {@link DiffPool}. */
export interface DiffPoolOptions {
  /** Maximum worker threads; 0 runs every diff in the calling thread. */
  size: number;
  /** Worker module to spawn. */
  workerUrl: URL | string;
  /** Image engine the workers (and the in-thread fallback) use; pngjs when omitted. */
  engine?: ImageEngine;
  /**
   * Called once if the pool gives up on threads and runs every diff in-thread from then on. Defaults
   * to a process warning, since every later diff then blocks the event loop.
   */
  onFallback?: (reason: string) => void;
}

/** Workers dying before `ready` in a row, after one has started fine, before the pool gives up. */
const MAX_START_FAILURES = 3;

interface Pending {
  id: number;
  baseline: Buffer;
  current: Buffer;
  options: DiffOptions;
  engine: ImageEngine;
  resolve: (result: DiffResult) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  ready: boolean;
  task: Pending | null;
}

type WorkerCtor = typeof Worker;

const livePools = new Set<DiffPool>();
let exitHookInstalled = false;

/**
 * Runs diffs on worker threads, transferring PNG bytes instead of copying them.
 *
 * Workers start on demand, take work only once they have reported `ready` (so a worker file that
 * fails to load never swallows a transferred buffer), and are `unref`'d while idle so they never
 * keep the process alive. If workers cannot be used at all, every diff runs in-thread.
 */
export class DiffPool {
  private readonly size: number;
  private readonly workerUrl: URL | string;
  private readonly engine: ImageEngine;
  private readonly slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 0;
  private broken = false;
  /** Whether any worker has reported ready, which proves the worker file loads. */
  private everReady = false;
  private startFailures = 0;
  private readonly onFallback: (reason: string) => void;
  private workerClass: WorkerCtor | null | undefined;

  constructor(options: DiffPoolOptions) {
    this.size = Math.max(0, Math.floor(options.size));
    this.workerUrl = options.workerUrl;
    this.engine = options.engine ?? "pngjs";
    this.onFallback = options.onFallback ?? warnFallback;
  }

  /**
   * Diff two PNGs. The inputs may be detached (transferred) when a worker runs the diff, so
   * callers must not reuse them afterwards.
   */
  async run(baseline: Buffer, current: Buffer, options: DiffOptions): Promise<DiffResult> {
    const identical = identicalResult(baseline, current);
    if (identical) {
      return identical;
    }
    if (this.size === 0 || this.broken || !(await this.loadWorkerClass())) {
      return await this.diffInThread(baseline, current, options);
    }
    return await new Promise<DiffResult>((resolve, reject) => {
      this.nextId += 1;
      const { nextId: id } = this;
      this.queue.push({ id, baseline, current, options, engine: this.engine, resolve, reject });
      this.pump();
    });
  }

  private async diffInThread(
    baseline: Buffer,
    current: Buffer,
    options: DiffOptions,
  ): Promise<DiffResult> {
    return await diffImages(baseline, current, options, await loadCodec(this.engine));
  }

  /** Stop all workers and reject unfinished work. The pool starts fresh workers if used again. */
  async shutdown(): Promise<void> {
    livePools.delete(this);
    const slots = this.slots.splice(0);
    const queued = this.queue;
    this.queue = [];
    const stopped = new Error("diff pool shut down");
    for (const task of [...queued, ...slots.flatMap((slot) => (slot.task ? [slot.task] : []))]) {
      task.reject(stopped);
    }
    await Promise.all(slots.map(async (slot) => await slot.worker.terminate()));
  }

  /** Worker threads currently alive (for tests and diagnostics). */
  get workerCount(): number {
    return this.slots.length;
  }

  private async loadWorkerClass(): Promise<boolean> {
    if (this.workerClass === undefined) {
      try {
        this.workerClass = (await import("node:worker_threads")).Worker;
      } catch {
        this.workerClass = null;
      }
    }
    return this.workerClass !== null;
  }

  private pump(): void {
    if (this.broken) {
      return;
    }
    this.dispatchToIdle();
    this.spawnForQueue();
  }

  private dispatchToIdle(): void {
    for (let idle = this.idleSlot(); idle; idle = this.idleSlot()) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }
      dispatch(idle, next);
    }
  }

  /** Start workers for queued work beyond the ones already starting, up to the pool size. */
  private spawnForQueue(): void {
    const starting = this.slots.filter((slot) => !slot.ready).length;
    const wanted = Math.min(this.queue.length - starting, this.size - this.slots.length);
    for (let index = 0; index < wanted && this.workerClass; index += 1) {
      this.spawn(this.workerClass);
    }
  }

  private idleSlot(): Slot | undefined {
    return this.slots.find((slot) => slot.ready && !slot.task);
  }

  private spawn(WorkerClass: WorkerCtor): void {
    try {
      const worker = new WorkerClass(this.workerUrl);
      const slot: Slot = { worker, ready: false, task: null };
      this.slots.push(slot);
      installExitHook(this);
      this.watch(slot);
    } catch (error) {
      this.onSpawnError(error);
    }
  }

  private watch(slot: Slot): void {
    slot.worker.on("message", (message: DiffResponse) => {
      this.onMessage(slot, message);
    });
    slot.worker.on("error", (error: Error) => {
      this.onLost(slot, error);
    });
    slot.worker.on("exit", (code) => {
      this.onLost(slot, new Error(`diff worker exited with code ${code}`));
    });
  }

  /** `new Worker` threw (a thread limit, say): a start failure, and fatal with no worker left. */
  private onSpawnError(error: unknown): void {
    const reason = `diff worker could not start: ${String(error)}`;
    this.onStartFailure(reason);
    if (this.slots.length === 0) {
      this.fallBackToThread(reason);
    }
  }

  private onMessage(slot: Slot, message: DiffResponse): void {
    if (message.type === "ready") {
      this.markReady(slot);
    } else if (slot.task?.id === message.id) {
      const { task } = slot;
      slot.task = null;
      slot.worker.unref();
      settle(task, message);
    }
    if (this.broken && !slot.task) {
      this.retire(slot);
    }
    this.pump();
  }

  private markReady(slot: Slot): void {
    slot.ready = true;
    this.everReady = true;
    this.startFailures = 0;
    slot.worker.unref();
  }

  private onLost(slot: Slot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) {
      return;
    }
    this.slots.splice(index, 1);
    slot.task?.reject(error);
    if (!slot.ready) {
      this.onStartFailure(`diff worker exited before it was ready: ${error.message}`);
    }
    this.pump();
  }

  /**
   * A worker died before reporting ready. Before any worker ever has, the worker file cannot run, so
   * go in-thread; after one has, it is a crash (memory pressure, a thread limit) and the pool only
   * gives up if replacements keep failing.
   */
  private onStartFailure(reason: string): void {
    this.startFailures += 1;
    if (!this.everReady || this.startFailures >= MAX_START_FAILURES) {
      this.fallBackToThread(reason);
    }
  }

  private retire(slot: Slot): void {
    const index = this.slots.indexOf(slot);
    if (index !== -1) {
      this.slots.splice(index, 1);
    }
    slot.worker.terminate().catch(ignore);
  }

  /**
   * Stay in-thread for good. Idle and starting workers stop now; a worker busy with a diff keeps it
   * (its buffers were transferred to it) and stops once it answers, so no running diff is dropped.
   */
  private fallBackToThread(reason: string): void {
    if (this.broken) {
      return;
    }
    this.broken = true;
    this.onFallback(reason);
    for (const slot of this.slots.filter((candidate) => !candidate.task)) {
      this.retire(slot);
    }
    const queued = this.queue;
    this.queue = [];
    for (const task of queued) {
      this.diffInThread(task.baseline, task.current, task.options).then(
        task.resolve,
        (error: unknown) => {
          task.reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    }
  }
}

/** Terminate workers when the process exits; they are unref'd when idle, this covers the rest. */
function installExitHook(pool: DiffPool): void {
  livePools.add(pool);
  if (exitHookInstalled) {
    return;
  }
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const live of livePools) {
      live.shutdown().catch(ignore);
    }
  });
}

function ignore(): void {}

function warnFallback(reason: string): void {
  process.emitWarning(`${reason}; running image diffs on the main thread from now on`, {
    code: "STORYSHELF_DIFF_POOL_FALLBACK",
  });
}

/** Hand a task to an idle worker, transferring both PNGs (copying any that are not exclusively owned). */
function dispatch(slot: Slot, task: Pending): void {
  const baseline = toTransferable(task.baseline);
  let current = toTransferable(task.current);
  if (current.buffer === baseline.buffer) {
    current = Uint8Array.from(current);
  }
  slot.task = task;
  slot.worker.ref();
  const request: DiffRequest = {
    id: task.id,
    baseline,
    current,
    options: task.options,
    engine: task.engine,
  };
  slot.worker.postMessage(request, [baseline.buffer as ArrayBuffer, current.buffer as ArrayBuffer]);
}

/** Resolve or reject a task from the worker's answer. */
function settle(task: Pending, message: Exclude<DiffResponse, { type: "ready" }>): void {
  if (message.type === "result") {
    const { diffImage } = message.result;
    task.resolve({ ...message.result, diffImage: diffImage ? fromTransferred(diffImage) : null });
    return;
  }
  const error = new Error(message.message);
  error.name = message.name;
  task.reject(error);
}
