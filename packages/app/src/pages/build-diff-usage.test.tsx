import { describe, expect, it } from "vitest";
import { upstreamPreviewUrl, type LinkedUsageItem } from "./build-diff-usage.tsx";

const item: LinkedUsageItem = {
  package: "@acme/ds",
  version: "2.4.0",
  upstreamSlug: "design-system",
  upstreamBuildId: "BUILD1",
  upstreamStoryId: "button--primary",
};

describe("upstreamPreviewUrl", () => {
  it("deep links to the matched story of the upstream build", () => {
    expect(upstreamPreviewUrl(item)).toBe(
      "/projects/design-system/storybook/build/BUILD1?storyId=button--primary",
    );
  });

  it("falls back to the upstream Storybook root without a story match", () => {
    expect(upstreamPreviewUrl({ ...item, upstreamStoryId: null })).toBe(
      "/projects/design-system/storybook/build/BUILD1",
    );
  });

  it("uses the published domain when configured", () => {
    expect(upstreamPreviewUrl(item, "shelf.example.com")).toBe(
      "https://BUILD1.design-system.shelf.example.com?storyId=button--primary",
    );
  });

  it("has no preview when the upstream has no approved build", () => {
    expect(upstreamPreviewUrl({ ...item, upstreamBuildId: null })).toBeNull();
  });
});
