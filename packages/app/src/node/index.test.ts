import { describe, expect, it } from "vitest";

const EVENTS = ["SIGINT", "SIGTERM", "SIGHUP", "beforeExit", "exit"] as const;

/** How many active resources (servers, sockets, timers, …) of each kind are open. */
function resourceCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo()) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

describe("@storyshelf/app/node import purity", () => {
  it("adds no signal or exit handler, no server, no timer and no global at import", async () => {
    const listeners = EVENTS.map((name) => process.listenerCount(name));
    const before = resourceCounts();
    const globals = { Request: globalThis.Request, Response: globalThis.Response };
    const module = await import("./index.ts");
    expect(typeof module.startServer).toBe("function");
    expect(module.DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    expect(EVENTS.map((name) => process.listenerCount(name))).toEqual(listeners);
    const added = [...resourceCounts()].filter(([kind, count]) => count > (before.get(kind) ?? 0));
    expect(added).toEqual([]);
    expect({ Request: globalThis.Request, Response: globalThis.Response }).toEqual(globals);
  });
});
