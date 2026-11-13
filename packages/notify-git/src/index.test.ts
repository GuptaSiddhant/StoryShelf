import { gitNotifiers as builtIn } from "@storyshelf/core/integrations";
import { describe, expect, it } from "vitest";
import { gitNotifiers } from "./index.ts";

describe("@storyshelf/notify-git shim", () => {
  it("re-exports core's git providers", () => {
    expect(gitNotifiers).toBe(builtIn);
  });
});
