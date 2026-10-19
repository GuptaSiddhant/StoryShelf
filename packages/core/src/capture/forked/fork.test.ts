import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChildProcessHandle } from "./channel.ts";
import { canForkCaptureChild, forkCaptureChild } from "./fork.ts";
import { ForkedCaptureQueue, type ForkedCaptureQueueOptions } from "./forked-queue.ts";

const ENTRY = fileURLToPath(new URL("../../test-helpers/ipc-echo-child.ts", import.meta.url));

async function until(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  /* oxlint-disable eslint/no-await-in-loop -- polling loop */
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error("condition not reached in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  /* oxlint-enable eslint/no-await-in-loop */
}

function realQueue(overrides: Partial<ForkedCaptureQueueOptions> = {}) {
  const handles: ChildProcessHandle[] = [];
  const queue = new ForkedCaptureQueue({
    spawn: () => {
      const handle = forkCaptureChild({ entry: ENTRY });
      handles.push(handle);
      return handle;
    },
    restartDelayMs: 20,
    ...overrides,
  });
  return { queue, handles };
}

describe("forkCaptureChild (real child process)", () => {
  it("can fork in this runtime", () => {
    expect(canForkCaptureChild()).toBe(true);
  });

  it("runs jobs in a real child over IPC", async () => {
    const { queue } = realQueue();
    try {
      await queue.enqueue({ buildId: "ok-1" });
      await queue.enqueue({ buildId: "fail-1" });
      await until(async () => (await queue.status("fail-1"))?.status === "failed");
      expect((await queue.status("ok-1"))?.status).toBe("completed");
    } finally {
      await queue.lifecycle.teardown();
    }
  }, 30_000);

  it("survives the child crashing: restarts it and fails a poison job after the retries", async () => {
    const { queue, handles } = realQueue({ maxCrashRetries: 1, crashLimit: 10 });
    try {
      await queue.enqueue({ buildId: "crash-1" });
      await until(async () => (await queue.status("crash-1"))?.status === "failed");
      expect((await queue.status("crash-1"))?.error).toMatch(/exited \(code 1\) 2 times/u);
      expect(handles.length).toBeGreaterThanOrEqual(2);

      // The restarted child still works.
      await queue.enqueue({ buildId: "ok-after-crash" });
      await until(async () => (await queue.status("ok-after-crash"))?.status === "completed");
    } finally {
      await queue.lifecycle.teardown();
    }
  }, 40_000);

  it("stops the child on teardown", async () => {
    const { queue, handles } = realQueue();
    await queue.enqueue({ buildId: "ok-1" });
    await until(async () => (await queue.status("ok-1"))?.status === "completed");
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      handles[0]?.onExit(resolve);
    });
    await queue.lifecycle.teardown();
    const info = await exited;
    expect(info.code === 0 || info.signal === "SIGTERM").toBe(true);
  }, 30_000);

  it("reports a missing entry as a crash instead of hanging", async () => {
    const queue = new ForkedCaptureQueue({
      spawn: () => forkCaptureChild({ entry: "/no/such/module.ts" }),
      maxCrashRetries: 0,
      restartDelayMs: 20,
    });
    try {
      await queue.enqueue({ buildId: "b1" });
      await until(async () => (await queue.status("b1"))?.status === "failed");
    } finally {
      await queue.lifecycle.teardown();
    }
  }, 30_000);
});
