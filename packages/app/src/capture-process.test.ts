import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { capturesLocally, shouldForkCapture } from "./capture-process.ts";
import { setupCaptureQueue } from "./capture-setup.ts";

const ECHO_CHILD = fileURLToPath(
  new URL("../../core/src/test-helpers/ipc-echo-child.ts", import.meta.url),
);

const logger = createShelfLogger({ level: "silent" });

function runner() {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-runner" as const },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as import("@storyshelf/core/adapter/capture-runner").CaptureRunner;
}

const queueOf = (kind: string) => ({ metadata: { kind } }) as never;

describe("capturesLocally", () => {
  it("is true for the in-process and forked queues only", () => {
    expect(capturesLocally(queueOf("memory"))).toBe(true);
    expect(capturesLocally(queueOf("forked"))).toBe(true);
    expect(capturesLocally(queueOf("sqs"))).toBe(false);
    expect(capturesLocally(null)).toBe(false);
  });
});

describe("shouldForkCapture", () => {
  it("never forks without a workerEntry", () => {
    expect(shouldForkCapture(undefined, logger)).toBe(false);
    expect(shouldForkCapture({ runner: runner() }, logger)).toBe(false);
  });

  it("never forks in in-process mode", () => {
    expect(
      shouldForkCapture({ runner: runner(), workerEntry: "/w.ts", mode: "in-process" }, logger),
    ).toBe(false);
  });

  it("forks when forced", () => {
    expect(
      shouldForkCapture({ runner: runner(), workerEntry: "/w.ts", mode: "fork" }, logger),
    ).toBe(true);
  });

  it("decides from the host in auto mode and logs why it stayed in-process", () => {
    const info = vi.fn();
    const spy = { ...logger, info } as never;
    const forked = shouldForkCapture({ runner: runner(), workerEntry: "/w.ts" }, spy);
    // On a roomy dev/CI host this forks; on a small one it must say why it did not.
    if (!forked) {
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.any(String) }),
        expect.any(String),
      );
    }
    expect(typeof forked).toBe("boolean");
  });
});

function setup(capture: Record<string, unknown>) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return setupCaptureQueue(
    { database: db as never, storage: storage as never, capture: capture as never },
    { scratchDir: ".tmp/capture-process-test" },
    [],
    logger,
  );
}

describe("setupCaptureQueue process model", () => {
  it("uses the in-process queue without a workerEntry", () => {
    expect(setup({ runner: runner() }).queue?.metadata.kind).toBe("memory");
  });

  it("uses the in-process queue in in-process mode even with a workerEntry", () => {
    const result = setup({ runner: runner(), workerEntry: ECHO_CHILD, mode: "in-process" });
    expect(result.queue?.metadata.kind).toBe("memory");
  });

  it("uses a forked queue when forced, and a real child processes jobs", async () => {
    const result = setup({ runner: runner(), workerEntry: ECHO_CHILD, mode: "fork" });
    const queue = result.queue;
    try {
      expect(queue?.metadata.kind).toBe("forked");
      await result.enqueueCapture?.("ok-1");
      const deadline = Date.now() + 15_000;
      // oxlint-disable-next-line eslint/no-await-in-loop -- polling loop
      while ((await queue?.status("ok-1"))?.status !== "completed") {
        if (Date.now() > deadline) {
          throw new Error("job was not completed by the forked child");
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling loop
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      await queue?.lifecycle?.teardown();
    }
  }, 30_000);

  it("lets the forked child hand shards back to be delivered to it", async () => {
    const result = setup({
      runner: runner(),
      workerEntry: ECHO_CHILD,
      mode: "fork",
      shardSize: 10,
    });
    const queue = result.queue;
    try {
      await result.enqueueCapture?.("fan-1");
      const deadline = Date.now() + 15_000;
      const settled = async (): Promise<string[]> =>
        (await queue?.recent(10))
          ?.filter((entry) => entry.status === "completed")
          .map((entry) => entry.shard ?? "plan")
          .toSorted() ?? [];
      // oxlint-disable-next-line eslint/no-await-in-loop -- polling loop
      while ((await settled()).length < 3) {
        if (Date.now() > deadline) {
          throw new Error("the child's shards were not delivered back to it");
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling loop
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(await settled()).toEqual(["fan-1:render:1", "fan-1:render:2", "plan"]);
    } finally {
      await queue?.lifecycle?.teardown();
    }
  }, 30_000);

  it("prefers a supplied queue over forking", () => {
    const supplied = {
      metadata: { name: "q", version: "0", kind: "sqs", category: "capture-queue" },
      enqueue: vi.fn(),
      status: vi.fn(),
      active: vi.fn(),
      recent: vi.fn(),
    };
    const result = setup({
      runner: runner(),
      queue: supplied,
      workerEntry: ECHO_CHILD,
      mode: "fork",
    });
    expect(result.queue).toBe(supplied);
  });
});
