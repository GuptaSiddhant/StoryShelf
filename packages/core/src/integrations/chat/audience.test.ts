import { describe, expect, it } from "vitest";
import { chatNotifiers } from "./index.ts";

describe("chat notifier audience", () => {
  it("declares every chat kind a room, so a personal subscription never names one", () => {
    const kinds = new Set(chatNotifiers.map((provider) => provider.metadata.kind));
    expect(kinds).toEqual(new Set(["log", "slack-webhook", "teams-workflow"]));
    expect(chatNotifiers.every((provider) => provider.metadata.audience === "room")).toBe(true);
  });
});
