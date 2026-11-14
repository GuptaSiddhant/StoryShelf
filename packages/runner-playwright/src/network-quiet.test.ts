import { afterEach, describe, expect, it, vi } from "vitest";
import { trackRequests, type RequestEvents } from "./network-quiet.ts";

type Listener = (request: unknown) => void;

/** A page double that only knows request events. */
function fakePage(): RequestEvents & {
  fire(event: string, request: unknown): void;
  count(): number;
} {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (event, listener) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
    },
    off: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
    fire: (event, request) => {
      for (const listener of listeners.get(event) ?? []) listener(request);
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("trackRequests", () => {
  it("is quiet at once when the last request ended long enough ago", async () => {
    let now = 0;
    const page = fakePage();
    const tracker = trackRequests(page, () => now);
    page.fire("request", "a");
    page.fire("requestfinished", "a");
    now = 600;
    expect(await tracker.quiet(500, 1000)).toBe(true);
  });

  it("waits for a request in flight to end, then for the quiet window", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const tracker = trackRequests(page);
    page.fire("request", "img");
    let done: boolean | undefined;
    const waiting = tracker.quiet(500, 5000).then((value) => {
      done = value;
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBeUndefined();
    page.fire("requestfailed", "img");
    await vi.advanceTimersByTimeAsync(400);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await waiting;
    expect(done).toBe(true);
  });

  it("gives up when the page never goes quiet", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const tracker = trackRequests(page);
    page.fire("request", "poll");
    const waiting = tracker.quiet(500, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await waiting).toBe(false);
  });

  it("stops listening when disposed", () => {
    const page = fakePage();
    const tracker = trackRequests(page);
    expect(page.count()).toBe(3);
    tracker.dispose();
    expect(page.count()).toBe(0);
  });
});
