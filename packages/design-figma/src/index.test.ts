import * as core from "@storyshelf/core/integrations";
import { describe, expect, it } from "vitest";
import * as shim from "./index.ts";

describe("@storyshelf/design-figma shim", () => {
  it("re-exports the core integration", () => {
    expect(shim.createFigmaDesign).toBe(core.createFigmaDesign);
    expect(shim.figmaOAuthFromEnv).toBe(core.figmaOAuthFromEnv);
    expect(shim.parseFigmaUrl).toBe(core.parseFigmaUrl);
  });
});
