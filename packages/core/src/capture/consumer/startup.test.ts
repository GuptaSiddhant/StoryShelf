import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubLogger } from "./test-fixtures.ts";

const images = vi.hoisted(() => ({
  configureImages: vi.fn(),
  verifyImageEngine: vi.fn(async () => "pngjs"),
}));
vi.mock("../../diff/index.ts", () => images);
const scratch = vi.hoisted(() => ({ sweepOrphanedScratch: vi.fn(async () => 0) }));
vi.mock("../scratch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scratch.ts")>()),
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
    handlers: {},
    config: { waitTimeSeconds: 0, concurrency: 1 },
    logger: stubLogger().logger,
    ...extra,
  });
  return { handle, poll };
}

beforeEach(() => {
  images.configureImages.mockClear();
  images.verifyImageEngine.mockReset().mockResolvedValue("pngjs");
  scratch.sweepOrphanedScratch.mockReset().mockResolvedValue(0);
});

describe("consumer start-up", () => {
  it("applies images and compare options like the server does", () => {
    consumer({ images: { engine: "sharp" }, compare: { threads: 2 } });
    expect(images.configureImages).toHaveBeenCalledWith({ engine: "sharp", threads: 2 });
  });

  it("leaves the process-wide settings alone when none are given", () => {
    consumer();
    expect(images.configureImages).not.toHaveBeenCalled();
  });

  it("refuses to start, without polling, when the image engine cannot load", async () => {
    images.verifyImageEngine.mockRejectedValue(new Error("sharp is not installed"));
    const { handle, poll } = consumer({ scratchDir: ".tmp/x" });
    await expect(handle.start()).rejects.toThrow("sharp is not installed");
    expect(poll).not.toHaveBeenCalled();
    expect(handle.isRunning()).toBe(false);
  });

  it("starts polling once the engine loads, sweeping scratch first", async () => {
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

  it("does not poll when stopped before the engine check finished", async () => {
    const { handle, poll } = consumer();
    const started = handle.start();
    await handle.stop();
    await started;
    expect(poll).not.toHaveBeenCalled();
  });
});
