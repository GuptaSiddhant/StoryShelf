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
 */
import { describe, expect, it } from "vitest";
import type { CaptureQueue } from "../adapters/capture-queue.ts";

/** Build the adapter under test (sync or async factories both work). */
export type QueueFactory = () => CaptureQueue | Promise<CaptureQueue>;

/** Run the queue contract against a factory. */
export function queueContractSuite(label: string, make: QueueFactory): void {
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
  });
}
