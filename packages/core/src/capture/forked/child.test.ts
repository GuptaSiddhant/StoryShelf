import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { CAPTURE_RETRIES_ENV, CAPTURE_SHARD_SIZE_ENV } from "./fork.ts";

const dispatch = vi.hoisted(() => ({
  run: vi.fn(),
  jobOptions: [] as { shardSize?: number; enqueue?: (job: unknown) => Promise<void> }[],
  maxRetries: [] as (number | undefined)[],
}));
vi.mock("../dispatch.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dispatch.ts")>();
  return {
    ...actual,
    createDispatchJob: (deps: {
      jobOptions: (typeof dispatch.jobOptions)[number];
      maxRetries?: number;
    }) => {
      dispatch.jobOptions.push(deps.jobOptions);
      dispatch.maxRetries.push(deps.maxRetries);
      return dispatch.run;
    },
  };
});

const { runCaptureChild } = await import("./child.ts");
type Host = import("./child.ts").ChildHost;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** A fake process: records what the child sends, lets the test play parent and signals. */
function fakeHost(env: Record<string, string> = {}) {
  // oxlint-disable-next-line unicorn/prefer-event-target -- stands in for Node's process emitter
  const events = new EventEmitter();
  const sent: Record<string, unknown>[] = [];
  const exit = vi.fn();
  const host: Host = {
    send: (message) => {
      sent.push(message as Record<string, unknown>);
      return true;
    },
    on: (event, listener) => events.on(event, listener),
    env,
    exit,
  };
  return { host, events, sent, exit };
}

const silent = { child: () => silent, info() {}, warn() {}, error() {}, debug() {} };

function options(overrides: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  return {
    db,
    logger: silent as never,
    storage: {} as never,
    runner: { cancel: vi.fn(async () => {}), render: vi.fn() } as never,
    scratchDir: ".tmp/child-test",
    ...overrides,
  };
}

const push = (events: EventEmitter, runId: string, buildId: string, extra = {}): void => {
  events.emit("message", {
    type: "run",
    runId,
    job: { buildId, receipt: `${buildId}:1`, ...extra },
  });
};

