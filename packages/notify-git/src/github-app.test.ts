import { createPublicKey, createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInstallationTokens,
  installationToken,
  signAppJwt,
  TOKEN_REFRESH_MARGIN_MS,
} from "./github-app.ts";
import { stubFetch } from "./test-fetch.ts";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "./test-key.ts";

const privateKey = TEST_PRIVATE_KEY;
const publicKey = TEST_PUBLIC_KEY;
/** Fix what `Date.now()` answers. */
function setNow(at: string | number): void {
  vi.spyOn(Date, "now").mockReturnValue(typeof at === "number" ? at : Date.parse(at));
}

const creds = { appId: "123", installationId: "456", privateKey };

beforeEach(() => {
  clearInstallationTokens();
  setNow("2026-01-01T00:00:00Z");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("signAppJwt", () => {
  it("signs an RS256 JWT for the App that verifies with its public key", () => {
    const jwt = signAppJwt(creds, Date.parse("2026-01-01T00:00:00Z"));
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString()) as Record<
      string,
      number | string
    >;
    const iat = Date.parse("2026-01-01T00:00:00Z") / 1000;
    expect(payload).toEqual({ iat: iat - 60, exp: iat + 540, iss: "123" });
    const ok = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(createPublicKey(publicKey), Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });

  it("accepts a key pasted on one line with escaped newlines", () => {
    const oneLine = privateKey.trim().replaceAll("\n", "\\n");
    expect(() => signAppJwt({ ...creds, privateKey: oneLine }, Date.now())).not.toThrow();
  });
});

const respond = (expires: string) => () =>
  Response.json({ token: "ghs_installation", expires_at: expires }, { status: 201 });

describe("installationToken", () => {
  it("exchanges the JWT at the installation's access_tokens endpoint", async () => {
    const calls = stubFetch(respond("2026-01-01T01:00:00Z"));
    expect(await installationToken(creds)).toBe("ghs_installation");
    expect(calls[0]?.url).toBe("https://api.github.com/app/installations/456/access_tokens");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toHaveProperty("authorization");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toMatch(/^Bearer eyJ[\w-]+\.[\w-]+\.[\w-]+$/u);
  });

  it("caches the token until five minutes before it expires", async () => {
    const calls = stubFetch(respond("2026-01-01T01:00:00Z"));
    await installationToken(creds);
    setNow(Date.parse("2026-01-01T01:00:00Z") - TOKEN_REFRESH_MARGIN_MS - 1000);
    await installationToken(creds);
    expect(calls).toHaveLength(1);
    setNow(Date.parse("2026-01-01T01:00:00Z") - TOKEN_REFRESH_MARGIN_MS + 1000);
    await installationToken(creds);
    expect(calls).toHaveLength(2);
  });

  it("keeps one token per channel and shares a pending exchange", async () => {
    const calls = stubFetch(respond("2026-01-01T01:00:00Z"));
    await Promise.all([installationToken(creds), installationToken(creds)]);
    await installationToken({ ...creds, installationId: "789" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/app/installations/456/access_tokens",
      "https://api.github.com/app/installations/789/access_tokens",
    ]);
  });

  it("fails when GitHub answers without a token", async () => {
    stubFetch(() => Response.json({}, { status: 201 }));
    await expect(installationToken(creds)).rejects.toThrow("did not return an installation token");
  });
});
