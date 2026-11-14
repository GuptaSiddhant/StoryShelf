import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "./base64url.ts";
import { pushChannelConfigSchema } from "./types.ts";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const good = {
  endpoint: "https://push.example.net/p/abc",
  p256dh: toBase64Url(ecdh.getPublicKey()),
  auth: toBase64Url(Buffer.alloc(16, 7)),
};

describe("pushChannelConfigSchema", () => {
  it("accepts a browser's subscription", () => {
    expect(pushChannelConfigSchema.safeParse(good).success).toBe(true);
  });

  it.each([
    ["an http endpoint", { endpoint: "http://push.example.net/p" }],
    [
      "an endpoint over 512 characters",
      { endpoint: `https://push.example.net/${"a".repeat(500)}` },
    ],
    ["a key that is not 65 bytes", { p256dh: toBase64Url(Buffer.alloc(33, 4)) }],
    ["a key not starting 0x04", { p256dh: toBase64Url(Buffer.alloc(65, 3)) }],
    ["an auth secret that is not 16 bytes", { auth: toBase64Url(Buffer.alloc(8)) }],
    ["a key with characters outside base64url", { p256dh: `${good.p256dh.slice(1)}+` }],
  ])("refuses %s", (_name, patch) => {
    expect(pushChannelConfigSchema.safeParse({ ...good, ...patch }).success).toBe(false);
  });

  it("accepts an endpoint of exactly 512 characters", () => {
    const endpoint = `https://push.example.net/${"a".repeat(512 - 25)}`;
    expect(endpoint).toHaveLength(512);
    expect(pushChannelConfigSchema.safeParse({ ...good, endpoint }).success).toBe(true);
  });
});
