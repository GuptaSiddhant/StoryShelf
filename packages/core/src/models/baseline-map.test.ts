import { describe, expect, it } from "vitest";
import type { Baseline } from "../schema/baseline.ts";
import { BaselineMap } from "./baseline-map.ts";

const row = (id: string, browser?: string): Baseline =>
  ({ id, storyId: "s", viewportName: "desktop", ...(browser ? { browser } : {}) }) as Baseline;

describe("BaselineMap", () => {
  it("keeps the first row added for a key and defaults the engine", () => {
    const map = new BaselineMap();
    map.add(row("own"));
    map.add(row("fallback"));
    map.add(row("ff", "firefox"));
    expect(map.get("s", "desktop")?.id).toBe("own");
    expect(map.get("s", "desktop", "firefox")?.id).toBe("ff");
    expect(map.get("s", "mobile")).toBeNull();
  });
});
