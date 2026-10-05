import { afterEach, describe, expect, it, vi } from "vitest";
import { inPagePlay, runPlay } from "./play.ts";

type PlayFn = typeof inPagePlay;

/**
 * Rebuild the function from its source in a scope that has no module bindings, the way
 * `page.evaluate` ships it to the browser. Any reference to a module-level helper then throws.
 */
function asSerialized(fn: PlayFn): PlayFn {
  // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
  return new Function(`return (${fn.toString()})`)() as PlayFn;
}

function setPreview(preview: unknown): void {
  (globalThis as unknown as Record<string, unknown>)["__STORYBOOK_PREVIEW__"] = preview;
}

afterEach(() => {
  setPreview(undefined);
});

describe("inPagePlay (as serialized into the page)", () => {
  const run = asSerialized(inPagePlay);

  it("is self-contained: runs without any module-level helpers in scope", async () => {
    setPreview({ executePlay: vi.fn(async () => {}) });
    await expect(run({ storyId: "a--b", timeoutMs: 1000 })).resolves.toBeUndefined();
  });

  it("does nothing when Storybook's preview global is missing", async () => {
    await expect(run({ storyId: "a--b", timeoutMs: 1000 })).resolves.toBeUndefined();
  });

  it("propagates a thrown play error", async () => {
    setPreview({ executePlay: vi.fn().mockRejectedValue(new Error("assertion failed")) });
    await expect(run({ storyId: "a--b", timeoutMs: 1000 })).rejects.toThrow("assertion failed");
  });

  it("rejects when the play function throws through the channel but resolves", async () => {
    const boom = new Error("channel reported");
    setPreview({
      channel: {
        on: (_event: string, cb: (err: unknown) => void) => {
          cb(boom);
        },
      },
      executePlay: vi.fn(async () => {}),
    });
    await expect(run({ storyId: "a--b", timeoutMs: 1000 })).rejects.toBe(boom);
  });

  it("falls back to the story store's play function", async () => {
    const play = vi.fn(async () => {});
    setPreview({ storyStore: { fromId: () => ({ play }) } });
    await run({ storyId: "a--b", timeoutMs: 1000 });
    expect(play).toHaveBeenCalledOnce();
  });

  it("times out a play function that never settles", async () => {
    setPreview({ executePlay: () => new Promise<void>(() => {}) });
    await expect(run({ storyId: "a--b", timeoutMs: 20 })).rejects.toThrow(
      "play timeout after 20ms",
    );
  });
});

describe("runPlay", () => {
  it("evaluates the self-contained function in the page and prefixes failures", async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(runPlay({ evaluate } as never, "a--b", 500)).rejects.toThrow("play failed: boom");
    expect(evaluate).toHaveBeenCalledWith(inPagePlay, { storyId: "a--b", timeoutMs: 500 });
  });
});
