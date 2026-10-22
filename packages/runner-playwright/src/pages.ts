/** Page leasing for captures: a fresh page each time, or a small reusable pool (opt-in). */

import type { Viewport } from "@storyshelf/core/adapter/capture-runner";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { installSettleRecorder } from "./settle.ts";

/** A page on loan for one capture; `release(false)` discards it instead of reusing it. */
export interface PageLease {
  page: Page;
  release(reusable: boolean): Promise<void>;
}

/** Lease a page for `viewport`: pooled when the context has a pool, otherwise a throwaway. */
export async function acquirePage(
  ctx: { browser: Browser; pagePool?: PagePool },
  viewport: Viewport,
): Promise<PageLease> {
  if (ctx.pagePool) return await ctx.pagePool.acquire(viewport);
  const page = await ctx.browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  await installSettleRecorder(page);
  return {
    page,
    release: async () => {
      await page.close();
    },
  };
}

interface Entry {
  context: BrowserContext;
  page: Page;
}

/**
 * Reuses pages (each in its own context) across captures to skip per-capture
 * context/page startup and keep Storybook's JS in the HTTP cache. A page is
 * reset between captures (storage and cookies cleared, blank document) and
 * discarded, never reused, after a failed capture.
 */
export class PagePool {
  private readonly free: Entry[] = [];

  private readonly browser: Browser;

  constructor(browser: Browser) {
    this.browser = browser;
  }

  async acquire(viewport: Viewport): Promise<PageLease> {
    const entry = this.free.pop() ?? (await this.open(viewport));
    await entry.page.setViewportSize({ width: viewport.width, height: viewport.height });
    return {
      page: entry.page,
      release: async (reusable) => {
        if (reusable && (await reset(entry))) this.free.push(entry);
        else await closeEntry(entry);
      },
    };
  }

  /** Close every idle page; call before the browser is replaced or closed. */
  async dispose(): Promise<void> {
    await Promise.all(
      this.free.splice(0).map(async (entry) => {
        await closeEntry(entry);
      }),
    );
  }

  private async open(viewport: Viewport): Promise<Entry> {
    const context = await this.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    await installSettleRecorder(page);
    return { context, page };
  }
}

/** Wipe everything a story could leave behind; false when the page can't be trusted again. */
async function reset(entry: Entry): Promise<boolean> {
  try {
    await entry.page.evaluate(clearBrowserState);
    await entry.context.clearCookies();
    await entry.page.goto("about:blank");
    return true;
  } catch {
    return false;
  }
}

async function closeEntry(entry: Entry): Promise<void> {
  await entry.context.close().catch(() => {});
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
