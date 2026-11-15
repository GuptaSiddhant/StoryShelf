import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { smtpPreset, smtpPresetFromEnv } from "./smtp.ts";

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
    const { smtpPreset: freshPreset } = await import("./smtp.ts");
    await expect(freshPreset({ host: "h", port: 25, from: "a@b.c" })).rejects.toThrow(
      "SMTP needs the nodemailer package: install nodemailer@^10.2.1",
    );
    vi.doUnmock("nodemailer");
  });
});

describe("smtpPreset requireTLS", () => {
  it("refuses to authenticate when the server offers no STARTTLS", async () => {
    const commands: string[] = [];
    const server = createServer((socket) => {
      socket.write("220 plain.test ESMTP\r\n");
      socket.on("data", (chunk) => {
        const line = chunk.toString("utf8").trim();
        commands.push(line);
        socket.write(
          line.startsWith("EHLO") ? "250-plain.test\r\n250 AUTH PLAIN LOGIN\r\n" : "250 ok\r\n",
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const sender = await smtpPreset({
      host: "127.0.0.1",
      port,
      requireTLS: true,
      user: "user",
      pass: "secret-pass",
      from: "a@b.c",
    });
    await expect(sender.send({ to: "x@y.z", subject: "s", text: "t" })).rejects.toThrow();
    server.close();
    expect(commands.some((command) => command.startsWith("AUTH"))).toBe(false);
    expect(commands.join("\n")).not.toContain("secret-pass");
  });
});
