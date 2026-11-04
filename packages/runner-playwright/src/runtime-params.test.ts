import { afterEach, describe, expect, it } from "vitest";
import { extractAllParameters } from "./runtime-params.ts";

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
  Reflect.deleteProperty(globalThis, "__STORYBOOK_PREVIEW__");
});

describe("extractAllParameters", () => {
  it("waits for the preview to finish starting instead of extracting too early (SB_PREVIEW_API_0005)", async () => {
    let initialised = false;
    const preview: Preview = {
      ready: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        initialised = true;
      },
      extract: async () => {
        if (!initialised) throw new Error("SB_PREVIEW_API_0005: extract before initialization");
        return ENTRIES;
      },
    };
    const parameters = await extractAllParameters(pageWith(preview));
    expect(parameters["a--b"]).toMatchObject({ delay: 5 });
  });

  it("still extracts from a preview that has no ready()", async () => {
    const parameters = await extractAllParameters(pageWith({ extract: async () => ENTRIES }));
    expect(Object.keys(parameters)).toEqual(["a--b"]);
  });

  it("reads nothing from a page without a preview", async () => {
    expect(await extractAllParameters(pageWith())).toEqual({});
  });
});
