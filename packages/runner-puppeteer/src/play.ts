/** Storybook `play` function execution inside the page. */

import type { Page } from "puppeteer-core";
import { messageOf } from "./browser.ts";

/** Arguments serialized into the page for {@link inPagePlay}. */
export interface PlayArgs {
  storyId: string;
  timeoutMs: number;
}

/** Execute the story's play function with a timeout race. */
export async function runPlay(page: Page, storyId: string, timeoutMs: number): Promise<void> {
  try {
    await page.evaluate(inPagePlay, { storyId, timeoutMs });
  } catch (error) {
    throw new Error(`play failed: ${messageOf(error)}`, { cause: error });
  }
}

/**
 * Runs inside the browser. Playwright serializes only this function's source, so it must not
 * reference anything from this module (helpers, imports): split it up and the page throws
 * `ReferenceError`. `play.test.ts` evaluates it in a scope without module bindings to guard that.
 */
// oxlint-disable-next-line eslint/max-statements -- must stay one self-contained function (see above)
export async function inPagePlay({ storyId, timeoutMs }: PlayArgs): Promise<void> {
  type Preview = {
    executePlay?: (id: string) => Promise<void>;
    storyStore?: { fromId?: (id: string) => { play?: (ctx: unknown) => Promise<void> } };
    channel?: { on: (event: string, cb: (err: unknown) => void) => void };
  };
  const preview = (globalThis as unknown as Record<string, Preview | undefined>)[
    "__STORYBOOK_PREVIEW__"
  ];
  if (!preview) return;
  let playError: unknown = null;
  try {
    // Best-effort: play still runs without the channel hookup.
    preview.channel?.on("playFunctionThrewException", (err) => {
      playError = err;
    });
  } catch {
    // ignore
  }
  const canvasElement = globalThis.document?.querySelector("#storybook-root");
  const work = preview.executePlay
    ? preview.executePlay(storyId)
    : preview.storyStore?.fromId?.(storyId)?.play?.({ canvasElement });
  if (!work) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`play timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (playError) throw playError;
}
