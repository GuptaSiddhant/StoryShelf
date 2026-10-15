import { describe, expect, it } from "vitest";
import { safeReturnPath, signState, verifyState } from "./oauth-state.ts";

const SECRET = "state-secret-0000";
const FIELDS = { userId: "u1", service: "figma", returnTo: "/projects/app" };

describe("oauth state", () => {
  it("round-trips a signed state and issues a fresh nonce each time", () => {
    const first = signState(SECRET, FIELDS);
    const second = signState(SECRET, FIELDS);
    expect(first.nonce).not.toBe(second.nonce);
    expect(verifyState(SECRET, first.state)).toMatchObject({ ...FIELDS, nonce: first.nonce });
  });

  it("rejects tampered, foreign-secret, malformed and expired states", () => {
    const { state } = signState(SECRET, FIELDS, 1_000);
    const [payload = "", signature = ""] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...FIELDS, userId: "u2", nonce: "n", expiresAt: 9e15 }),
    ).toString("base64url");
    expect(verifyState(SECRET, `${forged}.${signature}`)).toBeNull();
    expect(verifyState("other-secret-0000", state, 2_000)).toBeNull();
    expect(verifyState(SECRET, payload)).toBeNull();
    expect(verifyState(SECRET, "")).toBeNull();
    expect(verifyState(SECRET, "not.base64")).toBeNull();
    expect(verifyState(SECRET, state, 1_000 + 11 * 60_000)).toBeNull();
    expect(verifyState(SECRET, state, 2_000)).not.toBeNull();
  });
});

describe("safeReturnPath", () => {
  it("only accepts same-site absolute paths", () => {
    expect(safeReturnPath("/projects/a?x=1", "/")).toBe("/projects/a?x=1");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "evil", "", undefined]) {
      expect(safeReturnPath(bad, "/home")).toBe("/home");
    }
  });
});
