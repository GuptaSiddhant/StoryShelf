import { deferred } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";

type Preview = { extract?: () => Promise<unknown>; ready?: () => Promise<unknown> };

/** A page whose `evaluate` runs the shipped function in this scope, against the stubbed Storybook global. */
function pageWith(preview?: Preview) {
  if (preview) Reflect.set(globalThis, "__STORYBOOK_PREVIEW__", preview);
  return {
    evaluate: async (fn: unknown, ...args: unknown[]) =>
      await (fn as (...a: unknown[]) => Promise<unknown>)(...args),
  };
}

const ENTRIES = { "a--b": { parameters: { storyshelf: { delay: 5 } } } };

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "__STORYBOOK_PREVIEW__");
});

/** The parameters of `a--b`, read the way a capture reads them. */
async function read(page: ReturnType<typeof pageWith>) {
  return await runtimeParametersForStory(createRuntimeParamsState(), page, "a--b");
}

describe("runtimeParametersForStory", () => {
  it("waits for the preview to finish starting instead of extracting too early (SB_PREVIEW_API_0005)", async () => {
    const readyStarted = deferred();
    const gate = deferred();
    let initialised = false;
    let extractCalled = false;
    const preview: Preview = {
      ready: async () => {
        readyStarted.resolve();
        await gate.promise;
        initialised = true;
      },
      extract: async () => {
        extractCalled = true;
        if (!initialised) throw new Error("SB_PREVIEW_API_0005: extract before initialization");
        return ENTRIES;
      },
    };
    const pending = read(pageWith(preview));
    await readyStarted.promise;
    expect(extractCalled).toBe(false);
    gate.resolve();
    expect(await pending).toMatchObject({ delay: 5 });
  });

  it("gives up waiting after 15 s and extracts anyway, so the run reads no parameters", async () => {
    // Hold the preview's 15 s timer instead of waiting for it, and fire it by hand.
    const timers: { callback: () => void; delay: unknown }[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      delay: unknown,
    ) => {
      timers.push({ callback, delay });
      return 0;
    }) as never);
    let extractCalled = false;
    const preview: Preview = {
      ready: async () => await new Promise(() => {}),
      extract: async () => {
        extractCalled = true;
        throw new Error("SB_PREVIEW_API_0005: extract before initialization");
      },
    };
    const state = createRuntimeParamsState();
    const pending = runtimeParametersForStory(state, pageWith(preview), "a--b");
    expect(extractCalled).toBe(false);
    expect(timers.map((timer) => timer.delay)).toEqual([15_000]);
    timers[0]?.callback();
    expect(await pending).toBeUndefined();
    expect(extractCalled).toBe(true);
    expect(state.extractFailed).toBe(true);
  });

  it("still extracts from a preview that has no ready()", async () => {
    expect(await read(pageWith({ extract: async () => ENTRIES }))).toMatchObject({ delay: 5 });
  });

  it("reads nothing from a page without a preview", async () => {
    expect(await read(pageWith())).toBeUndefined();
  });
});
