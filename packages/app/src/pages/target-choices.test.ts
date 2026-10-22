import type { RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { describe, expect, it } from "vitest";
import { targetChoices } from "./target-choices.ts";

const offered: RunnerTarget[] = [
  { target: "chromium", reach: "loopback", status: "ready" },
  { target: "firefox", reach: "loopback", status: { unavailable: "declared, not installed" } },
  { target: "chromium@grid", reach: "url", status: "ready" },
];

describe("targetChoices", () => {
  it("offers every engine when the runner publishes no list", () => {
    const { choices, unavailable } = targetChoices(undefined, ["chromium"]);
    expect(choices.map((choice) => choice.value)).toEqual([
      "chromium",
      "firefox",
      "webkit",
      "chrome",
    ]);
    expect(unavailable).toEqual([]);
  });

  it("offers ready targets and reports the unavailable ones with their reason", () => {
    const { choices, unavailable } = targetChoices(offered, ["chromium"]);
    expect(choices).toEqual([
      { value: "chromium", label: "Chromium" },
      { value: "chromium@grid", label: "Chromium on grid" },
    ]);
    expect(unavailable).toEqual(["firefox: declared, not installed"]);
  });

  it("keeps a current target the runner no longer offers, marked", () => {
    const { choices } = targetChoices(offered, ["webkit@old", "firefox"]);
    expect(choices.map((choice) => choice.label)).toContain("WebKit on old (not available)");
    expect(choices.map((choice) => choice.label)).toContain("Firefox (not available)");
  });
});
