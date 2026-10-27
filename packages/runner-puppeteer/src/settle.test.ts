import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTLE_TIMEOUT_MS,
  inPagePaint,
  inPageRecorder,
  inPageWaitSettled,
  installSettleRecorder,
  settleTimeoutOf,
  waitForSettled,
} from "./settle.ts";
import { verdictOf } from "./tests.ts";

/** Rebuild a function from its source in a scope with no module bindings, as `page.evaluate` does. */
function asSerialized<T extends (...args: never[]) => unknown>(fn: T): T {
  // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
  return new Function(`return (${fn.toString()})`)() as T;
}

async function failingEvaluate(): Promise<never> {
  throw new Error("page closed");
}

type Handler = (payload: unknown) => void;

/** A Storybook channel double: `on` registers, `emit` delivers. */
function fakeChannel(): {
  on: (event: string, cb: Handler) => void;
  emit: Handler & ((event: string, payload?: unknown) => void);
} {
  const handlers = new Map<string, Handler[]>();
  return {
    on: (event, cb) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    },
    emit: ((event: string, payload?: unknown) => {
      for (const cb of handlers.get(event) ?? []) cb(payload);
    }) as never,
  };
}

const scope = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  vi.useRealTimers();
  delete scope["__STORYSHELF_SETTLE__"];
  delete scope["__STORYBOOK_ADDONS_CHANNEL__"];
  delete scope["__STORYBOOK_PREVIEW__"];
  delete scope["document"];
});

describe("inPageRecorder (as serialized into the page)", () => {
  const record = asSerialized(inPageRecorder);
  const wait = asSerialized(inPageWaitSettled);

  it("is self-contained and settles on storyRendered", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("storyRenderPhaseChanged", { newPhase: "rendering" });
    channel.emit("storyRendered", "a--b");
    const report = await wait({ timeoutMs: 500 });
    expect(report).toMatchObject({ settled: true, hooked: true, phase: "rendering" });
  });

  it("waits for test completion after render and records a late play failure", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("storyRendered", "a--b");
    expect(await wait({ timeoutMs: 0, requireFinished: true })).toMatchObject({
      settled: false,
      hooked: true,
    });
    channel.emit("playFunctionThrewException", new Error("late failure"));
    channel.emit("storyFinished", { storyId: "a--b", status: "error" });
    expect(await wait({ timeoutMs: 500, requireFinished: true })).toMatchObject({
      settled: true,
      playError: "late failure",
    });
  });

  it("records a failure when only the completion status reports an error", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("storyRendered", "a--b");
    channel.emit("storyFinished", { storyId: "a--b", status: "error" });
    const report = await wait({ timeoutMs: 500, requireFinished: true });
    expect(report).toMatchObject({
      settled: true,
      playError: "Storybook reported that the test failed",
    });
    expect(verdictOf("a--b", report, 500, 1)).toMatchObject({ status: "failed" });
  });

  it("finishes a test on a render error even when no finished event follows", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("storyMissing", "missing");
    expect(await wait({ timeoutMs: 500, requireFinished: true })).toMatchObject({
      settled: true,
      renderError: "missing",
    });
  });

  it("takes the channel from the preview when the global is absent", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_PREVIEW__"] = { channel };
    record();
    channel.emit("storyFinished", { storyId: "a--b", status: "success" });
    expect((await wait({ timeoutMs: 500 })).settled).toBe(true);
  });

  it("settles on a render error and keeps its message", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("storyThrewException", { message: "boom" });
    expect(await wait({ timeoutMs: 500 })).toMatchObject({ settled: true, renderError: "boom" });
  });

  it("reads storyErrored and storyMissing descriptions", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("storyErrored", { title: "Broken", description: "no such export" });
    expect((await wait({ timeoutMs: 500 })).renderError).toBe("no such export");
    channel.emit("storyMissing", "gone");
    expect((await wait({ timeoutMs: 500 })).renderError).toBe("gone");
  });

  it("records a play error and unhandled errors without settling by itself", async () => {
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    channel.emit("playFunctionThrewException", new Error("assertion failed"));
    channel.emit("unhandledErrorsWhilePlaying", [{ message: "late 1" }, "late 2"]);
    channel.emit("storyRendered", "a--b");
    expect(await wait({ timeoutMs: 500 })).toMatchObject({
      settled: true,
      playError: "assertion failed",
      unhandled: ["late 1", "late 2"],
    });
  });

  it("times out unsettled when the channel exists but the event never comes", async () => {
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = fakeChannel();
    record();
    const report = await wait({ timeoutMs: 0 });
    expect(report).toMatchObject({ settled: false, hooked: true });
  });

  it("answers at once when no channel ever appears after the page loaded", async () => {
    scope["document"] = { readyState: "complete" };
    record();
    const report = await wait({ timeoutMs: 10_000 });
    expect(report).toMatchObject({ settled: false, hooked: false });
    expect(report.elapsedMs).toBeLessThan(1000);
    delete scope["document"];
  });

  it("answers unhooked when the recorder was never installed", async () => {
    expect(await wait({ timeoutMs: 10_000 })).toMatchObject({ settled: false, hooked: false });
  });

  it("hooks a channel that appears after the recorder ran", async () => {
    record();
    const channel = fakeChannel();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    const state = scope["__STORYSHELF_SETTLE__"] as { hook: () => boolean };
    expect(state.hook()).toBe(true);
    channel.emit("storyRendered", "a--b");
    expect((await wait({ timeoutMs: 500 })).settled).toBe(true);
  });

  it("installs once per document", () => {
    const channel = fakeChannel();
    const on = vi.spyOn(channel, "on");
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = channel;
    record();
    const calls = on.mock.calls.length;
    record();
    expect(on.mock.calls.length).toBe(calls);
  });
});

