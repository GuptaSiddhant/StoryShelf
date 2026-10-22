import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.ts";
import {
  DEFAULT_STORYBOOK_URL_TTL,
  MAX_STORYBOOK_URL_TTL,
  STORYBOOK_TOKEN_PREFIX,
  STORYBOOK_URL_TTL_GRACE,
  signStorybookToken,
  storybookTokenPath,
  storybookUrlTtl,
  verifyStorybookToken,
} from "./storybook-token.ts";

const NOW = Date.UTC(2026, 0, 1);
const base = { secret: "s3cret", projectId: "01PROJECT", buildId: "01BUILD", now: NOW };

describe("signStorybookToken / verifyStorybookToken", () => {
  it("round-trips the project, build and expiry", () => {
    const token = signStorybookToken(base);
    const result = verifyStorybookToken(token, "s3cret", NOW + 1000);
    expect(result).toEqual({
      ok: true,
      claims: {
        projectId: "01PROJECT",
        buildId: "01BUILD",
        expiresAt: NOW / 1000 + DEFAULT_STORYBOOK_URL_TTL,
      },
    });
  });

  it("is URL-safe", () => {
    expect(signStorybookToken(base)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
  });

  it("refuses a tampered payload (another build) and a tampered signature", () => {
    const [, sig = ""] = signStorybookToken(base).split(".");
    const other = signStorybookToken({ ...base, buildId: "01OTHER" }).split(".")[0];
    expect(verifyStorybookToken(`${other}.${sig}`, "s3cret", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
    const [payload = ""] = signStorybookToken(base).split(".");
    const flipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyStorybookToken(flipped, "s3cret", NOW).ok).toBe(false);
  });

  it("refuses a token signed with another secret", () => {
    expect(verifyStorybookToken(signStorybookToken(base), "other", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("accepts the previous secret during a rotation, and only then", () => {
    const token = signStorybookToken({ ...base, secret: "old" });
    expect(verifyStorybookToken(token, { current: "new", previous: "old" }, NOW).ok).toBe(true);
    expect(verifyStorybookToken(token, "new", NOW).ok).toBe(false);
  });

  it("expires at the boundary and never revives later", () => {
    const token = signStorybookToken({ ...base, ttlSeconds: 120 });
    expect(verifyStorybookToken(token, "s3cret", NOW + 119_000).ok).toBe(true);
    expect(verifyStorybookToken(token, "s3cret", NOW + 120_000)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyStorybookToken(token, "s3cret", NOW + 10 * 24 * 3600_000).ok).toBe(false);
  });

  it("refuses a token that claims more than the longest lifetime, even when signed", () => {
    const far = signStorybookToken({ ...base, ttlSeconds: MAX_STORYBOOK_URL_TTL });
    expect(verifyStorybookToken(far, "s3cret", NOW - 3600_000)).toEqual({
      ok: false,
      reason: "scope",
    });
  });

  it("refuses malformed input without throwing", () => {
    for (const bad of [
      undefined,
      42,
      "",
      "abc",
      "a.b",
      "x".repeat(900),
      "a.b.c",
      "..",
      "%00.%00",
    ]) {
      expect(verifyStorybookToken(bad, "s3cret", NOW)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("never verifies against an empty secret", () => {
    expect(verifyStorybookToken(signStorybookToken(base), "", NOW).ok).toBe(false);
  });

  it("separates its key from the raw secret (a raw HMAC of the payload does not verify)", async () => {
    const { createHmac } = await import("node:crypto");
    const [payload = ""] = signStorybookToken(base).split(".");
    const forged = `${payload}.${createHmac("sha256", "s3cret").update(payload).digest("base64url")}`;
    expect(verifyStorybookToken(forged, "s3cret", NOW).ok).toBe(false);
  });

  it("refuses to sign without a secret, with odd ids or an out-of-range lifetime", () => {
    expect(() => signStorybookToken({ ...base, secret: "" })).toThrow("secret");
    expect(() => signStorybookToken({ ...base, buildId: "a:b" })).toThrow("id");
    expect(() => signStorybookToken({ ...base, ttlSeconds: 5 })).toThrow("lifetime");
    expect(() => signStorybookToken({ ...base, ttlSeconds: 1e9 })).toThrow("lifetime");
    expect(() => signStorybookToken({ ...base, ttlSeconds: 90.5 })).toThrow("lifetime");
  });
});

describe("redaction", () => {
  it("scrubs a token in a path or URL", () => {
    const token = signStorybookToken(base);
    const text = `page.goto: failed at https://x.test${storybookTokenPath(token)}iframe.html?id=a`;
    expect(redactSecrets(text)).toBe(
      "page.goto: failed at https://x.test/_s/[redacted]/iframe.html?id=a",
    );
  });
});

describe("path prefix", () => {
  it("is /_s/, which the /_/ short link can never match", () => {
    expect(STORYBOOK_TOKEN_PREFIX).toBe("/_s/");
    expect(storybookTokenPath("tok")).toBe("/_s/tok/");
    expect("/_s/tok/iframe.html".startsWith("/_/")).toBe(false);
  });

  it("is what the redaction pattern follows, and nothing else", () => {
    const token = signStorybookToken(base);
    expect(redactSecrets(`/s/${token}/x`)).toContain(token);
    expect(redactSecrets(`${STORYBOOK_TOKEN_PREFIX}${token}/x`)).not.toContain(token);
  });
});

describe("storybookUrlTtl", () => {
  it("honours a project override exactly", () => {
    expect(storybookUrlTtl({ override: 600, budgetMs: 1e9 })).toBe(600);
  });

  it("derives from the budget with a floor, a grace and a ceiling", () => {
    const floor = DEFAULT_STORYBOOK_URL_TTL;
    expect(storybookUrlTtl({ budgetMs: 0 })).toBe(floor);
    expect(storybookUrlTtl({ override: null, budgetMs: 15 * 60_000 })).toBe(floor);
    expect(storybookUrlTtl({ budgetMs: 4 * 3600_000 })).toBe(4 * 3600 + STORYBOOK_URL_TTL_GRACE);
    expect(storybookUrlTtl({ budgetMs: 100 * 3600_000 })).toBe(MAX_STORYBOOK_URL_TTL);
  });
});
