/** Page leasing for captures: a fresh page each time, or a small reusable pool (opt-in). */

import type { Viewport } from "@storyshelf/core/adapter/capture-runner";
import type { BrowserContext, Page } from "puppeteer-core";
import type { BrowserSession } from "./session.ts";
import { installSettleRecorder } from "./settle.ts";

/** A page on loan for one capture; `release(false)` discards it instead of reusing it. */
export interface PageLease {
  page: Page;
  release(reusable: boolean): Promise<void>;
}

/** Lease a page for `viewport`: pooled when the context has a pool, otherwise a throwaway. */
export async function acquirePage(
  ctx: { session: BrowserSession; pagePool?: PagePool },
  viewport: Viewport,
): Promise<PageLease> {
  if (ctx.pagePool) return await ctx.pagePool.acquire(viewport);
  const page = await ctx.session.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height });
  await installSettleRecorder(page);
  return {
    page,
    release: async () => {
      await page.close().catch(() => {});
      ctx.session.forgetPage(page);
    },
  };
}

interface Entry {
  context: BrowserContext;
  page: Page;
}

/**
 * Reuses pages (each in its own browser context) across captures to skip
 * per-capture startup and keep Storybook's JS in the HTTP cache. A page is
 * reset between captures (storage and cookies cleared, blank document) and
 * discarded, never reused, after a failed capture.
 */
export class PagePool {
  private readonly free: Entry[] = [];

  private readonly session: BrowserSession;

  constructor(session: BrowserSession) {
    this.session = session;
  }

  async acquire(viewport: Viewport): Promise<PageLease> {
    const entry = this.free.pop() ?? (await this.open());
    await entry.page.setViewport({ width: viewport.width, height: viewport.height });
    return {
      page: entry.page,
      release: async (reusable) => {
        if (reusable && (await reset(entry))) this.free.push(entry);
        else await this.close(entry);
      },
    };
  }

  /** Close every idle page; call before the browser is replaced or closed. */
  async dispose(): Promise<void> {
    await Promise.all(
      this.free.splice(0).map(async (entry) => {
        await this.close(entry);
      }),
    );
  }

  private async open(): Promise<Entry> {
    const context = await this.session.createBrowserContext();
    const page = await context.newPage();
    await installSettleRecorder(page);
    return { context, page };
  }

  private async close(entry: Entry): Promise<void> {
    await entry.context.close().catch(() => {});
    this.session.forgetContext(entry.context);
  }
}

/** Wipe everything a story could leave behind; false when the page can't be trusted again. */
async function reset(entry: Entry): Promise<boolean> {
  try {
    await entry.page.evaluate(clearBrowserState);
    await entry.context.deleteCookie(...(await entry.context.cookies()));
    await entry.page.goto("about:blank");
    return true;
  } catch {
    return false;
  }
}

/** Runs in the page: clears web storage and IndexedDB for the current origin. */
async function clearBrowserState(): Promise<void> {
  const scope = globalThis as unknown as {
    localStorage: { clear(): void };
    sessionStorage: { clear(): void };
    indexedDB?: {
      databases?: () => Promise<{ name?: string }[]>;
      deleteDatabase(name: string): unknown;
    };
  };
  scope.localStorage.clear();
  scope.sessionStorage.clear();
  const databases = (await scope.indexedDB?.databases?.()) ?? [];
  for (const database of databases) {
    if (database.name) scope.indexedDB?.deleteDatabase(database.name);
  }
}
