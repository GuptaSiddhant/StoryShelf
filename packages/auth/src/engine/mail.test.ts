import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { EmailSender } from "@storyshelf/core/adapter/email-sender";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../invites.ts", () => ({
  issueInvite: vi.fn(),
  verifyInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

import { acceptInvite, issueInvite, verifyInvite } from "../invites.ts";
import { buildInviteMethods, sendAuthMail } from "./mail.ts";
import type { ShelfAuthOptions } from "./types.ts";

const db = {} as DatabaseAdapter;
const ISSUED = { inviteId: "inv1", token: "tok", expiresAt: "2026-12-01T00:00:00.000Z" };

function sender(): { send: ReturnType<typeof vi.fn> } & EmailSender {
  const send = vi.fn(async () => await Promise.resolve());
  return { send } as never;
}

function options(overrides: Partial<ShelfAuthOptions> = {}): ShelfAuthOptions {
  return { db, secret: "s".repeat(32), baseURL: "https://shelf.example.com/", ...overrides };
}

beforeEach(() => {
  vi.mocked(issueInvite)
    .mockReset()
    .mockResolvedValue(ISSUED as never);
  vi.mocked(verifyInvite).mockReset();
  vi.mocked(acceptInvite).mockReset();
});

describe("sendAuthMail", () => {
  const message = { to: "ada@example.com", subject: "Hi", text: "Body" };

  it("does nothing without a sender", async () => {
    await expect(
      sendAuthMail({ baseURL: "https://shelf.example.com" }, message),
    ).resolves.toBeUndefined();
  });

  it("sends from storyshelf@<host> by default", async () => {
    const mail = sender();
    await sendAuthMail({ emailSender: mail, baseURL: "https://shelf.example.com:8443/x" }, message);
    expect(mail.send).toHaveBeenCalledWith({ ...message, from: "storyshelf@shelf.example.com" });
  });

  it("uses the configured from address", async () => {
    const mail = sender();
    await sendAuthMail(
      { emailSender: mail, baseURL: "https://shelf.example.com", fromEmail: "ops@example.com" },
      message,
    );
    expect(mail.send).toHaveBeenCalledWith({ ...message, from: "ops@example.com" });
  });

  it("falls back to storyshelf@localhost when the base URL is not a URL", async () => {
    const mail = sender();
    await sendAuthMail({ emailSender: mail, baseURL: "not a url" }, message);
    expect(mail.send).toHaveBeenCalledWith({ ...message, from: "storyshelf@localhost" });
  });

  it("lets a send failure through, so callers choose the policy", async () => {
    const mail = sender();
    mail.send.mockRejectedValueOnce(new Error("smtp down"));
    await expect(
      sendAuthMail({ emailSender: mail, baseURL: "https://shelf.example.com" }, message),
    ).rejects.toThrow("smtp down");
  });
});

describe("buildInviteMethods", () => {
  it("issues the invite, fires the system hook and emails the accept link", async () => {
    const mail = sender();
    const hook = vi.fn();
    const methods = buildInviteMethods(db, options({ emailSender: mail, onAuthSystemEvent: hook }));
    const issued = await methods.issueInvite({ email: "ada@example.com" } as never);
    expect(issued).toBe(ISSUED);
    expect(hook).toHaveBeenCalledWith("sys:invite-issued", {
      email: "ada@example.com",
      inviteId: "inv1",
      expiresAt: ISSUED.expiresAt,
    });
    const sent = mail.send.mock.calls[0]?.[0] as { to: string; subject: string; text: string };
    expect(sent.to).toBe("ada@example.com");
    expect(sent.subject).toBe("Your StoryShelf invite");
    // One slash between the base URL and the path, whatever the configured trailing slashes.
    expect(sent.text).toContain("https://shelf.example.com/auth/invites/inv1?token=tok");
    expect(sent.text).toContain(`expires ${ISSUED.expiresAt}`);
  });

  it("sends no mail without a sender but still returns the token", async () => {
    const hook = vi.fn();
    const methods = buildInviteMethods(db, options({ onAuthSystemEvent: hook }));
    await expect(methods.issueInvite({ email: "a@b.c" } as never)).resolves.toBe(ISSUED);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows a failing hook and a failing send, keeping the token usable", async () => {
    const mail = sender();
    mail.send.mockRejectedValueOnce(new Error("bounce"));
    const logger = { warn: vi.fn() };
    const methods = buildInviteMethods(
      db,
      options({
        emailSender: mail,
        logger: logger as never,
        onAuthSystemEvent: () => {
          throw new Error("hook broke");
        },
      }),
    );
    await expect(methods.issueInvite({ email: "a@b.c" } as never)).resolves.toBe(ISSUED);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "auth system hook failed");
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "invite email failed");
  });

  it("verifies through the invite store unchanged", async () => {
    vi.mocked(verifyInvite).mockResolvedValue({ email: "a@b.c", name: "A" } as never);
    const methods = buildInviteMethods(db, options());
    await expect(methods.verifyInvite({ inviteId: "i", token: "t" })).resolves.toEqual({
      email: "a@b.c",
      name: "A",
    });
  });

  it("emits sys:user-created on accept (it bypasses the mirror hook) and tags the engine provider", async () => {
    vi.mocked(acceptInvite).mockResolvedValue({ id: "u1", email: "a@b.c", name: "A" } as never);
    const hook = vi.fn();
    const methods = buildInviteMethods(db, options({ onAuthSystemEvent: hook }));
    const user = await methods.acceptInvite({ inviteId: "i", token: "t", password: "pw" });
    expect(user).toMatchObject({ id: "u1", providerId: "better-auth" });
    expect(hook).toHaveBeenCalledWith("sys:user-created", {
      userId: "u1",
      email: "a@b.c",
      name: "A",
    });
  });

  it("still accepts when the user-created hook throws", async () => {
    vi.mocked(acceptInvite).mockResolvedValue({ id: "u1", email: "a@b.c", name: "A" } as never);
    const logger = { warn: vi.fn() };
    const methods = buildInviteMethods(
      db,
      options({
        logger: logger as never,
        onAuthSystemEvent: () => {
          throw new Error("hook broke");
        },
      }),
    );
    await expect(
      methods.acceptInvite({ inviteId: "i", token: "t", password: "pw" }),
    ).resolves.toMatchObject({ id: "u1" });
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "auth system hook failed");
  });
});
