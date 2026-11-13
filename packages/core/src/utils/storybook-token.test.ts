import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.ts";
import {
  DEFAULT_STORYBOOK_URL_TTL,
  MAX_STORYBOOK_URL_TTL,
  MIN_CAPTURES_PER_SLICE,
  MIN_STORYBOOK_URL_TTL_OVERRIDE,
  PER_CAPTURE_BUDGET_MS,
  STORYBOOK_READ_PREFIX,
  STORYBOOK_READ_TTL,
  STORYBOOK_TOKEN_PREFIX,
  STORYBOOK_URL_TTL_GRACE,
  signStorybookToken,
  storybookReadPath,
  storybookTokenPath,
  storybookUrlTtl,
  storybookUrlTtlOverrideError,
  verifyStorybookToken,
} from "./storybook-token.ts";

const NOW = Date.UTC(2026, 0, 1);
const base = {
  secret: "s3cret",
  projectId: "01PROJECT",
  buildId: "01BUILD",
  now: NOW,
  purpose: "capture",
} as const;

describe("signStorybookToken / verifyStorybookToken", () => {
  it("round-trips the project, build and expiry", () => {
    const token = signStorybookToken(base);
    const result = verifyStorybookToken(token, "s3cret", "capture", NOW + 1000);
    expect(result).toEqual({
      ok: true,
      claims: {
        projectId: "01PROJECT",
        buildId: "01BUILD",
        expiresAt: NOW / 1000 + DEFAULT_STORYBOOK_URL_TTL,
        purpose: "capture",
      },
    });
  });

  it("is URL-safe", () => {
    expect(signStorybookToken(base)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
  });

  it("refuses a tampered payload (another build) and a tampered signature", () => {
    const [, sig = ""] = signStorybookToken(base).split(".");
    const other = signStorybookToken({ ...base, buildId: "01OTHER" }).split(".")[0];
    expect(verifyStorybookToken(`${other}.${sig}`, "s3cret", "capture", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
    const [payload = ""] = signStorybookToken(base).split(".");
    const flipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyStorybookToken(flipped, "s3cret", "capture", NOW).ok).toBe(false);
  });

  it("refuses a token signed with another secret", () => {
    expect(verifyStorybookToken(signStorybookToken(base), "other", "capture", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("accepts the previous secret during a rotation, and only then", () => {
    const token = signStorybookToken({ ...base, secret: "old" });
    expect(
      verifyStorybookToken(token, { current: "new", previous: "old" }, "capture", NOW).ok,
    ).toBe(true);
    expect(verifyStorybookToken(token, "new", "capture", NOW).ok).toBe(false);
  });

  it("expires at the boundary and never revives later", () => {
    const token = signStorybookToken({ ...base, ttlSeconds: 120 });
    expect(verifyStorybookToken(token, "s3cret", "capture", NOW + 119_000).ok).toBe(true);
    expect(verifyStorybookToken(token, "s3cret", "capture", NOW + 120_000)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyStorybookToken(token, "s3cret", "capture", NOW + 10 * 24 * 3600_000).ok).toBe(
      false,
    );
  });

  it("refuses a token that claims more than the longest lifetime, even when signed", () => {
    const far = signStorybookToken({ ...base, ttlSeconds: MAX_STORYBOOK_URL_TTL });
    expect(verifyStorybookToken(far, "s3cret", "capture", NOW - 3600_000)).toEqual({
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
      expect(verifyStorybookToken(bad, "s3cret", "capture", NOW)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("never verifies against an empty secret", () => {
    expect(verifyStorybookToken(signStorybookToken(base), "", "capture", NOW).ok).toBe(false);
  });

  it("separates its key from the raw secret (a raw HMAC of the payload does not verify)", () => {
    const [payload = ""] = signStorybookToken(base).split(".");
    const forged = `${payload}.${createHmac("sha256", "s3cret").update(payload).digest("base64url")}`;
    expect(verifyStorybookToken(forged, "s3cret", "capture", NOW).ok).toBe(false);
  });

  it("refuses to sign without a secret, with odd ids or an out-of-range lifetime", () => {
    expect(() => signStorybookToken({ ...base, secret: "" })).toThrow("secret");
    expect(() => signStorybookToken({ ...base, buildId: "a:b" })).toThrow("id");
    expect(() => signStorybookToken({ ...base, ttlSeconds: 5 })).toThrow("lifetime");
    expect(() => signStorybookToken({ ...base, ttlSeconds: 1e9 })).toThrow("lifetime");
    expect(() => signStorybookToken({ ...base, ttlSeconds: 90.5 })).toThrow("lifetime");
  });
});

describe("purposes", () => {
  const read = { ...base, purpose: "read" } as const;

  it("round-trips each purpose, and signs it into the payload", () => {
    for (const purpose of ["capture", "read"] as const) {
      const token = signStorybookToken({ ...base, purpose });
      const payload = Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8");
      expect(payload.split(":")).toHaveLength(4);
      expect(verifyStorybookToken(token, "s3cret", purpose, NOW + 1000)).toMatchObject({
        ok: true,
        claims: { purpose },
      });
    }
  });

  it("refuses a read grant for capture and a capture token for read, on the signature", () => {
    const capture = signStorybookToken(base);
    const grant = signStorybookToken(read);
    expect(verifyStorybookToken(grant, "s3cret", "capture", NOW + 1000)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyStorybookToken(capture, "s3cret", "read", NOW + 1000)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("refuses a token with no purpose, as the legacy preview tokens were", () => {
    const expiresAt = Math.floor(NOW / 1000) + 600;
    const payload = Buffer.from(`01PROJECT:01BUILD:${String(expiresAt)}`).toString("base64url");
    const key = createHmac("sha256", "s3cret").update("storyshelf/storybook-url/v1").digest();
    const legacy = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
    expect(verifyStorybookToken(legacy, "s3cret", "capture", NOW + 1000)).toEqual({
      ok: false,
      reason: "scope",
    });
    expect(verifyStorybookToken(legacy, "s3cret", "read", NOW + 1000).ok).toBe(false);
  });

  it("cannot change purpose by editing the payload: the purpose is signed", () => {
    const [grantPayload = ""] = signStorybookToken(read).split(".");
    const [, captureSig = ""] = signStorybookToken(base).split(".");
    expect(verifyStorybookToken(`${grantPayload}.${captureSig}`, "s3cret", "read", NOW).ok).toBe(
      false,
    );
    expect(verifyStorybookToken(`${grantPayload}.${captureSig}`, "s3cret", "capture", NOW).ok).toBe(
      false,
    );
  });

  it("refuses a signed token whose purpose is not a known one", () => {
    const expiresAt = Math.floor(NOW / 1000) + 600;
    const claims = `01PROJECT:01BUILD:${String(expiresAt)}:admin`;
    const payload = Buffer.from(claims).toString("base64url");
    expect(verifyStorybookToken(`${payload}.${"A".repeat(43)}`, "s3cret", "read", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("keeps a token within the token shape for ULID ids", () => {
    const token = signStorybookToken({
      ...base,
      projectId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
      buildId: "01JABCDEFGHJKMNPQRSTVWXYZ1",
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{8,200}\.[A-Za-z0-9_-]{43}$/u);
    expect(verifyStorybookToken(token, "s3cret", "capture", NOW + 1000).ok).toBe(true);
  });
});

describe("read grants", () => {
  const read = { ...base, purpose: "read" } as const;

  it("last one hour by default and never longer, to mint or to accept", () => {
    const grant = signStorybookToken(read);
    expect(verifyStorybookToken(grant, "s3cret", "read", NOW + 1000)).toMatchObject({
      ok: true,
      claims: { expiresAt: NOW / 1000 + STORYBOOK_READ_TTL },
    });
    expect(verifyStorybookToken(grant, "s3cret", "read", NOW + STORYBOOK_READ_TTL * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(() => signStorybookToken({ ...read, ttlSeconds: STORYBOOK_READ_TTL + 1 })).toThrow(
      "at most",
    );
  });

  it("refuses a read grant that claims more than an hour even when it was signed", () => {
    const expiresAt = Math.floor(NOW / 1000) + STORYBOOK_READ_TTL + 600;
    const payload = Buffer.from(`01PROJECT:01BUILD:${String(expiresAt)}:read`).toString(
      "base64url",
    );
    const key = createHmac("sha256", "s3cret").update("storyshelf/storybook-read/v1").digest();
    const token = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
    expect(verifyStorybookToken(token, "s3cret", "read", NOW)).toEqual({
      ok: false,
      reason: "scope",
    });
  });

  it("verify with the current secret only: a rotation ends every grant, a capture token survives it", () => {
    const grant = signStorybookToken({ ...read, secret: "old" });
    const capture = signStorybookToken({ ...base, secret: "old" });
    const rotated = { current: "new", previous: "old" };
    expect(verifyStorybookToken(grant, rotated, "read", NOW).ok).toBe(false);
    expect(verifyStorybookToken(grant, "old", "read", NOW).ok).toBe(true);
    expect(verifyStorybookToken(capture, rotated, "capture", NOW).ok).toBe(true);
  });

  it("has its own prefix, which redaction scrubs like the capture one", () => {
    const token = signStorybookToken(read);
    expect(STORYBOOK_READ_PREFIX).toBe("/_r/");
    expect(storybookReadPath("tok")).toBe("/_r/tok/");
    expect(redactSecrets(`GET ${storybookReadPath(token)}iframe.html?id=a`)).toBe(
      "GET /_r/[redacted]/iframe.html?id=a",
    );
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

describe("storybookUrlTtlOverrideError", () => {
  it("floors an override at one minimum slice plus the grace", () => {
    expect(MIN_STORYBOOK_URL_TTL_OVERRIDE).toBe(
      (MIN_CAPTURES_PER_SLICE * PER_CAPTURE_BUDGET_MS) / 1000 + STORYBOOK_URL_TTL_GRACE,
    );
    expect(storybookUrlTtlOverrideError(MIN_STORYBOOK_URL_TTL_OVERRIDE)).toBeUndefined();
    expect(storybookUrlTtlOverrideError(MAX_STORYBOOK_URL_TTL)).toBeUndefined();
  });

  it("names the floor when refusing too short, too long or fractional values", () => {
    for (const bad of [60, MIN_STORYBOOK_URL_TTL_OVERRIDE - 1, MAX_STORYBOOK_URL_TTL + 1, 1500.5]) {
      expect(storybookUrlTtlOverrideError(bad)).toContain(String(MIN_STORYBOOK_URL_TTL_OVERRIDE));
    }
  });
});
