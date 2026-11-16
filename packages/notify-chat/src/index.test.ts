import { chatNotifiers as builtIn } from "@storyshelf/core/integrations";
import { describe, expect, it } from "vitest";
import { chatNotifiers } from "./index.ts";
import { slackWebhookNotifier } from "./slack.ts";

describe("notify-chat shim", () => {
  it("re-exports core's chat providers", () => {
    expect(chatNotifiers).toBe(builtIn);
    expect(slackWebhookNotifier.metadata.kind).toBe("slack-webhook");
  });
});
