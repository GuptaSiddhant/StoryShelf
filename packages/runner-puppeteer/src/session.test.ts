import type { Browser, BrowserContext, Page } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELEASE_TIMEOUT_MS, createBrowserSession, type ReleaseOutcome } from "./session.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function pageWithClose(close: () => Promise<void>): Page {
  return { close } as unknown as Page;
}

function contextWithClose(close: () => Promise<void>): BrowserContext {
  return { close } as unknown as BrowserContext;
}

describe("BrowserSession", () => {
  it("closes a launched browser once, however often release is called", async () => {
    const close = vi.fn(async (): Promise<void> => {});
    const session = createBrowserSession({
      browser: { close } as unknown as Browser,
      ownership: "launched",
    });

    await session.release("finished");
    await session.release("cancelled");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes only the pages and contexts it created, then disconnects, never closing the browser", async () => {
    const pageClose = vi.fn(async (): Promise<void> => {});
    const contextClose = vi.fn(async (): Promise<void> => {});
    const browserClose = vi.fn(async (): Promise<void> => {});
    const disconnect = vi.fn(async (): Promise<void> => {});
    const page = pageWithClose(pageClose);
    const context = contextWithClose(contextClose);
    const browser = {
      newPage: async () => await Promise.resolve(page),
      createBrowserContext: async () => await Promise.resolve(context),
      close: browserClose,
      disconnect,
    } as unknown as Browser;
    const session = createBrowserSession({ browser, ownership: "connected" });

    await session.newPage();
    await session.createBrowserContext();
    await session.release("finished");

    expect(pageClose).toHaveBeenCalledTimes(1);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(browserClose).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not close a page or context the run forgot", async () => {
    const forgottenPageClose = vi.fn(async (): Promise<void> => {});
    const keptPageClose = vi.fn(async (): Promise<void> => {});
    const forgottenContextClose = vi.fn(async (): Promise<void> => {});
    const keptContextClose = vi.fn(async (): Promise<void> => {});
    const forgottenPage = pageWithClose(forgottenPageClose);
    const keptPage = pageWithClose(keptPageClose);
    const forgottenContext = contextWithClose(forgottenContextClose);
    const keptContext = contextWithClose(keptContextClose);
    const browser = {
      newPage: vi.fn().mockResolvedValueOnce(keptPage).mockResolvedValueOnce(forgottenPage),
      createBrowserContext: vi
        .fn()
        .mockResolvedValueOnce(keptContext)
        .mockResolvedValueOnce(forgottenContext),
      disconnect: async () => {},
    } as unknown as Browser;
    const session = createBrowserSession({ browser, ownership: "connected" });

    await session.newPage();
    const page = await session.newPage();
    await session.createBrowserContext();
    const context = await session.createBrowserContext();
    session.forgetPage(page);
    session.forgetContext(context);

    await session.release("finished");

    expect(keptPageClose).toHaveBeenCalledTimes(1);
    expect(forgottenPageClose).not.toHaveBeenCalled();
    expect(keptContextClose).toHaveBeenCalledTimes(1);
    expect(forgottenContextClose).not.toHaveBeenCalled();
  });

  it("keeps the first outcome and releases the provider lease once, after disconnect", async () => {
    const events: string[] = [];
    const browser = {
      newPage: async () =>
        await Promise.resolve(
          pageWithClose(async () => {
            events.push("page");
          }),
        ),
      disconnect: async () => {
        events.push("disconnect");
      },
    } as unknown as Browser;
    const releaseLease = vi.fn(async (outcome: ReleaseOutcome): Promise<void> => {
      events.push(`lease:${outcome}`);
    });
    const session = createBrowserSession({
      browser,
      ownership: "connected",
      releaseLease,
    });

    await session.newPage();
    const first = session.release("cancelled");
    const second = session.release("finished");
    await Promise.all([first, second]);

    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(releaseLease).toHaveBeenCalledWith("cancelled");
    expect(events).toEqual(["page", "disconnect", "lease:cancelled"]);
  });

  it("releases a shared provider lease once per session; the final owner ends it", async () => {
    let held = 2;
    const releaseLease = vi.fn(async (): Promise<void> => {
      held -= 1;
    });
    const browser = { disconnect: async () => {} } as unknown as Browser;
    const first = createBrowserSession({ browser, ownership: "connected", releaseLease });
    const second = createBrowserSession({ browser, ownership: "connected", releaseLease });

    await first.release("finished");
    expect(held).toBe(1);
    await second.release("failed");
    expect(held).toBe(0);
    expect(releaseLease).toHaveBeenCalledTimes(2);
  });

  it("never throws when closing, disconnecting or releasing the lease fails", async () => {
    const browser = {
      disconnect: async () => {
        throw new Error("disconnect failed");
      },
    } as unknown as Browser;
    const session = createBrowserSession({
      browser,
      ownership: "connected",
      releaseLease: async () => {
        throw new Error("lease failed");
      },
    });

    await expect(session.release("failed")).resolves.toBeUndefined();
  });

  it("bounds a cleanup step that never finishes", async () => {
    const timeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((handler: TimerHandler): ReturnType<typeof setTimeout> => {
        if (typeof handler === "function") handler();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    const close = vi.fn((): Promise<void> => new Promise<void>(() => {}));
    const session = createBrowserSession({
      browser: { close } as unknown as Browser,
      ownership: "launched",
    });

    await expect(session.release("finished")).resolves.toBeUndefined();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), RELEASE_TIMEOUT_MS);
  });

  it("waits for a pending page, closes it, and then disconnects", async () => {
    const pageClose = vi.fn(async (): Promise<void> => {});
    const disconnect = vi.fn(async (): Promise<void> => {});
    let resolvePage: ((page: Page) => void) | undefined;
    const browser = {
      newPage: async () =>
        await new Promise<Page>((resolve) => {
          resolvePage = resolve;
        }),
      disconnect,
    } as unknown as Browser;
    const session = createBrowserSession({ browser, ownership: "connected" });

    const pending = session.newPage();
    const released = session.release("cancelled");
    expect(disconnect).not.toHaveBeenCalled();
    resolvePage?.(pageWithClose(pageClose));

    await expect(pending).rejects.toThrow("browser session released");
    await expect(released).resolves.toBeUndefined();
    expect(pageClose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending context, closes it, and then disconnects", async () => {
    const contextClose = vi.fn(async (): Promise<void> => {});
    const disconnect = vi.fn(async (): Promise<void> => {});
    let resolveContext: ((context: BrowserContext) => void) | undefined;
    const browser = {
      createBrowserContext: async () =>
        await new Promise<BrowserContext>((resolve) => {
          resolveContext = resolve;
        }),
      disconnect,
    } as unknown as Browser;
    const session = createBrowserSession({ browser, ownership: "connected" });

    const pending = session.createBrowserContext();
    const released = session.release("cancelled");
    expect(disconnect).not.toHaveBeenCalled();
    resolveContext?.(contextWithClose(contextClose));

    await expect(pending).rejects.toThrow("browser session released");
    await expect(released).resolves.toBeUndefined();
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
