import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConsumerJob, JobRunContext } from "../consumer/types.ts";
import type { ChildProcessHandle } from "./channel.ts";
import { canForkCaptureChild, forkCaptureChild } from "./fork.ts";
import {
  createForkedCaptureHandler,
  type ForkedCaptureHandler,
  type ForkedCaptureOptions,
} from "./forked-capture.ts";

const ENTRY = fileURLToPath(new URL("../../test-helpers/ipc-echo-child.ts", import.meta.url));

const job = (buildId: string, extra: Partial<ConsumerJob> = {}): ConsumerJob => ({
  buildId,
  receipt: `${buildId}:1`,
  attempts: 0,
  ...extra,
});

const context = (): JobRunContext => ({ logger: {} as never, touch: () => {} });

function real(overrides: Partial<ForkedCaptureOptions> = {}): {
  handler: ForkedCaptureHandler;
  handles: ChildProcessHandle[];
  inProcess: string[];
} {
  const handles: ChildProcessHandle[] = [];
  const inProcess: string[] = [];
  const handler = createForkedCaptureHandler({
    spawn: () => {
      const handle = forkCaptureChild({ entry: ENTRY });
      handles.push(handle);
      return handle;
    },
    fallback: {
      run: async (j) => {
        inProcess.push(j.buildId);
        await Promise.resolve();
      },
    },
    restartDelayMs: 20,
    ...overrides,
  });
  return { handler, handles, inProcess };
}

describe("forkCaptureChild (real child process)", () => {
  it("can fork in this runtime", () => {
    expect(canForkCaptureChild()).toBe(true);
  });

  it("runs pushed jobs in a real child over IPC", async () => {
    const { handler } = real();
    try {
      await handler.run(job("ok-1"), context());
      await expect(handler.run(job("fail-1"), context())).rejects.toThrow("fail-1 failed");
    } finally {
      await handler.close();
    }
  }, 30_000);

  it("survives the child crashing: the run fails, the next one gets a restarted child", async () => {
    const { handler, handles } = real({ crashLimit: 10 });
    try {
      await expect(handler.run(job("crash-1"), context())).rejects.toThrow(/exited \(code 1\)/u);
      await handler.run(job("ok-after-crash"), context());
      expect(handles.length).toBeGreaterThanOrEqual(2);
    } finally {
      await handler.close();
    }
  }, 40_000);

  it("kills a hung child and fails the job that hung it", async () => {
    const { handler, handles } = real({ leaseMs: 300, crashLimit: 10 });
    try {
      await expect(handler.run(job("hang-1"), context())).rejects.toThrow(/no progress/u);
      await handler.run(job("ok-after-hang"), context());
      expect(handles.length).toBeGreaterThanOrEqual(2);
    } finally {
      await handler.close();
    }
  }, 60_000);

  it("does not kill a slow child that keeps reporting progress", async () => {
    const { handler, handles } = real({ leaseMs: 300 });
    try {
      await handler.run(job("slow-1"), context());
      expect(handles).toHaveLength(1);
    } finally {
      await handler.close();
    }
  }, 30_000);

  it("stops the child on close", async () => {
    const { handler, handles } = real();
    await handler.run(job("ok-1"), context());
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      handles[0]?.onExit(resolve);
    });
    await handler.close();
    const info = await exited;
    expect(info.code === 0 || info.signal === "SIGTERM").toBe(true);
  }, 30_000);

  it("treats a missing entry as a crash loop and falls back in-process", async () => {
    const inProcess: string[] = [];
    const handler = createForkedCaptureHandler({
      spawn: () => forkCaptureChild({ entry: "/no/such/module.ts" }),
      fallback: {
        run: async (j) => {
          inProcess.push(j.buildId);
          await Promise.resolve();
        },
      },
      crashLimit: 1,
      restartDelayMs: 20,
    });
    try {
      // The run the broken child died under fails (the consumer retries it); the loop trips.
      await expect(handler.run(job("b1"), context())).rejects.toThrow(/exited/u);
      expect(handler.tripped).toBe(true);
      await handler.run(job("b1", { receipt: "b1:2", attempts: 1 }), context());
      expect(inProcess).toEqual(["b1"]);
    } finally {
      await handler.close();
    }
  }, 30_000);
});
