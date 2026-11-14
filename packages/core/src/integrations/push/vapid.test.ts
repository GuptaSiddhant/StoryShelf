import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "./base64url.ts";
import { createVapid, verifyVapidJwt } from "./vapid.ts";

function keyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: toBase64Url(ecdh.getPublicKey()),
    privateKey: toBase64Url(ecdh.getPrivateKey()),
  };
}

const subject = "mailto:ops@example.com";

describe("createVapid", () => {
  it("accepts a matching pair and signs for an endpoint's origin", () => {
    const pair = keyPair();
    const vapid = createVapid({ ...pair, subject });
    const header = vapid.authorization("https://push.example.net/p/abc");
    const jwt = /t=([^,]+),/u.exec(header)?.[1] ?? "";
    expect(verifyVapidJwt(jwt, pair.publicKey)).toBe(true);
    expect(header.endsWith(`k=${pair.publicKey}`)).toBe(true);
  });

  it("refuses a private key that belongs to another public key", () => {
    const other = keyPair();
    expect(() => createVapid({ ...keyPair(), privateKey: other.privateKey, subject })).toThrow(
      "not a usable pair",
    );
  });

  it("refuses garbage keys without echoing them", () => {
    const pair = keyPair();
    let message = "";
    try {
      createVapid({ publicKey: pair.publicKey, privateKey: "not-a-key!!", subject });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("not a usable pair");
    expect(message).not.toContain("not-a-key");
  });

  it("refuses a subject that is not a mailto: or https: URL", () => {
    expect(() => createVapid({ ...keyPair(), subject: "admin" })).toThrow("SHELF_VAPID_SUBJECT");
  });

  it("holds no enumerable copy of the private key", () => {
    const pair = keyPair();
    const vapid = createVapid({ ...pair, subject });
    expect(JSON.stringify(vapid)).not.toContain(pair.privateKey);
    expect(Object.values(vapid).join()).not.toContain(pair.privateKey);
  });

  it("caches a token per origin for a few hours, then signs again", () => {
    const vapid = createVapid({ ...keyPair(), subject });
    const t0 = 1_700_000_000_000;
    const first = vapid.authorization("https://push.example.net/a", t0);
    expect(vapid.authorization("https://push.example.net/b", t0 + 60_000)).toBe(first);
    expect(vapid.authorization("https://other.example.org/a", t0)).not.toBe(first);
    expect(vapid.authorization("https://push.example.net/a", t0 + 4 * 3_600_000)).not.toBe(first);
  });
});
