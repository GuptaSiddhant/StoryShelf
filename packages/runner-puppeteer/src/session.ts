/** Ownership of a browser a run drives: one it launched, or a connection it must leave alive. */

import type { Browser, BrowserContext, Page } from "puppeteer-core";

/** Who owns the browser process: this run launched it, or it connected to someone else's. */
export type BrowserOwnership = "launched" | "connected";

/** Why a session is being released; the first reason wins. */
export type ReleaseOutcome = "finished" | "failed" | "cancelled";

/** A provider's final release, run once after the transport is gone. */
export type ReleaseLease = (outcome: ReleaseOutcome) => Promise<void>;

/** A browser plus what the run may do to it when the run ends. */
export interface BrowserAcquisition {
  browser: Browser;
  ownership: BrowserOwnership;
  releaseLease?: ReleaseLease;
}

/** The run's handle on a browser; it closes or disconnects only what the run owns. */
export interface BrowserSession {
  readonly browser: Browser;
  readonly ownership: BrowserOwnership;
  newPage(): Promise<Page>;
  createBrowserContext(): Promise<BrowserContext>;
  forgetPage(page: Page): void;
  forgetContext(context: BrowserContext): void;
  release(outcome: ReleaseOutcome): Promise<void>;
}

/** How long one cleanup step may take before release moves on. */
export const RELEASE_TIMEOUT_MS = 5000;

/** Wrap an acquisition so the run tracks the pages and contexts it creates. */
export function createBrowserSession(acquisition: BrowserAcquisition): BrowserSession {
  return new OwnedSession(acquisition);
}

class OwnedSession implements BrowserSession {
  readonly browser: Browser;
  readonly ownership: BrowserOwnership;

  readonly #lease: ReleaseLease | undefined;
  readonly #pages = new Set<Page>();
  readonly #contexts = new Set<BrowserContext>();
  #released: Promise<void> | undefined;
  #outcome: ReleaseOutcome | undefined;

  constructor({ browser, ownership, releaseLease: lease }: BrowserAcquisition) {
    this.browser = browser;
    this.ownership = ownership;
    this.#lease = lease;
  }

  async newPage(): Promise<Page> {
    this.#assertOpen();
    const page = await this.browser.newPage();
    if (this.#released !== undefined) {
      await closePage(page);
      throw releasedError();
    }
    this.#pages.add(page);
    return page;
  }

  async createBrowserContext(): Promise<BrowserContext> {
    this.#assertOpen();
    const context = await this.browser.createBrowserContext();
    if (this.#released !== undefined) {
      await closeContext(context);
      throw releasedError();
    }
    this.#contexts.add(context);
    return context;
  }

  forgetPage(page: Page): void {
    this.#pages.delete(page);
  }

  forgetContext(context: BrowserContext): void {
    this.#contexts.delete(context);
  }

  async release(outcome: ReleaseOutcome): Promise<void> {
    this.#outcome ??= outcome;
    this.#released ??= this.#releaseAll().catch(() => {});
    await this.#released;
  }

  #assertOpen(): void {
    if (this.#released !== undefined) throw releasedError();
  }

  async #releaseAll(): Promise<void> {
    await (this.ownership === "launched" ? closeLaunched(this.browser) : this.#releaseConnected());
    await releaseLease(this.#lease, this.#outcome ?? "finished");
  }

  async #releaseConnected(): Promise<void> {
    await Promise.all(
      [...this.#pages].map(async (page) => {
        await this.#closePage(page);
      }),
    );
    await Promise.all(
      [...this.#contexts].map(async (context) => {
        await this.#closeContext(context);
      }),
    );
    await bounded(async () => {
      await this.browser.disconnect();
    });
  }

  async #closePage(page: Page): Promise<void> {
    await closePage(page);
    this.#pages.delete(page);
  }

  async #closeContext(context: BrowserContext): Promise<void> {
    await closeContext(context);
    this.#contexts.delete(context);
  }
}

function releasedError(): Error {
  return new Error("browser session released");
}

async function closeLaunched(browser: Browser): Promise<void> {
  await bounded(async () => {
    await browser.close();
  });
}

async function closePage(page: Page): Promise<void> {
  await bounded(async () => {
    await page.close();
  });
}

async function closeContext(context: BrowserContext): Promise<void> {
  await bounded(async () => {
    await context.close();
  });
}

async function releaseLease(
  lease: ReleaseLease | undefined,
  outcome: ReleaseOutcome,
): Promise<void> {
  if (lease === undefined) return;
  await bounded(async () => {
    await lease(outcome);
  });
}

async function bounded(work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, RELEASE_TIMEOUT_MS);
  });
  try {
    await Promise.race([work().catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
