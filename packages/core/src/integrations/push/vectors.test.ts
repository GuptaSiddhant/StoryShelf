import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./base64url.ts";
import { encryptPayload, MAX_PLAINTEXT_BYTES } from "./encrypt.ts";
import { signVapidJwt, verifyVapidJwt } from "./vapid.ts";

// RFC 8291, appendix A.
const AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const UA_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const SALT = "DGv6ra1nlYgDCS1FRnbzlw";
const EXPECTED =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

describe("RFC 8291 aes128gcm", () => {
  it("matches the appendix A vector", () => {
    const body = encryptPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      UA_PUBLIC,
      AUTH,
      { salt: fromBase64Url(SALT), senderPrivateKey: AS_PRIVATE },
    );
    expect(toBase64Url(body)).toBe(EXPECTED);
  });

  it("uses a fresh salt and key per message", () => {
    const a = encryptPayload(Buffer.from("x"), UA_PUBLIC, AUTH);
    const b = encryptPayload(Buffer.from("x"), UA_PUBLIC, AUTH);
    expect(a.equals(b)).toBe(false);
  });

  it("refuses a payload that does not fit one record", () => {
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT_BYTES + 1), UA_PUBLIC, AUTH)).toThrow(
      /exceeds/u,
    );
  });
});

// RFC 8292, section 4.2 (Figure 1): the example token and the key that signed it.
const RFC_PUBLIC =
  "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const RFC_JWT =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA";

describe("RFC 8292 VAPID", () => {
  it("verifies the RFC example token", () => {
    expect(verifyVapidJwt(RFC_JWT, RFC_PUBLIC)).toBe(true);
  });

  it("rejects a tampered token", () => {
    expect(verifyVapidJwt(`${RFC_JWT.slice(0, -2)}AA`, RFC_PUBLIC)).toBe(false);
  });

  it("signs a token its public key verifies, with the right claims", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const vapid = {
      publicKey: toBase64Url(ecdh.getPublicKey()),
      privateKey: toBase64Url(ecdh.getPrivateKey()),
      subject: "mailto:push@example.com",
    };
    const jwt = signVapidJwt(vapid, "https://push.example.net", 1_000_000);
    expect(verifyVapidJwt(jwt, vapid.publicKey)).toBe(true);
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as {
      aud: string;
      exp: number;
      sub: string;
    };
    expect(claims).toEqual({
      aud: "https://push.example.net",
      exp: 1000 + 43_200,
      sub: "mailto:push@example.com",
    });
  });
});
