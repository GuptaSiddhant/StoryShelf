import { afterEach, describe, expect, it, vi } from "vitest";
import { sesPreset, sesPresetFromEnv, sesSmtpHost } from "./ses.ts";

afterEach(() => {
  vi.doUnmock("nodemailer");
  vi.resetModules();
});

describe("sesSmtpHost", () => {
  it("names the regional SES SMTP endpoint", () => {
    expect(sesSmtpHost("eu-west-1")).toBe("email-smtp.eu-west-1.amazonaws.com");
    expect(sesSmtpHost("us-gov-east-1")).toBe("email-smtp.us-gov-east-1.amazonaws.com");
  });

  it("rejects anything that is not a region id", () => {
    for (const bad of ["", "evil.com/x", "eu-west-1.evil.com", "EU-WEST-1", "localhost"]) {
      expect(() => sesSmtpHost(bad)).toThrow("not an AWS region id");
    }
  });
});

describe("sesPreset", () => {
  it("builds an SMTP transport for the region on 587 with STARTTLS", async () => {
    const createTransport = vi.fn(() => ({ sendMail: vi.fn() }));
    vi.doMock("nodemailer", () => ({ createTransport }));
    const { sesPreset: preset } = await import("./ses.ts");
    const sender = await preset({ region: "eu-west-1", user: "u", pass: "p", from: "a@b.c" });
    expect(sender.metadata.kind).toBe("email-smtp");
    expect(createTransport).toHaveBeenCalledWith({
      host: "email-smtp.eu-west-1.amazonaws.com",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });
  });

  it("rejects a bad region before loading nodemailer", async () => {
    await expect(
      sesPreset({ region: "nope", user: "u", pass: "p", from: "a@b.c" }),
    ).rejects.toThrow("not an AWS region id");
  });

  it("never puts the credentials in an error", async () => {
    const failure = sesPreset({
      region: "bad region",
      user: "AKIDSECRETUSER",
      pass: "s3cr3tpass",
      from: "a@b.c",
    });
    await expect(failure).rejects.toThrow(/^(?!.*(s3cr3tpass|AKIDSECRETUSER))/u);
  });
});

describe("sesPresetFromEnv", () => {
  const full = {
    SES_REGION: "us-east-1",
    SES_SMTP_USER: "u",
    SES_SMTP_PASS: "p",
    SES_FROM: "a@b.c",
  };

  it("returns undefined unless region, credentials and from are all set", async () => {
    expect(await sesPresetFromEnv({})).toBeUndefined();
    const results = await Promise.all(
      Object.keys(full).map((key) => sesPresetFromEnv({ ...full, [key]: undefined })),
    );
    expect(results.every((result) => result === undefined)).toBe(true);
  });

  it("builds a sender from the environment", async () => {
    expect((await sesPresetFromEnv(full))?.metadata.kind).toBe("email-smtp");
  });

  it("falls back to AWS_REGION", async () => {
    const { SES_REGION: _unused, ...rest } = full;
    expect(await sesPresetFromEnv({ ...rest, AWS_REGION: "eu-west-1" })).toBeDefined();
  });
});
