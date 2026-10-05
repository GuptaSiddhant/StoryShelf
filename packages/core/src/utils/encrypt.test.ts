import { describe, expect, it } from "vitest";
import {
  decrypt,
  decryptCredential,
  decryptWithKey,
  encrypt,
  UndecryptableCredentialError,
} from "./encrypt.ts";

describe("secret rotation keys", () => {
  it("round-trips with a bare secret", () => {
    expect(decrypt("a", encrypt("a", "value"))).toBe("value");
  });

  it("encrypts with the current key of a pair", () => {
    const stored = encrypt({ current: "new", previous: "old" }, "value");
    expect(decryptWithKey("new", stored)).toEqual({ plaintext: "value", keyUsed: "current" });
    expect(() => decrypt("old", stored)).toThrow();
  });

  it("falls back to the previous key and reports it", () => {
    const stored = encrypt("old", "value");
    expect(decryptWithKey({ current: "new", previous: "old" }, stored)).toEqual({
      plaintext: "value",
      keyUsed: "previous",
    });
  });

  it("fails when neither key matches", () => {
    const stored = encrypt("other", "value");
    expect(() => decrypt({ current: "new", previous: "old" }, stored)).toThrow();
    expect(() => decrypt("new", stored)).toThrow();
  });

  it("requires a configured secret", () => {
    expect(() => decrypt(undefined, "a:b:c")).toThrow("not configured");
    expect(() => encrypt(undefined, "x")).toThrow("not configured");
  });

  it("maps a mismatch to UndecryptableCredentialError but keeps the config error", () => {
    const stored = encrypt("old", "value");
    expect(() => decryptCredential("new", stored)).toThrow(UndecryptableCredentialError);
    expect(() => decryptCredential(undefined, stored)).toThrow("not configured");
    expect(decryptCredential({ current: "new", previous: "old" }, stored)).toBe("value");
  });

  it("rejects malformed payloads", () => {
    expect(() => decrypt("a", "not-a-payload")).toThrow("Invalid encrypted payload format");
  });
});
