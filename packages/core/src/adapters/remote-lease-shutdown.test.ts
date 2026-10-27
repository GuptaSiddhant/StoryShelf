import { describe, expect, it, vi } from "vitest";
import { startAttempt } from "./remote-lease-attempt.ts";
import { onRemoteShutdown, shutdownRemote } from "./remote-lease-shutdown.ts";

describe("shutdownRemote", () => {
  it("stops pending attempts, then runs the hooks", async () => {
    const attempt = startAttempt();
    const order: string[] = [];
    const unregister = onRemoteShutdown(async () => {
      order.push(`hook, attempt stopped: ${attempt.stopped}`);
      await Promise.resolve();
    });
    await shutdownRemote();
    expect(order).toEqual(["hook, attempt stopped: true"]);
    unregister();
  });

  it("does not run a hook that was unregistered", async () => {
    const hook = vi.fn(async () => await Promise.resolve());
    onRemoteShutdown(hook)();
    await shutdownRemote();
    expect(hook).not.toHaveBeenCalled();
  });
});
