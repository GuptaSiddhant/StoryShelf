import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createShelfLogger } from "@storyshelf/core/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureWorker } from "./index.ts";

const images = vi.hoisted(() => ({
  configureImages: vi.fn(),
  verifyImageEngine: vi.fn(async () => "pngjs"),
}));

vi.mock("@storyshelf/core/diff", () => images);

function worker(
  extra: Parameters<typeof createCaptureWorker>[0] extends infer O ? Partial<O> : never,
) {
  const poll = vi.fn(async () => null);
  const queue = {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-queue" as const },
    poll,
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
  } as unknown as CaptureQueue;
  const handle = createCaptureWorker({
    queue,
    db: {} as DatabaseAdapter,
    storage: {} as StorageAdapter,
    runner: {} as CaptureRunner,
    scratchDir: "/tmp",
    logger: createShelfLogger({ level: "silent" }),
    config: { waitTimeSeconds: 0, concurrency: 1 },
    ...extra,
  });
  return { handle, poll };
}

beforeEach(() => {
  images.configureImages.mockClear();
  images.verifyImageEngine.mockReset();
  images.verifyImageEngine.mockResolvedValue("pngjs");
});

describe("capture worker image settings", () => {
  it("applies images and compare options like the server does", () => {
    worker({ images: { engine: "sharp" }, compare: { threads: 2 } });
    expect(images.configureImages).toHaveBeenCalledWith({ engine: "sharp", threads: 2 });
  });

  it("leaves the process-wide settings alone when none are given", () => {
    worker({});
    expect(images.configureImages).not.toHaveBeenCalled();
  });

  it("refuses to start, without polling, when the image engine cannot load", async () => {
    images.verifyImageEngine.mockRejectedValue(new Error("sharp is not installed"));
    const { handle, poll } = worker({ images: { engine: "sharp" } });
    await expect(handle.start()).rejects.toThrow("sharp is not installed");
    expect(poll).not.toHaveBeenCalled();
    expect(handle.isRunning()).toBe(false);
  });

  it("starts polling once the engine loads", async () => {
    const { handle, poll } = worker({});
    const started = handle.start();
    await vi.waitFor(() => {
      expect(poll).toHaveBeenCalled();
    });
    await handle.stop();
    await started;
    expect(images.verifyImageEngine).toHaveBeenCalledOnce();
  });
});
