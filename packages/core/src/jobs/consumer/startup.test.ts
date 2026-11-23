import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubLogger } from "./test-fixtures.ts";

const scratch = vi.hoisted(() => ({ sweepOrphanedScratch: vi.fn(async () => 0) }));
vi.mock("../../publish/scratch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../publish/scratch.ts")>()),
  ...scratch,
}));

const { createCaptureConsumer } = await import("./index.ts");

function consumer(extra: Record<string, unknown> = {}) {
  const poll = vi.fn(async () => null);
  const queue = {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-queue" as const },
    poll,
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
  };
  const handle = createCaptureConsumer({
    queue: queue as never,
    handlers: { capture: async () => {} },
    config: { waitTimeSeconds: 0, concurrency: 1 },
    logger: stubLogger().logger,
    ...extra,
  });
  return { handle, poll };
}

beforeEach(() => {
  scratch.sweepOrphanedScratch.mockReset().mockResolvedValue(0);
});

describe("consumer start-up", () => {
  it("refuses to start, without polling, when a handler's prepare fails", async () => {
    const prepare = vi.fn(async () => {
      throw new Error("sharp is not installed");
    });
    const { handle, poll } = consumer({
      scratchDir: ".tmp/x",
      handlers: { capture: { run: async () => {}, prepare } },
    });
    await expect(handle.start()).rejects.toThrow("sharp is not installed");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(poll).not.toHaveBeenCalled();
    expect(handle.isRunning()).toBe(false);
  });

  it("prepares every handler that asks, once, before it polls", async () => {
    const order: string[] = [];
    const { handle, poll } = consumer({
      handlers: {
        capture: {
          run: async () => {},
          prepare: async () => {
            order.push("capture");
          },
        },
        publish: async () => {},
      },
    });
    poll.mockImplementation(async () => {
      order.push("poll");
      return null;
    });
    const started = handle.start();
    await vi.waitFor(() => {
      expect(poll).toHaveBeenCalled();
    });
    await handle.stop();
    await started;
    expect(order[0]).toBe("capture");
    expect(order.filter((step) => step === "capture")).toHaveLength(1);
  });

  it("starts polling once its handlers are prepared, sweeping scratch first", async () => {
    const { handle, poll } = consumer({ scratchDir: ".tmp/x" });
    const started = handle.start();
    await vi.waitFor(() => {
      expect(poll).toHaveBeenCalled();
    });
    await handle.stop();
    await started;
    expect(scratch.sweepOrphanedScratch).toHaveBeenCalledWith(".tmp/x", expect.anything());
  });

  it("logs a failed scratch sweep and carries on", async () => {
    scratch.sweepOrphanedScratch.mockRejectedValue(new Error("eperm"));
    const { handle, poll } = consumer({ scratchDir: ".tmp/x" });
    const started = handle.start();
    await vi.waitFor(() => {
      expect(poll).toHaveBeenCalled();
    });
    await handle.stop();
    await started;
  });

  it("does not poll when stopped before the handlers were prepared", async () => {
    const { handle, poll } = consumer({
      handlers: { capture: { run: async () => {}, prepare: async () => {} } },
    });
    const started = handle.start();
    await handle.stop();
    await started;
    expect(poll).not.toHaveBeenCalled();
  });
});
