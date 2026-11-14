import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffRequest } from "./protocol.ts";

const port = vi.hoisted(() => ({
  on: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock("node:worker_threads", () => ({ parentPort: port }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diff worker", () => {
  it("rethrows outside the promise when it cannot report a failure, so the pool sees the crash", async () => {
    await import("./worker.ts");
    const handler = port.on.mock.calls[0]?.[1] as (request: DiffRequest) => void;
    let crash: (() => void) | undefined;
    vi.spyOn(globalThis, "setImmediate").mockImplementation(((callback: () => void) => {
      crash = callback;
      return 0;
    }) as unknown as typeof setImmediate);
    port.postMessage.mockImplementation(() => {
      throw new Error("clone failed");
    });
    const junk = new Uint8Array([1, 2, 3]);
    handler({
      id: 1,
      baseline: junk,
      current: new Uint8Array([4, 5, 6]),
      options: {
        pixelThreshold: 0.1,
        maxDiffRatio: 0,
        includeAntialiasing: false,
        failOnSizeChange: true,
      },
      engine: "pngjs",
    });
    await vi.waitFor(() => {
      expect(crash).toBeDefined();
    });
    expect(() => crash?.()).toThrow("clone failed");
  });
});
