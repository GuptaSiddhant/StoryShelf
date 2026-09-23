/** Storybook `play` function execution inside the page. */

import type { Page } from "puppeteer-core";
import { messageOf } from "./browser.ts";

/** Execute the story's play function with a timeout race. */
export async function runPlay(page: Page, storyId: string, timeoutMs: number): Promise<void> {
  try {
    await evaluatePlay(page, storyId, timeoutMs);
  } catch (error) {
    throw new Error(`play failed: ${messageOf(error)}`, { cause: error });
  }
}

async function evaluatePlay(page: Page, storyId: string, timeoutMs: number): Promise<void> {
  await page.evaluate(
    async ({ storyId: sid, timeoutMs: tms }: { storyId: string; timeoutMs: number }) => {
      const win = globalThis as unknown as {
        __STORYBOOK_PREVIEW__?: {
          executePlay?: (id: string) => Promise<void>;
          storyStore?: { fromId?: (id: string) => { play?: () => Promise<void> } };
          channel?: { on: (e: string, cb: (err: unknown) => void) => void };
        };
      };
      // oxlint-disable-next-line typescript/dot-notation -- __STORYBOOK_PREVIEW__ is a Storybook global
      const preview = win["__STORYBOOK_PREVIEW__"];
      if (!preview) return;
      let playError: unknown = null;
      hookChannel(preview, (err) => {
        playError = err;
      });
      await invokePlay(preview, sid, tms);
      if (playError) throw playError;
    },
    { storyId, timeoutMs },
  );
}

function hookChannel(
  preview: { channel?: { on: (e: string, cb: (err: unknown) => void) => void } },
  handler: (err: unknown) => void,
): void {
  try {
    preview.channel?.on("playFunctionThrewException", handler);
  } catch {
    // Channel hookup is best-effort; play still runs without it.
  }
}

async function invokePlay(
  preview: {
    executePlay?: (id: string) => Promise<void>;
    storyStore?: { fromId?: (id: string) => { play?: (ctx: unknown) => Promise<void> } };
  },
  storyId: string,
  timeoutMs: number,
): Promise<void> {
  if (preview.executePlay) {
    await raceWithTimeout(preview.executePlay(storyId), timeoutMs);
    return;
  }
  await tryStoryStorePlay(preview, storyId, timeoutMs);
}

async function tryStoryStorePlay(
  preview: { storyStore?: { fromId?: (id: string) => { play?: (ctx: unknown) => Promise<void> } } },
  storyId: string,
  timeoutMs: number,
): Promise<void> {
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- structural storyStore narrowing
  const loaded = preview.storyStore?.fromId?.(storyId) as unknown as
    | {
        play?: (ctx: unknown) => Promise<void>;
      }
    | undefined;
  if (!loaded?.play) return;
  await raceWithTimeout(
    loaded.play({ canvasElement: globalThis.document.querySelector("#storybook-root") }),
    timeoutMs,
  );
}

async function raceWithTimeout(work: Promise<void>, timeoutMs: number): Promise<void> {
  await Promise.race([work, timeoutPromise(timeoutMs)]);
}

async function timeoutPromise(timeoutMs: number): Promise<never> {
  return await new Promise<never>((unusedResolve, reject) => {
    // oxlint-disable-next-line eslint/no-void, eslint/no-unused-vars -- resolve is unused by design
    void unusedResolve;
    setTimeout(() => {
      reject(new Error(`play timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
