import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_INLINE_UNZIP_SIZE,
  DEFAULT_MAX_UNZIPPED_BYTES,
  DEFAULT_MAX_ZIP_ENTRIES,
  extractionLimitsOf,
  publishRoute,
  resolvePublishLimits,
} from "./limits.ts";

describe("resolvePublishLimits", () => {
  it("applies the safe defaults when nothing is configured", () => {
    expect(resolvePublishLimits()).toEqual({
      inlineBytes: DEFAULT_MAX_INLINE_UNZIP_SIZE,
      maxEntries: DEFAULT_MAX_ZIP_ENTRIES,
      maxBytes: DEFAULT_MAX_UNZIPPED_BYTES,
    });
    expect(DEFAULT_MAX_INLINE_UNZIP_SIZE).toBe(50 * 1024 * 1024);
  });

  it("takes configured values, and 0 inline bytes as 'never inline'", () => {
    const limits = resolvePublishLimits({
      maxInlineUnzipSize: 0,
      maxZipEntries: 10,
      maxUnzippedBytes: 99,
    });
    expect(limits).toEqual({ inlineBytes: 0, maxEntries: 10, maxBytes: 99 });
    expect(extractionLimitsOf(limits)).toEqual({ maxEntries: 10, maxBytes: 99 });
  });
});

describe("publishRoute", () => {
  it("extracts inline up to the threshold and uses a job above it", () => {
    expect(publishRoute(100, { inlineBytes: 100 })).toBe("inline");
    expect(publishRoute(101, { inlineBytes: 100 })).toBe("job");
    expect(publishRoute(1, { inlineBytes: 0 })).toBe("job");
  });
});
