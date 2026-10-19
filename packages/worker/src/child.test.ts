import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const dispatch = vi.hoisted(() => ({ run: vi.fn(), tables: [] as unknown[] }));
vi.mock("@storyshelf/core/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@storyshelf/core/capture")>();
  return {
    ...actual,
    createDispatchJob: (deps: { tables: unknown }) => {
      dispatch.tables.push(deps.tables);
      return dispatch.run;
    },
    sweepOrphanedScratch: async () => 0,
  };
});

const { runCaptureChild } = await import("./child.ts");
const { CAPTURE_CONCURRENCY_ENV } = await import("@storyshelf/core/capture");
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

function options(overrides: Record<string, unknown> = {}) {
  const tables = { projects: "p", builds: "b" };
  return {
    db: { tables } as never,
    storage: {} as never,
    runner: { cancel: async () => {}, render: vi.fn() } as never,
    scratchDir: ".tmp/child-test",
    config: { waitTimeSeconds: 0.05, backoffMs: 1, maxRetries: 0 },
    ...overrides,
  };
}

describe("runCaptureChild", () => {
  it("refuses to run outside a forked process", async () => {
    const { host } = fakeHost();
    await expect(runCaptureChild(options(), { ...host, send: undefined })).rejects.toThrow(
      /forked process/u,
    );
  });

  it("polls the parent, runs the job, acks it, and exits 0 on SIGTERM", async () => {
    dispatch.run.mockReset().mockImplementation(async () => {});
    const { host, events, sent, exit } = fakeHost();
    const running = runCaptureChild(options(), host);

    await sleep(20);
    const poll = sent.find((message) => message["type"] === "poll");
    expect(poll).toBeDefined();
    events.emit("message", {
      type: "job",
      id: poll?.["id"],
      job: { buildId: "b1", receipt: "r1", attempts: 0 },
    });
    await sleep(40);
    expect(dispatch.run).toHaveBeenCalledWith(expect.objectContaining({ buildId: "b1" }));
    expect(sent).toContainEqual({ type: "ack", receipt: "r1" });

    events.emit("SIGTERM");
    await running;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("lets an in-flight capture finish before exiting on SIGTERM", async () => {
    const gate = Promise.withResolvers<boolean>();
    dispatch.run.mockReset().mockImplementation(async () => await gate.promise);
    const { host, events, sent, exit } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    const poll = sent.find((message) => message["type"] === "poll");
    events.emit("message", {
      type: "job",
      id: poll?.["id"],
      job: { buildId: "b1", receipt: "r1" },
    });
    await sleep(30);

    events.emit("SIGTERM");
    await sleep(40);
    expect(exit).not.toHaveBeenCalled();
    gate.resolve(true);
    await running;
    expect(exit).toHaveBeenCalledWith(0);
    expect(sent).toContainEqual({ type: "ack", receipt: "r1" });
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

  it("uses the adapter's own tables, not the sqlite defaults", async () => {
    dispatch.tables.length = 0;
    dispatch.run.mockReset().mockImplementation(async () => {});
    const { host, events } = fakeHost();
    const running = runCaptureChild(options(), host);
    await sleep(20);
    events.emit("SIGTERM");
    await running;
    expect(dispatch.tables[0]).toMatchObject({ projects: "p", builds: "b" });
  });

  it("sizes concurrency from the parent's environment unless configured", async () => {
    dispatch.run.mockReset().mockImplementation(async () => await sleep(120));
    const { host, events, sent } = fakeHost({ [CAPTURE_CONCURRENCY_ENV]: "2" });
    const running = runCaptureChild(options(), host);
    await sleep(20);
    const first = sent.find((m) => m["type"] === "poll");
    events.emit("message", { type: "job", id: first?.["id"], job: { buildId: "a", receipt: "a" } });
    await sleep(30);
    const second = sent.filter((m) => m["type"] === "poll")[1];
    events.emit("message", {
      type: "job",
      id: second?.["id"],
      job: { buildId: "b", receipt: "b" },
    });
    await sleep(30);
    // Both captures are in flight at once, which only happens with concurrency 2.
    expect(dispatch.run).toHaveBeenCalledTimes(2);
    events.emit("SIGTERM");
    await running;
  });
});
