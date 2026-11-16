import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.ts";
import {
  signStorybookToken,
  storybookExchangePath,
  STORYBOOK_COOKIE_TTL,
  STORYBOOK_EXCHANGE_PREFIX,
  STORYBOOK_EXCHANGE_TTL,
  STORYBOOK_GRANT_COOKIE,
  verifyStorybookToken,
  type StorybookTokenPurpose,
} from "./storybook-token.ts";

const secret = "purpose-secret-purpose-secret-123456";
const sign = (purpose: StorybookTokenPurpose, extra: { now?: number; ttlSeconds?: number } = {}) =>
  signStorybookToken({ secret, projectId: "p1", buildId: "b1", purpose, ...extra });

describe("exchange and cookie tokens", () => {
  it("names the exchange path and the cookie", () => {
    expect(STORYBOOK_EXCHANGE_PREFIX).toBe("/_x/");
    expect(storybookExchangePath("t")).toBe("/_x/t/");
    expect(STORYBOOK_GRANT_COOKIE).toBe("__Host-storyshelf-grant");
  });

  it.each([
    ["exchange", STORYBOOK_EXCHANGE_TTL],
    ["cookie", STORYBOOK_COOKIE_TTL],
  ] as const)(
    "signs a %s token that lasts exactly its lifetime and verifies for its purpose",
    (purpose, ttl) => {
      const now = Date.now();
      const result = verifyStorybookToken(sign(purpose, { now }), secret, purpose, now);
      expect(result).toMatchObject({ ok: true, claims: { buildId: "b1", purpose } });
      expect(result.ok && result.claims.expiresAt).toBe(Math.floor(now / 1000) + ttl);
      expect(
        verifyStorybookToken(sign(purpose, { now }), secret, purpose, now + (ttl + 1) * 1000),
      ).toEqual({
        ok: false,
        reason: "expired",
      });
    },
  );

  it("refuses a lifetime longer than the purpose's", () => {
    expect(() => sign("exchange", { ttlSeconds: 61 })).toThrow(/at most 60/u);
    expect(() => sign("cookie", { ttlSeconds: 3601 })).toThrow(/at most 3600/u);
  });

  it("never verifies for another purpose, whichever way round", () => {
    const purposes: StorybookTokenPurpose[] = ["capture", "read", "exchange", "cookie"];
    for (const minted of purposes) {
      for (const expected of purposes) {
        const result = verifyStorybookToken(sign(minted), secret, expected);
        expect(result.ok, `${minted} as ${expected}`).toBe(minted === expected);
      }
    }
  });

  it("verifies with the current secret only, so a rotation ends them", () => {
    const rotated = { current: "new-secret-new-secret-new-secret-12", previous: secret };
    for (const purpose of ["exchange", "cookie"] as const) {
      expect(verifyStorybookToken(sign(purpose), rotated, purpose)).toEqual({
        ok: false,
        reason: "signature",
      });
    }
    expect(verifyStorybookToken(sign("capture"), rotated, "capture").ok).toBe(true);
  });

  it("redacts an exchange token from logged text", () => {
    const token = sign("exchange");
    expect(redactSecrets(`GET /_x/${token}/iframe.html`)).toBe("GET /_x/[redacted]/iframe.html");
  });
});
