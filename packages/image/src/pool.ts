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
}

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
  private workerClass: WorkerCtor | null | undefined;

  constructor(options: DiffPoolOptions) {
    this.size = Math.max(0, Math.floor(options.size));
    this.workerUrl = options.workerUrl;
    this.engine = options.engine ?? "pngjs";
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
    for (let idle = this.idleSlot(); idle; idle = this.idleSlot()) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }
      dispatch(idle, next);
    }
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
      worker.on("message", (message: DiffResponse) => {
        this.onMessage(slot, message);
      });
      worker.on("error", (error: Error) => {
        this.onLost(slot, error);
      });
      worker.on("exit", (code) => {
        this.onLost(slot, new Error(`diff worker exited with code ${code}`));
      });
    } catch {
      this.fallBackToThread();
    }
  }

  private onMessage(slot: Slot, message: DiffResponse): void {
    if (message.type === "ready") {
      slot.ready = true;
      slot.worker.unref();
    } else if (slot.task?.id === message.id) {
      const { task } = slot;
      slot.task = null;
      slot.worker.unref();
      settle(task, message);
    }
    this.pump();
  }

  private onLost(slot: Slot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) {
      return;
    }
    this.slots.splice(index, 1);
    if (!slot.ready) {
      this.fallBackToThread();
    } else if (slot.task) {
      slot.task.reject(error);
    }
    this.pump();
  }

  /** The worker file could not run (missing, syntax error, no `worker_threads`): stay in-thread for good. */
  private fallBackToThread(): void {
    this.broken = true;
    const slots = this.slots.splice(0);
    for (const slot of slots) {
      slot.worker.terminate().catch(ignore);
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
