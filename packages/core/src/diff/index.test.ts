// oxlint-disable typescript/no-deprecated -- this file exists to cover the deprecated alias
import { afterEach, describe, expect, it } from "vitest";
import { configureDiffPool, diffImagesAsync, shutdownDiffPool } from "./index.ts";

afterEach(async () => {
  await shutdownDiffPool();
  configureDiffPool({});
});

describe("core/diff compatibility surface", () => {
  it("keeps configureDiffPool working as an alias for configureImages", async () => {
    configureDiffPool({ threads: 0 });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    );
    const result = await diffImagesAsync(png, Buffer.from(png), {
      pixelThreshold: 0.1,
      maxDiffRatio: 0,
      includeAntialiasing: false,
      failOnSizeChange: true,
    });
    expect(result.passed).toBe(true);
  });
});
