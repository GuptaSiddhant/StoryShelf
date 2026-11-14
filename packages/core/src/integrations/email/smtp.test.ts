import { describe, expect, it, vi } from "vitest";
import { smtpPresetFromEnv } from "./smtp.ts";

describe("smtpPresetFromEnv", () => {
  it("returns undefined unless host and from are set", async () => {
    expect(await smtpPresetFromEnv({})).toBeUndefined();
    expect(await smtpPresetFromEnv({ SMTP_HOST: "mail.example.com" })).toBeUndefined();
  });

  it("builds an SMTP sender from the environment", async () => {
    const sender = await smtpPresetFromEnv({
      SMTP_HOST: "mail.example.com",
      SMTP_FROM: "shelf@example.com",
    });
    expect(sender?.metadata.kind).toBe("email-smtp");
  });
});

describe("smtpPreset without the nodemailer peer", () => {
  it("throws an install hint", async () => {
    vi.resetModules();
    vi.doMock("nodemailer", () => {
      throw new Error("Cannot find package 'nodemailer'");
    });
    const { smtpPreset } = await import("./smtp.ts");
    await expect(smtpPreset({ host: "h", port: 25, from: "a@b.c" })).rejects.toThrow(
      "SMTP needs the nodemailer package: install nodemailer@^10.2.1",
    );
    vi.doUnmock("nodemailer");
  });
});
