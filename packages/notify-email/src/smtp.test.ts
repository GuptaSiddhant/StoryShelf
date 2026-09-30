import { describe, expect, it } from "vitest";
import { smtpPresetFromEnv } from "./smtp.ts";

describe("smtpPresetFromEnv", () => {
  it("returns undefined unless host and from are set", () => {
    expect(smtpPresetFromEnv({})).toBeUndefined();
    expect(smtpPresetFromEnv({ SMTP_HOST: "mail.example.com" })).toBeUndefined();
  });

  it("builds an SMTP sender from the environment", () => {
    const sender = smtpPresetFromEnv({
      SMTP_HOST: "mail.example.com",
      SMTP_FROM: "shelf@example.com",
    });
    expect(sender?.metadata.kind).toBe("email-smtp");
  });
});
