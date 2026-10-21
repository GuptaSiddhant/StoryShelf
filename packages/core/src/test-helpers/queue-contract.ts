/**
 * Published queue contract suite for first- and third-party adapters.
 *
 * A package proves conformance in one line from its own vitest file:
 *
 * ```ts
 * import { queueContractSuite } from "@storyshelf/core/test-helpers";
 * queueContractSuite("sqs", () => createSqsCaptureQueue({ queueUrl, client: fake }));
 * ```
 *
 * Behavioral cases (enqueue/status/active/recent) need a fake transport that
 * answers realistically; structural cases (poll extension rule) run against
 * any factory.
 *
 * Pollable queues opt in to the delivery cases (poll, ack, nack, extend, redelivery, at-most-one
 * claim, cancel) with `options.pollable`. Time-dependent cases (delayed nack, lease expiry) run only
 * when the harness can move the queue's clock (`advance`), and retry exhaustion only when it says
 * how many retries the queue allows; queues without `extend`, `inspect` or `cancel` skip those
 * checks, so the suite stays backward compatible.
 */
import { describe, expect, it } from "vitest";
import type { CaptureQueue, PollableCaptureQueue, PollableJob } from "../adapters/capture-queue.ts";

/** Build the adapter under test (sync or async factories both work). */
export type QueueFactory = () => CaptureQueue | Promise<CaptureQueue>;

/** Options of {@link queueContractSuite}. */
export interface QueueContractOptions {
  /** Run the delivery cases; the factory must then return a `PollableCaptureQueue`. */
  pollable?: PollableContractOptions;
}

/** What the harness tells the delivery cases about the queue it builds. */
export interface PollableContractOptions {
  /** Move the queue's clock forward by `ms` (fake timers or an injected clock). */
  advance?: (ms: number) => void | Promise<void>;
  /** Lease the factory grants per delivery; with `advance`, enables the redelivery cases. */
  leaseMs?: number;
  /** Retries the factory allows after the first delivery; enables the exhaustion case. */
  retries?: number;
}

let sequence = 0;

/** A build id no other case (or earlier run on a shared backend) uses. */
function freshId(tag: string): string {
  sequence += 1;
  return `b-contract-${tag}-${String(Date.now())}-${String(sequence)}`;
}

/** Run the queue contract against a factory. */
export function queueContractSuite(
  label: string,
  make: QueueFactory,
  options: QueueContractOptions = {},
): void {
  describe(`queue contract: ${label}`, () => {
    it("exposes capture-queue metadata", async () => {
      const queue = await make();
      expect(queue.metadata.category).toBe("capture-queue");
      expect(queue.metadata.kind.length).toBeGreaterThan(0);
    });

    it("keeps the poll extension all-or-nothing", async () => {
      const queue = await make();
      const record = queue as unknown as Record<string, unknown>;
      const present = ["poll", "ack", "nack"].filter((method) => record[method] !== undefined);
      expect([0, 3]).toContain(present.length);
      for (const method of present) {
        expect(typeof record[method]).toBe("function");
      }
    });

    it("tracks an enqueued build through status/active/recent", async () => {
      const queue = await make();
      await queue.enqueue({ buildId: "b-contract-1" });
      const entry = await queue.status("b-contract-1");
      expect(entry?.buildId).toBe("b-contract-1");
      // Remote transports report "queued" until a worker polls; in-process
      // queues may already report "running".
      expect(["queued", "running"]).toContain(entry?.status);
      expect((await queue.active()).map((job) => job.buildId)).toContain("b-contract-1");
      expect((await queue.recent(10)).map((job) => job.buildId)).toContain("b-contract-1");
      expect(await queue.status("b-missing")).toBeNull();
    });

    it("keeps lifecycle idempotent when present", async () => {
      const queue = await make();
      if (queue.lifecycle === undefined) {
        expect(queue.lifecycle).toBeUndefined();
        return;
      }
      await queue.lifecycle.setup({} as never);
      await queue.lifecycle.setup({} as never);
      await queue.lifecycle.teardown();
      await expect(queue.lifecycle.teardown()).resolves.toBeUndefined();
    });

    if (options.pollable !== undefined) {
      pollableCases(make, options.pollable);
    }
  });
}

async function makePollable(make: QueueFactory): Promise<PollableCaptureQueue> {
  const queue = (await make()) as PollableCaptureQueue;
  expect(typeof queue.poll).toBe("function");
  return queue;
}

/** Poll until the job for `buildId` comes up (other cases' leftovers on a shared backend are skipped). */
async function pollFor(
  queue: PollableCaptureQueue,
  buildId: string,
  tries = 20,
): Promise<PollableJob | null> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential polls are the point
    const job = await queue.poll();
    if (job === null || job.buildId === buildId) {
      return job;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- settle someone else's job and keep looking
    await queue.ack(job);
  }
  return null;
}

function pollableCases(make: QueueFactory, options: PollableContractOptions): void {
  describe("delivery", () => {
    deliveryCases(make);
    retryCases(make, options);
    if (options.advance !== undefined && options.leaseMs !== undefined) {
      leaseCases(make, options.advance, options.leaseMs);
    }
    cancelCases(make);
  });
}

