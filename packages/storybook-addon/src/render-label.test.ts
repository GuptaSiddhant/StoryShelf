import { describe, expect, it, vi } from "vitest";
import type { Badge } from "./badge.ts";
import { resolve, textOf, type FakeElement } from "./react-fake.ts";
import { badgeElement, createLabelRenderer } from "./render-label.ts";
import { createBadgeStore } from "./store.ts";

vi.mock("react", async () => await import("./react-fake.ts"));

const state = {
  status: {
    build: { status: "reviewing" as const, reviewPath: "/projects/gate/builds/b1/diff" },
    stories: { "a--one": { status: "changed" as const, design: "stale" as const } },
  },
  reviewUrl: "https://shelf.example/r",
};

describe("createLabelRenderer", () => {
  it("keeps the plain name for a component and for any entry that is not a story", () => {
    const render = createLabelRenderer(createBadgeStore(), vi.fn());
    expect(render({ id: "a", type: "component", name: "A" })).toBe("A");
    expect(render({ id: "a", type: "docs", name: "Docs" })).toBe("Docs");
  });

  it("shows the plain name until the status arrives, then the badges, from the same element", () => {
    const store = createBadgeStore();
    const render = createLabelRenderer(store, vi.fn());
    const label = render({ id: "a--one", type: "story", name: "One" });
    expect(textOf(label)).toBe("One");
    store.set(state);
    expect(textOf(label)).toBe("OneChangedDesign stale");
    const badges = (resolve(label) as FakeElement).children.slice(1) as FakeElement[];
    expect(badges.map((badge) => badge.props["role"])).toEqual(["link", "link"]);
  });

  it("keeps the plain name for a story the answer does not list", () => {
    const store = createBadgeStore();
    store.set(state);
    const render = createLabelRenderer(store, vi.fn());
    expect(textOf(render({ id: "a--none", type: "story", name: "None" }))).toBe("None");
  });
});

describe("badgeElement", () => {
  const badge: Badge = { label: "Changed", tone: "warn" };

  it("opens the review without selecting the story, by click and by Enter only", () => {
    const open = vi.fn();
    const { props } = badgeElement(badge, "https://shelf.example/r", open) as FakeElement;
    const click = props["onClick"] as (event: unknown) => void;
    const keyDown = props["onKeyDown"] as (event: unknown) => void;
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), key: "Enter" };
    click(event);
    keyDown(event);
    keyDown({ ...event, key: "a" });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith("https://shelf.example/r");
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(event.stopPropagation).toHaveBeenCalledTimes(2);
  });
});
