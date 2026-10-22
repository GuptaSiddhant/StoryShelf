import { createShelfLogger } from "@storyshelf/core/logger";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { childEnvOf, createForkedHandler, shouldForkCapture } from "./capture-process.ts";

const logger = createShelfLogger({ level: "silent" });

function runner() {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-runner" as const },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as import("@storyshelf/core/adapter/capture-runner").CaptureRunner;
}

describe("childEnvOf", () => {
  it("hands the Storybook URL lifetime to the child", () => {
    expect(childEnvOf({ retries: 0, storybookUrlTtl: 600 })).toEqual({
      STORYSHELF_CAPTURE_RETRIES: "0",
      STORYSHELF_CAPTURE_STORYBOOK_URL_TTL: "600",
    });
  });

  it("hands the image engine, diff threads and retries to the child, with the shard size", () => {
    expect(childEnvOf({ retries: 3, shardSize: 40, imageEngine: "sharp", diffThreads: 2 })).toEqual(
      {
        STORYSHELF_CAPTURE_RETRIES: "3",
        STORYSHELF_CAPTURE_SHARD_SIZE: "40",
        STORYSHELF_IMAGE_ENGINE: "sharp",
        STORYSHELF_DIFF_WORKERS: "2",
      },
    );
  });

  it("always hands down the retries, and nothing for options that were not given", () => {
    expect(childEnvOf({ retries: 0 })).toEqual({ STORYSHELF_CAPTURE_RETRIES: "0" });
  });

  it("keeps a diff thread count of 0 (main-thread diffs)", () => {
    expect(childEnvOf({ retries: 2, diffThreads: 0 })).toEqual({
      STORYSHELF_CAPTURE_RETRIES: "2",
      STORYSHELF_DIFF_WORKERS: "0",
    });
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

describe("createForkedHandler", () => {
  const ECHO_CHILD = fileURLToPath(
    new URL("../../core/src/test-helpers/ipc-echo-child.ts", import.meta.url),
  );
  const context = { logger: {} as never, touch: () => {} };

  it("pushes jobs to a real child, and closes it", async () => {
    const handler = createForkedHandler({
      workerEntry: ECHO_CHILD,
      retries: 2,
      fallback: { run: async () => {} },
      onCrashed: async () => {},
      logger,
    });
    try {
      await handler.run({ buildId: "ok-1", receipt: "ok-1:1" }, context);
      expect(handler.tripped).toBe(false);
    } finally {
      await handler.close();
    }
  }, 30_000);

  it("writes the failure itself when the child kills the last attempt", async () => {
    const onCrashed = vi.fn(async () => {});
    const handler = createForkedHandler({
      workerEntry: ECHO_CHILD,
      retries: 0,
      fallback: { run: async () => {} },
      onCrashed,
      logger,
    });
    try {
      await expect(
        handler.run(
          { buildId: "crash-1", receipt: "crash-1:1", attempt: 1, maxAttempts: 1 },
          context,
        ),
      ).rejects.toThrow(/exited/u);
      expect(onCrashed).toHaveBeenCalledWith(
        expect.objectContaining({ buildId: "crash-1" }),
        expect.stringContaining("exited"),
      );
    } finally {
      await handler.close();
    }
  }, 30_000);
});