function deliveryCases(make: QueueFactory): void {
  it("delivers an enqueued job once, with its fields, as a first attempt", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("deliver");
    await queue.enqueue({ buildId, reqId: "req-1", traceparent: "00-abc-def-01", shard: "s-1" });
    const job = await pollFor(queue, buildId);
    expect(job).toMatchObject({
      buildId,
      reqId: "req-1",
      traceparent: "00-abc-def-01",
      shard: "s-1",
    });
    expect(job?.attempts ?? 0).toBe(0);
    expect(await pollFor(queue, buildId)).toBeNull();
    await queue.ack(job!);
  });

  it("lets at most one of many concurrent polls claim a job", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("race");
    await queue.enqueue({ buildId });
    const results = await Promise.all(Array.from({ length: 6 }, async () => await queue.poll()));
    const claimed = results.filter((job) => job?.buildId === buildId);
    expect(claimed).toHaveLength(1);
    await Promise.all(results.flatMap((job) => (job === null ? [] : [queue.ack(job)])));
  });

  it("does not redeliver an acked job and reports it completed", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("ack");
    await queue.enqueue({ buildId });
    const job = await pollFor(queue, buildId);
    await queue.ack(job!);
    expect(await pollFor(queue, buildId)).toBeNull();
    expect((await queue.status(buildId))?.status).toBe("completed");
  });

  it("renews the holder's lease while it owns the job", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("extend");
    await queue.enqueue({ buildId });
    const job = await pollFor(queue, buildId);
    if (queue.extend !== undefined) {
      expect(await queue.extend(job!)).toBe("ok");
    }
    if (queue.inspect !== undefined) {
      expect(await queue.inspect(job!)).toBe("ok");
    }
    await queue.ack(job!);
  });
}

function retryCases(make: QueueFactory, options: PollableContractOptions): void {
  it("redelivers a nacked job as the next attempt", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("nack");
    await queue.enqueue({ buildId });
    const first = await pollFor(queue, buildId);
    await queue.nack(first!, { requeue: true, error: "boom" });
    const second = await pollFor(queue, buildId);
    expect(second?.buildId).toBe(buildId);
    expect(second?.attempts ?? 0).toBeGreaterThan(first?.attempts ?? 0);
    await queue.ack(second!);
  });

  it("drops a job nacked with requeue: false and reports it failed", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("drop");
    await queue.enqueue({ buildId });
    const job = await pollFor(queue, buildId);
    await queue.nack(job!, { requeue: false, error: "fatal" });
    expect(await pollFor(queue, buildId)).toBeNull();
    const entry = await queue.status(buildId);
    expect(entry?.status).toBe("failed");
    expect(entry?.error).toBe("fatal");
  });

  if (options.advance !== undefined) {
    const { advance } = options;
    it("hides a job nacked with a delay until the delay passes", async () => {
      const queue = await makePollable(make);
      const buildId = freshId("delay");
      await queue.enqueue({ buildId });
      const job = await pollFor(queue, buildId);
      await queue.nack(job!, { requeue: true, delayMs: 10_000 });
      expect(await pollFor(queue, buildId)).toBeNull();
      await advance(10_001);
      const again = await pollFor(queue, buildId);
      expect(again?.buildId).toBe(buildId);
      await queue.ack(again!);
    });
  }

  if (options.retries !== undefined) {
    const { retries } = options;
    it("fails a job once its retries are spent", async () => {
      const queue = await makePollable(make);
      const buildId = freshId("exhaust");
      await queue.enqueue({ buildId });
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- attempts are sequential
        const job = await pollFor(queue, buildId);
        expect(job?.buildId).toBe(buildId);
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await queue.nack(job!, { requeue: true, error: `attempt ${String(attempt)}` });
      }
      expect(await pollFor(queue, buildId)).toBeNull();
      expect((await queue.status(buildId))?.status).toBe("failed");
    });
  }
}

function leaseCases(
  make: QueueFactory,
  advance: (ms: number) => void | Promise<void>,
  leaseMs: number,
): void {
  it("redelivers a job whose lease expired, and the stale holder learns it lost", async () => {
    const queue = await makePollable(make);
    const buildId = freshId("expire");
    await queue.enqueue({ buildId });
    const stale = await pollFor(queue, buildId);
    expect(await pollFor(queue, buildId)).toBeNull();
    await advance(leaseMs + 1);
    const fresh = await pollFor(queue, buildId);
    expect(fresh?.buildId).toBe(buildId);
    expect(fresh?.attempts ?? 0).toBeGreaterThan(stale?.attempts ?? 0);
    if (queue.extend !== undefined) {
      expect(await queue.extend(stale!)).toBe("lost");
      expect(await queue.extend(fresh!)).toBe("ok");
    }
    await queue.ack(fresh!);
  });
}

function cancelCases(make: QueueFactory): void {
  it("cancels a queued job at once and flags a running one", async () => {
    const queue = await makePollable(make);
    if (queue.cancel === undefined) {
      expect(queue.cancel).toBeUndefined();
      return;
    }
    const queued = freshId("cancel-queued");
    const running = freshId("cancel-running");
    await queue.enqueue({ buildId: queued });
    expect(await queue.cancel(queued)).toBe(true);
    expect((await queue.status(queued))?.status).toBe("cancelled");
    await queue.enqueue({ buildId: running });
    const job = await pollFor(queue, running);
    expect(job?.buildId).toBe(running);
    expect(await queue.cancel(running)).toBe(true);
    const seen = await (queue.inspect ?? queue.extend)?.(job!);
    expect(seen ?? "cancelled").toBe("cancelled");
    await queue.nack(job!, { requeue: false, error: "cancelled" });
    expect((await queue.status(running))?.status).toBe("cancelled");
    expect(await queue.cancel("b-contract-unknown")).toBe(false);
  });
}