describe("runCaptureChild", () => {
  it("refuses to run outside a forked process", async () => {
    const { host } = fakeHost();
    await expect(runCaptureChild(options(), { ...host, send: undefined })).rejects.toThrow(
      /forked process/u,
    );
  });

  it("runs a pushed job and reports it done; it never asks the parent for work", async () => {
    dispatch.run.mockReset().mockImplementation(async () => {});
    const { host, events, sent, exit } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    expect(sent).toEqual([]);

    push(events, "run-1", "b1", { attempts: 1 });
    await sleep(20);
    expect(dispatch.run).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "b1", attempts: 1 }),
      expect.objectContaining({ touch: expect.any(Function) }),
    );
    expect(sent).toContainEqual({ type: "done", runId: "run-1" });

    events.emit("SIGTERM");
    await running;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("reports the error of a job that threw", async () => {
    dispatch.run.mockReset().mockRejectedValue(new Error("render broke"));
    const { host, events, sent } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    push(events, "run-1", "b1");
    await sleep(20);
    expect(sent).toContainEqual({ type: "failed", runId: "run-1", error: "render broke" });
    events.emit("SIGINT");
    await running;
  });

  it("reports a thrown non-error as text", async () => {
    dispatch.run.mockReset().mockRejectedValue("plain text");
    const { host, events, sent } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    push(events, "run-1", "b1");
    await sleep(20);
    expect(sent).toContainEqual({ type: "failed", runId: "run-1", error: "plain text" });
    events.emit("SIGTERM");
    await running;
  });

  it("reports progress, at most once a second", async () => {
    dispatch.run.mockReset().mockImplementation(async (_job, context) => {
      context.touch();
      context.touch();
      context.touch();
    });
    const { host, events, sent } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    push(events, "run-1", "b1");
    await sleep(20);
    expect(sent.filter((message) => message["type"] === "progress")).toEqual([
      { type: "progress", runId: "run-1" },
    ]);
    events.emit("SIGTERM");
    await running;
  });

  it("runs several pushed jobs at once; the parent decides how many", async () => {
    let active = 0;
    let peak = 0;
    dispatch.run.mockReset().mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(30);
      active -= 1;
    });
    const { host, events, sent } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    push(events, "run-1", "b1");
    push(events, "run-2", "b2");
    push(events, "run-3", "b3");
    await sleep(80);
    expect(peak).toBe(3);
    expect(sent.filter((message) => message["type"] === "done")).toHaveLength(3);
    events.emit("SIGTERM");
    await running;
  });

  it("cancels the render of a run when the parent says so", async () => {
    const cancel = vi.fn(async () => {});
    const opts = options({ runner: { cancel, render: vi.fn() } });
    dispatch.run.mockReset().mockImplementation(async () => {
      await sleep(60);
    });
    const { host, events } = fakeHost();
    const running = runCaptureChild(opts, host);
    await sleep(20);
    push(events, "run-1", "b1", { shard: "b1:render:1" });
    await sleep(10);
    events.emit("message", { type: "cancel", runId: "run-1" });
    events.emit("message", { type: "cancel", runId: "unknown" });
    await sleep(10);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("b1", "b1:render:1");
    events.emit("SIGTERM");
    await running;
  });

  it("ignores messages that are not pushes", async () => {
    dispatch.run.mockReset().mockImplementation(async () => {});
    const { host, events, sent } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    events.emit("message", { type: "job", id: 1, job: { buildId: "b1" } });
    events.emit("message", "noise");
    await sleep(10);
    expect(dispatch.run).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    events.emit("SIGTERM");
    await running;
  });

  it("lets an in-flight capture finish before exiting on SIGTERM", async () => {
    const hold = { release: (): void => {} };
    const held = new Promise<null>((resolve) => {
      hold.release = () => {
        resolve(null);
      };
    });
    dispatch.run.mockReset().mockImplementation(async () => await held);
    const { host, events, sent, exit } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    push(events, "run-1", "b1");
    await sleep(20);
    events.emit("SIGTERM");
    await sleep(30);
    expect(exit).not.toHaveBeenCalled();
    hold.release();
    await running;
    expect(sent).toContainEqual({ type: "done", runId: "run-1" });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits at once when the parent disconnects", async () => {
    dispatch.run.mockReset().mockImplementation(async () => {});
    const { host, events, exit } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    events.emit("disconnect");
    expect(exit).toHaveBeenCalledWith(0);
    events.emit("SIGTERM");
    await running;
  });

  it("puts the shard jobs a big build fans out into straight on the database queue", async () => {
    dispatch.jobOptions.length = 0;
    dispatch.run.mockReset().mockImplementation(async () => {});
    const opts = options();
    const { host, events } = fakeHost({ [CAPTURE_RETRIES_ENV]: "4" });
    const running = runCaptureChild(opts, host);
    await sleep(20);
    const enqueue = dispatch.jobOptions.at(-1)?.enqueue;
    await enqueue?.({ buildId: "b1", shard: "b1:render:1", reqId: "req-1" });
    const rows = await opts.db.list(opts.db.tables.captureJobs, {});
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "capture",
        buildId: "b1",
        shardId: "b1:render:1",
        maxAttempts: 5,
        status: "queued",
      }),
    ]);
    events.emit("SIGTERM");
    await running;
  });

  it("takes retries and shard size from the options, else from the parent's environment", async () => {
    dispatch.jobOptions.length = 0;
    dispatch.maxRetries.length = 0;
    dispatch.run.mockReset().mockImplementation(async () => {});
    const fromEnv = fakeHost({ [CAPTURE_SHARD_SIZE_ENV]: "40", [CAPTURE_RETRIES_ENV]: "1" });
    const first = runCaptureChild(options(), fromEnv.host);
    await sleep(20);
    expect(dispatch.jobOptions.at(-1)?.shardSize).toBe(40);
    expect(dispatch.maxRetries.at(-1)).toBe(1);
    fromEnv.events.emit("SIGTERM");
    await first;

    const own = fakeHost({ [CAPTURE_SHARD_SIZE_ENV]: "40", [CAPTURE_RETRIES_ENV]: "1" });
    const second = runCaptureChild(options({ shardSize: 10, retries: 0 }), own.host);
    await sleep(20);
    expect(dispatch.jobOptions.at(-1)?.shardSize).toBe(10);
    expect(dispatch.maxRetries.at(-1)).toBe(0);
    own.events.emit("SIGTERM");
    await second;

    const bare = fakeHost({ [CAPTURE_SHARD_SIZE_ENV]: "nope" });
    const third = runCaptureChild(options(), bare.host);
    await sleep(20);
    expect(dispatch.jobOptions.at(-1)?.shardSize).toBeUndefined();
    expect(dispatch.maxRetries.at(-1)).toBe(2);
    bare.events.emit("SIGTERM");
    await third;
  });
});
