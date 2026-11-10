import { describe, expect, it } from "vite-plus/test";
import { chatNotifiers } from "./index.ts";

describe("chat notifier audience", () => {
  it("declares every chat kind a room, so a personal subscription never names one", () => {
    expect(chatNotifiers.map((provider) => provider.metadata.kind).toSorted()).toEqual([
      "log",
      "slack-webhook",
      "teams-workflow",
    ]);
    expect(chatNotifiers.every((provider) => provider.metadata.audience === "room")).toBe(true);
  });
});