describe("inPagePaint", () => {
  it("resolves even when no frame is ever painted", async () => {
    scope["document"] = { fonts: { ready: Promise.resolve() } };
    scope["requestAnimationFrame"] = () => {};
    try {
      await expect(asSerialized(inPagePaint)()).resolves.toBeUndefined();
    } finally {
      delete scope["document"];
      delete scope["requestAnimationFrame"];
    }
  });
});

describe("page helpers", () => {
  it("installs the recorder as an init script", async () => {
    const evaluateOnNewDocument = vi.fn(async () => {});
    await installSettleRecorder({ evaluateOnNewDocument } as never);
    expect(evaluateOnNewDocument).toHaveBeenCalledWith(inPageRecorder);
  });

  it("returns the page's report", async () => {
    const report = { settled: true, hooked: true, phase: "completed", elapsedMs: 3 };
    const evaluate = vi.fn(async () => report);
    expect(await waitForSettled({ evaluate } as never, 100)).toBe(report);
    expect(evaluate).toHaveBeenCalledWith(inPageWaitSettled, { timeoutMs: 100 });
  });

  it("treats an unreadable answer or a failed evaluate as no signal", async () => {
    expect((await waitForSettled({ evaluate: async () => ({}) } as never, 1)).settled).toBe(false);
    expect(await waitForSettled({ evaluate: failingEvaluate } as never, 1)).toMatchObject({
      settled: false,
      hooked: false,
    });
  });

  it("waits for the play timeout when plays run", () => {
    expect(settleTimeoutOf({})).toBe(DEFAULT_SETTLE_TIMEOUT_MS);
    expect(settleTimeoutOf({ executePlay: true, playTimeoutMs: 30_000 })).toBe(30_000);
    expect(settleTimeoutOf({ executePlay: true, playTimeoutMs: 100 })).toBe(
      DEFAULT_SETTLE_TIMEOUT_MS,
    );
    expect(settleTimeoutOf({ settleTimeoutMs: 7 })).toBe(7);
  });
});
