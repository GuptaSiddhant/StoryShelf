import { describe, expect, it } from "vitest";
import * as shim from "./index.ts";

describe("deprecated re-export of core", () => {
  it("still exposes the email presets and notifier", () => {
    expect(Object.keys(shim).toSorted()).toEqual([
      "createEmailNotifier",
      "emailChannelConfigSchema",
      "httpPreset",
      "logPreset",
      "mailpitPreset",
      "smtpPreset",
      "smtpPresetFromEnv",
    ]);
  });
});
