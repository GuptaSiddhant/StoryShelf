/** Child-side queue: polls the parent over IPC. `@storyshelf/worker` consumes it like any pollable queue. */
import type {
  PollableCaptureQueue,
  PollableJob,
  CaptureJob,
} from "../../adapters/capture-queue.ts";
import type { QueueEntry } from "../../adapters/capture-queue.ts";
import type { ParentPort } from "./channel.ts";
import { isParentMessage } from "./protocol.ts";

declare const __PKG_VERSION__: string | undefined;

/** Extra time beyond the requested wait before a poll gives up on a silent parent. */
const DEFAULT_POLL_GRACE_MS = 5000;
const DEFAULT_WAIT_MS = 20_000;

interface PendingPoll {
  resolve: (job: PollableJob | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A `PollableCaptureQueue` whose jobs live in the parent process.
 *
 * Liveness is the lease: the parent requeues anything in flight when this process dies, so there
 * is no `extend`. `status`, `active` and `recent` belong to the parent and answer empty here.
 */
export class IpcCaptureQueue implements PollableCaptureQueue {
  readonly metadata = {
    name: "IPC Queue (capture child)",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Polls jobs from the parent process over IPC",
    kind: "ipc",
    category: "capture-queue",
  } as const;

  readonly lifecycle = {
    setup: async (): Promise<void> => {
      await Promise.resolve();
    },
    teardown: async (): Promise<void> => {
      this.#failPending(new Error("capture queue closed"));
      await Promise.resolve();
    },
    health: async (): Promise<{ ok: boolean }> => await Promise.resolve({ ok: !this.#closed }),
  };

  readonly #port: ParentPort;
  readonly #graceMs: number;
  readonly #polls = new Map<number, PendingPoll>();
  #nextId = 0;
  #closed = false;

  constructor(port: ParentPort, options?: { pollGraceMs?: number }) {
    this.#port = port;
    this.#graceMs = options?.pollGraceMs ?? DEFAULT_POLL_GRACE_MS;
    port.onMessage((message) => {
      this.#onMessage(message);
    });
    port.onDisconnect(() => {
      this.#closed = true;
      this.#failPending(new Error("capture parent disconnected"));
    });
  }

  async enqueue(job: CaptureJob): Promise<void> {
    this.#port.send({ type: "enqueue", job });
    await Promise.resolve();
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- interface method; the parent owns this state
  async status(): Promise<QueueEntry | null> {
    return await Promise.resolve(null);
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- interface method; the parent owns this state
  async active(): Promise<QueueEntry[]> {
    return await Promise.resolve([]);
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- interface method; the parent owns this state
  async recent(): Promise<QueueEntry[]> {
    return await Promise.resolve([]);
  }

  async poll(options?: { waitMs?: number }): Promise<PollableJob | null> {
    if (this.#closed) {
      throw new Error("capture parent disconnected");
    }
    const waitMs = options?.waitMs ?? DEFAULT_WAIT_MS;
    const id = (this.#nextId += 1);
    return await new Promise<PollableJob | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#polls.delete(id);
        resolve(null);
      }, waitMs + this.#graceMs);
      this.#polls.set(id, { resolve, reject, timer });
      this.#port.send({ type: "poll", id, waitMs });
    });
  }

  async ack(job: PollableJob): Promise<void> {
    this.#port.send({ type: "ack", receipt: receiptOf(job) });
    await Promise.resolve();
  }

  async nack(job: PollableJob, options?: { requeue?: boolean; delayMs?: number }): Promise<void> {
    this.#port.send({
      type: "nack",
      receipt: receiptOf(job),
      requeue: options?.requeue ?? false,
      ...(options?.delayMs === undefined ? {} : { delayMs: options.delayMs }),
    });
    await Promise.resolve();
  }

  #onMessage(message: unknown): void {
    if (!isParentMessage(message)) {
      return;
    }
    const poll = this.#polls.get(message.id);
    if (!poll) {
      return;
    }
    clearTimeout(poll.timer);
    this.#polls.delete(message.id);
    poll.resolve(message.type === "job" ? message.job : null);
  }

  #failPending(error: Error): void {
    for (const poll of this.#polls.values()) {
      clearTimeout(poll.timer);
      poll.reject(error);
    }
    this.#polls.clear();
  }
}

function receiptOf(job: PollableJob): string {
  if (!job.receipt) {
    throw new Error(`job for build ${job.buildId} has no receipt`);
  }
  return job.receipt;
}
