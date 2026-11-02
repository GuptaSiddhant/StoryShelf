import { describe, expect, it } from "vitest";
import { SIGNED_NO_STORE, signedCacheControl } from "./capture-cache.ts";

const NOW = Date.UTC(2026, 0, 1);
const nowSeconds = NOW / 1000;
const grant = (remaining: number, purpose: "capture" | "none" = "capture") => ({
  expiresAt: nowSeconds + remaining,
  ...(purpose === "none" ? {} : { purpose }),
});
const decide = (
  input: Partial<Parameters<typeof signedCacheControl>[0]> & { remaining?: number },
): string =>
  signedCacheControl({
    cacheMaxAgeSeconds: 600,
    grant: grant(input.remaining ?? 7200),
    immutable: true,
    now: NOW,
    ...input,
  });

/** The answer for a 100 s grant `elapsedMs` after it was minted, with a one-hour cap. */
const at = (elapsedMs: number): string =>
  signedCacheControl({
    cacheMaxAgeSeconds: 3600,
    grant: grant(100),
    immutable: true,
    now: NOW + elapsedMs,
  });

describe("signedCacheControl", () => {
  it("is no-store unless the server opted in", () => {
    expect(decide({ cacheMaxAgeSeconds: undefined })).toBe(SIGNED_NO_STORE);
    expect(decide({ cacheMaxAgeSeconds: 0 })).toBe(SIGNED_NO_STORE);
    expect(decide({ cacheMaxAgeSeconds: -5 })).toBe(SIGNED_NO_STORE);
  });

  it("is private max-age at the configured cap when the grant outlives it", () => {
    expect(decide({ cacheMaxAgeSeconds: 600 })).toBe("private, max-age=600");
    expect(decide({ cacheMaxAgeSeconds: 1 })).toBe("private, max-age=1");
  });

  it("never exceeds one hour, even for a larger cap", () => {
    expect(decide({ cacheMaxAgeSeconds: 7200 })).toBe("private, max-age=3600");
    expect(decide({ cacheMaxAgeSeconds: 3600, remaining: 86_400 })).toBe("private, max-age=3600");
  });

  it("is capped by the grant's remaining lifetime, floored to whole seconds", () => {
    expect(decide({ cacheMaxAgeSeconds: 3600, remaining: 120 })).toBe("private, max-age=120");
    expect(decide({ cacheMaxAgeSeconds: 3600, remaining: 90.9 })).toBe("private, max-age=90");
    expect(decide({ cacheMaxAgeSeconds: 600, remaining: 599 })).toBe("private, max-age=599");
  });

  it("is no-store when under a second of the grant is left, or none", () => {
    expect(decide({ remaining: 0.9 })).toBe(SIGNED_NO_STORE);
    expect(decide({ remaining: 0 })).toBe(SIGNED_NO_STORE);
    expect(decide({ remaining: -30 })).toBe(SIGNED_NO_STORE);
  });

  it("follows the clock, so freshness shrinks as the grant ages", () => {
    expect(at(0)).toBe("private, max-age=100");
    expect(at(40_000)).toBe("private, max-age=60");
    expect(at(99_500)).toBe(SIGNED_NO_STORE);
    expect(at(100_000)).toBe(SIGNED_NO_STORE);
  });

  it("is no-store for a grant without the capture purpose, or no grant at all", () => {
    expect(decide({ grant: grant(7200, "none") })).toBe(SIGNED_NO_STORE);
    expect(decide({ grant: undefined })).toBe(SIGNED_NO_STORE);
  });

  it("is no-store for a file that is not content-addressed", () => {
    expect(decide({ immutable: false })).toBe(SIGNED_NO_STORE);
  });
});
