import { describe, expect, it, vi } from "vitest";
import { createBadgeStore } from "./store.ts";

const state = {
  status: { build: { status: "reviewing" as const, reviewPath: "/r" }, stories: {} },
  reviewUrl: "https://shelf.example/r",
};

describe("createBadgeStore", () => {
  it("starts empty and returns the same object until set", () => {
    const store = createBadgeStore();
    expect(store.get()).toBeNull();
    store.set(state);
    expect(store.get()).toBe(state);
    expect(store.get()).toBe(store.get());
  });

  it("tells subscribers once per set, and not after they unsubscribe", () => {
    const store = createBadgeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(state);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.set(state);
    expect(listener).toHaveBeenCalledOnce();
  });
});
