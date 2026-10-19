import { describe, expect, it } from "vitest";
import { linkedChannel } from "../../test-helpers/fake-child.ts";
import { ForkedCaptureQueue } from "./forked-queue.ts";
import { IpcCaptureQueue } from "./ipc-queue.ts";

const tick = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe("ForkedCaptureQueue and IpcCaptureQueue together", () => {
  it("runs jobs end to end: enqueue, poll, ack", async () => {
    const link = linkedChannel();
    const settled: string[] = [];
    const parent = new ForkedCaptureQueue({
      spawn: () => link.child,
      onSettled: async (job, outcome) => {
        settled.push(`${job.buildId}:${outcome.status}`);
        await Promise.resolve();
      },
    });
    const child = new IpcCaptureQueue(link.port);

    // The child only exists once the first job is enqueued, as with a real fork.
    await parent.enqueue({ buildId: "b1", reqId: "req-1", traceparent: "00-abc" });
    const job = await child.poll({ waitMs: 1000 });
    expect(job).toMatchObject({
      buildId: "b1",
      reqId: "req-1",
      traceparent: "00-abc",
      attempts: 0,
    });

    await child.ack(job as NonNullable<typeof job>);
    expect((await parent.status("b1"))?.status).toBe("completed");
    expect(settled).toEqual(["b1:completed"]);

    // A poll parked on an empty queue is answered as soon as the next job arrives.
    const parked = child.poll({ waitMs: 1000 });
    await tick();
    await parent.enqueue({ buildId: "b2" });
    expect((await parked)?.buildId).toBe("b2");
  });

  it("redelivers through a nack and ends in a failure after the final nack", async () => {
    const link = linkedChannel();
    const parent = new ForkedCaptureQueue({ spawn: () => link.child });
    const child = new IpcCaptureQueue(link.port);
    await parent.enqueue({ buildId: "b1" });

    const first = (await child.poll({ waitMs: 100 })) as NonNullable<
      Awaited<ReturnType<typeof child.poll>>
    >;
    await child.nack(first, { requeue: true });
    const second = (await child.poll({ waitMs: 100 })) as typeof first;
    expect(second.attempts).toBe(1);
    await child.nack(second, { requeue: false });
    expect((await parent.status("b1"))?.status).toBe("failed");
  });

  it("returns null from an idle poll", async () => {
    const link = linkedChannel();
    const parent = new ForkedCaptureQueue({ spawn: () => link.child });
    const child = new IpcCaptureQueue(link.port);
    await parent.enqueue({ buildId: "b1" });
    await child.poll({ waitMs: 100 });
    expect(await child.poll({ waitMs: 15 })).toBeNull();
  });

  it("fails the child's pending poll when the link is severed", async () => {
    const link = linkedChannel();
    const parent = new ForkedCaptureQueue({ spawn: () => link.child });
    const child = new IpcCaptureQueue(link.port);
    await parent.enqueue({ buildId: "b1" });
    const pending = child.poll({ waitMs: 1000 });
    await tick();
    link.sever();
    await expect(pending).resolves.toMatchObject({ buildId: "b1" });
    await expect(child.poll({ waitMs: 10 })).rejects.toThrow(/disconnected/u);
  });
});
