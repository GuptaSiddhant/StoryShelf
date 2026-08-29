import { describe, expect, it } from "vitest";

import { DEFAULT_VIEWPORTS } from "./viewports.ts";

describe("DEFAULT_VIEWPORTS", () => {
  it("captures a single desktop viewport", () => {
    expect(DEFAULT_VIEWPORTS).toEqual([{ name: "desktop", width: 1280, height: 720 }]);
  });
});
