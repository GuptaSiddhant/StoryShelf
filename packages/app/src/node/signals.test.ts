import { describe, expect, it, vi } from "vitest";
import { onShutdownSignals } from "./signals.ts";

describe("onShutdownSignals", () => {
  it("calls the handler with the signal, and removes only its own listeners", () => {
    const theirs = vi.fn();
    process.on("SIGTERM", theirs);
    try {
      const handler = vi.fn();
      const remove = onShutdownSignals(handler);
      const ours = process.listeners("SIGTERM").at(-1) as () => void;
      ours();
      (process.listeners("SIGINT").at(-1) as () => void)();
      expect(handler.mock.calls).toEqual([["SIGTERM"], ["SIGINT"]]);
      remove();
      expect(process.listeners("SIGTERM")).not.toContain(ours);
      expect(process.listeners("SIGTERM")).toContain(theirs);
    } finally {
      process.off("SIGTERM", theirs);
    }
  });
});
