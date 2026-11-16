import type { ConsumerJob } from "@storyshelf/core/capture";
import type { ResolvedShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  alerting,
  handlerFor,
  registerCrashHooks,
  type CaptureAlerts,
} from "./capture-handlers.ts";
import { createForkedHandler, shouldForkCapture } from "./capture-process.ts";
import type { JobQueue } from "./job-queue.ts";

vi.mock("@storyshelf/core/capture", async (original) => {
  const real = await original<typeof import("@storyshelf/core/capture")>();
  return { ...real, failCrashedCapture: vi.fn(async () => {}), createCaptureHandler: vi.fn() };
});
vi.mock("./capture-process.ts", () => ({
  shouldForkCapture: vi.fn(() => false),
  createForkedHandler: vi.fn(),
}));

const { createCaptureHandler, failCrashedCapture } = await import("@storyshelf/core/capture");

const logger = createShelfLogger({ level: "silent" });
const job = (extra: Record<string, unknown> = {}): ConsumerJob =>
  ({ buildId: "b1", ...extra }) as unknown as ConsumerJob;

function alerts(): CaptureAlerts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    failed: vi.fn(async (buildId: string) => {
      calls.push(`failed:${buildId}`);
    }),
    stuck: vi.fn(async (buildId: string) => {
      calls.push(`stuck:${buildId}`);
    }),
  };
}

const queue = (): JobQueue => ({ exhausted: {}, abandoned: {} }) as unknown as JobQueue;
const close = async (): Promise<void> => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerCrashHooks", () => {
  const dispatch = {} as never;

  it("sets the exhausted and abandoned hooks for capture jobs and returns the exhausted one", () => {
    const jobs = queue();
    const failed = registerCrashHooks(jobs, dispatch, alerts());
    expect(jobs.exhausted.capture).toBe(failed);
    expect(typeof jobs.abandoned.capture).toBe("function");
  });

  it("fails the crashed capture, then alerts that the build failed", async () => {
    const jobs = queue();
    const alert = alerts();
    vi.mocked(failCrashedCapture).mockImplementation(async () => {
      alert.calls.push("crash-recorded");
      return {} as never;
    });
    const failed = registerCrashHooks(jobs, dispatch, alert);

    await failed(job(), "lease lost");

    expect(failCrashedCapture).toHaveBeenCalledWith(
      dispatch,
      expect.objectContaining({ buildId: "b1" }),
      "lease lost",
    );
    expect(alert.calls).toEqual(["crash-recorded", "failed:b1"]);
  });

  it("only alerts that the build is stuck when a job is abandoned", async () => {
    const jobs = queue();
    const alert = alerts();
    registerCrashHooks(jobs, dispatch, alert);

    await jobs.abandoned.capture?.(job() as never, "abandoned" as never);

    expect(alert.calls).toEqual(["stuck:b1"]);
    expect(failCrashedCapture).not.toHaveBeenCalled();
  });
});

describe("alerting", () => {
  const retries = 3;

  it("alerts after a run that ended", async () => {
    const alert = alerts();
    const inner = { run: vi.fn(async () => {}) };

    await alerting(inner as never, retries, alert.failed).run(job() as never, {} as never);

    expect(inner.run).toHaveBeenCalledTimes(1);
    expect(alert.calls).toEqual(["failed:b1"]);
  });

  it("rethrows a failed attempt without alerting, until it is the final attempt", async () => {
    const alert = alerts();
    const boom = new Error("render crashed");
    const inner = {
      run: vi.fn(async () => {
        throw boom;
      }),
    };
    const wrapped = alerting(inner as never, retries, alert.failed);

    await expect(wrapped.run(job({ attempts: 1 }) as never, {} as never)).rejects.toBe(boom);
    expect(alert.calls).toEqual([]);

    await expect(wrapped.run(job({ attempts: 3 }) as never, {} as never)).rejects.toBe(boom);
    expect(alert.calls).toEqual(["failed:b1"]);
  });

  it("accepts a job unless the inner handler refuses it", () => {
    const alert = alerts();
    expect(alerting({ run: vi.fn() } as never, retries, alert.failed).accepts?.(job())).toBe(true);
    expect(
      alerting({ run: vi.fn(), accepts: () => false } as never, retries, alert.failed).accepts?.(
        job(),
      ),
    ).toBe(false);
  });

  it("reports a job superseded only when the inner handler says so", async () => {
    const alert = alerts();
    const without = alerting({ run: vi.fn() } as never, retries, alert.failed);
    const yes = alerting(
      { run: vi.fn(), superseded: async () => true } as never,
      retries,
      alert.failed,
    );
    const no = alerting(
      { run: vi.fn(), superseded: async () => false } as never,
      retries,
      alert.failed,
    );

    expect(await without.superseded?.(job())).toBe(false);
    expect(await yes.superseded?.(job())).toBe(true);
    expect(await no.superseded?.(job())).toBe(false);
  });

  it("passes a deadline and a cancel through to the inner handler", async () => {
    const alert = alerts();
    const inner = {
      run: vi.fn(),
      deadlineExceeded: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    };
    const wrapped = alerting(inner as never, retries, alert.failed);

    await wrapped.deadlineExceeded?.(job(), 30);
    await wrapped.cancel?.(job());

    expect(inner.deadlineExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "b1" }),
      30,
    );
    expect(inner.cancel).toHaveBeenCalledWith(expect.objectContaining({ buildId: "b1" }));
    await expect(
      alerting({ run: vi.fn() } as never, retries, alert.failed).cancel?.(job()),
    ).resolves.toBeUndefined();
  });

  it("keeps close only when the inner handler has one", () => {
    const alert = alerts();
    expect(alerting({ run: vi.fn(), close } as never, retries, alert.failed).close).toBe(close);
    expect("close" in alerting({ run: vi.fn() } as never, retries, alert.failed)).toBe(false);
  });
});

describe("handlerFor", () => {
  const handlerOptions = { marker: "options" } as never;
  const parts = { retries: 2, onCrashed: vi.fn(async () => {}), logger };

  it("runs captures in this process unless a fork is called for", () => {
    const inProcess = { run: vi.fn() };
    vi.mocked(createCaptureHandler).mockReturnValue(inProcess as never);
    vi.mocked(shouldForkCapture).mockReturnValue(false);

    const handler = handlerFor(
      { testing: {} } as unknown as ResolvedShelfOptions,
      handlerOptions,
      parts,
    );

    expect(handler).toBe(inProcess);
    expect(createCaptureHandler).toHaveBeenCalledWith(handlerOptions);
    expect(createForkedHandler).not.toHaveBeenCalled();
  });

  it("forks into a worker that falls back to this process, with the testing settings", () => {
    const inProcess = { run: vi.fn() };
    const forked = { run: vi.fn() };
    vi.mocked(createCaptureHandler).mockReturnValue(inProcess as never);
    vi.mocked(shouldForkCapture).mockReturnValue(true);
    vi.mocked(createForkedHandler).mockReturnValue(forked as never);
    const options = {
      testing: {
        workerEntry: "./worker.ts",
        shardSize: 4,
        images: { engine: "sharp" },
        compare: { threads: 2 },
      },
    } as unknown as ResolvedShelfOptions;

    const handler = handlerFor(options, handlerOptions, parts);

    expect(handler).toBe(forked);
    expect(createForkedHandler).toHaveBeenCalledWith({
      workerEntry: "./worker.ts",
      shardSize: 4,
      imageEngine: "sharp",
      diffThreads: 2,
      fallback: inProcess,
      ...parts,
    });
  });
});
