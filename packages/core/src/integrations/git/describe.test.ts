import { describe, expect, it } from "vitest";
import { commentMarker, describeState } from "./describe.ts";

describe("describeState", () => {
  it("describes the three build states", () => {
    expect(describeState("pending")).toBe("Visual tests pending");
    expect(describeState("success")).toBe("Visual tests passed");
    expect(describeState("failure")).toBe("Visual changes detected or tests failed");
    expect(describeState("cancelled")).toBe("Cancelled");
  });
});

describe("commentMarker", () => {
  it("keys the comment by the build url", () => {
    expect(commentMarker("https://x/builds/1")).toBe("<!-- storyshelf:https://x/builds/1 -->");
  });
});
