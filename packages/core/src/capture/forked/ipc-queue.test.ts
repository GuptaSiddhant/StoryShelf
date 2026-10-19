import { describe, expect, it } from "vitest";
import type { ParentPort } from "./channel.ts";
import { IpcCaptureQueue } from "./ipc-queue.ts";
import type { ChildMessage } from "./protocol.ts";

const noop = (): void => {};

function fakePort() {
  const sent: ChildMessage[] = [];
  let message: (value: unknown) => void = noop;
  let disconnect: () => void = noop;
  const port: ParentPort = {
    send: (value) => {
      sent.push(value);
    },
    onMessage: (listener) => {
      message = listener;
    },
    onDisconnect: (listener) => {
      disconnect = listener;
    },
  };
  return { port, sent, reply: (value: unknown) => message(value), drop: () => disconnect() };
}

describe("IpcCaptureQueue", () => {
  it("sends a poll and resolves with the job the parent answers with", async () => {
    const { port, sent, reply } = fakePort();
    const queue = new IpcCaptureQueue(port);
    const polled = queue.poll({ waitMs: 50 });
    expect(sent).toEqual([{ type: "poll", id: 1, waitMs: 50 }]);
    reply({ type: "job", id: 1, job: { buildId: "b1", receipt: "r1", attempts: 0 } });
    expect(await polled).toEqual({ buildId: "b1", receipt: "r1", attempts: 0 });
  });

  it("resolves null on an empty answer", async () => {
    const { port, reply } = fakePort();
    const queue = new IpcCaptureQueue(port);
    const polled = queue.poll({ waitMs: 50 });
    reply({ type: "empty", id: 1 });
    expect(await polled).toBeNull();
  });

  it("keeps concurrent polls apart by id", async () => {
    const { port, reply } = fakePort();
    const queue = new IpcCaptureQueue(port);
    const first = queue.poll({ waitMs: 50 });
    const second = queue.poll({ waitMs: 50 });
    reply({ type: "job", id: 2, job: { buildId: "second" } });
    reply({ type: "empty", id: 1 });
    expect(await first).toBeNull();
    expect((await second)?.buildId).toBe("second");
  });

  it("ignores malformed and unknown answers", async () => {
    const { port, reply } = fakePort();
    const queue = new IpcCaptureQueue(port);
    const polled = queue.poll({ waitMs: 20 });
    reply({ nonsense: true });
    reply({ type: "job", id: 99, job: { buildId: "other" } });
    reply({ type: "empty", id: 1 });
    expect(await polled).toBeNull();
  });

  it("gives up on a silent parent after the wait plus the grace", async () => {
    const { port } = fakePort();
    const queue = new IpcCaptureQueue(port, { pollGraceMs: 10 });
    expect(await queue.poll({ waitMs: 10 })).toBeNull();
  });

  it("acks and nacks by receipt", async () => {
    const { port, sent } = fakePort();
    const queue = new IpcCaptureQueue(port);
    await queue.ack({ buildId: "b1", receipt: "r1" });
    await queue.nack({ buildId: "b1", receipt: "r2" }, { requeue: true, delayMs: 100 });
    await queue.nack({ buildId: "b1", receipt: "r3" });
    expect(sent).toEqual([
      { type: "ack", receipt: "r1" },
      { type: "nack", receipt: "r2", requeue: true, delayMs: 100 },
      { type: "nack", receipt: "r3", requeue: false },
    ]);
  });

  it("refuses to ack a job without a receipt", async () => {
    const { port } = fakePort();
    await expect(new IpcCaptureQueue(port).ack({ buildId: "b1" })).rejects.toThrow(/no receipt/u);
  });

  it("forwards enqueue and answers empty for status, active and recent", async () => {
    const { port, sent } = fakePort();
    const queue = new IpcCaptureQueue(port);
    await queue.enqueue({ buildId: "b9" });
    expect(sent).toEqual([{ type: "enqueue", job: { buildId: "b9" } }]);
    expect(await queue.status()).toBeNull();
    expect(await queue.active()).toEqual([]);
    expect(await queue.recent()).toEqual([]);
  });

  it("fails pending and later polls once the parent disconnects", async () => {
    const { port, drop } = fakePort();
    const queue = new IpcCaptureQueue(port);
    const pending = queue.poll({ waitMs: 1000 });
    drop();
    await expect(pending).rejects.toThrow(/disconnected/u);
    await expect(queue.poll()).rejects.toThrow(/disconnected/u);
  });

  it("closes cleanly on teardown, repeatedly", async () => {
    const { port } = fakePort();
    const queue = new IpcCaptureQueue(port);
    const pending = queue.poll({ waitMs: 1000 });
    await queue.lifecycle.teardown();
    expect(await pending).toBeNull();
    await expect(queue.lifecycle.teardown()).resolves.toBeUndefined();
    expect(queue.metadata.category).toBe("capture-queue");
  });
});
