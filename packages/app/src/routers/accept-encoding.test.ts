import { describe, expect, it } from "vitest";
import { acceptedEncodings, acceptsGzip } from "./accept-encoding.ts";

describe("accepted encodings", () => {
  it("puts brotli before gzip when both are accepted", () => {
    expect(acceptedEncodings("gzip, br")).toEqual(["br", "gzip"]);
    expect(acceptedEncodings("gzip, deflate, br, zstd")).toEqual(["br", "gzip"]);
    expect(acceptedEncodings("*")).toEqual(["br", "gzip"]);
  });

  it("orders by quality and lets an explicit coding beat the wildcard", () => {
    expect(acceptedEncodings("br;q=0.5, gzip;q=0.9")).toEqual(["gzip", "br"]);
    expect(acceptedEncodings("*;q=1, br;q=0")).toEqual(["gzip"]);
    expect(acceptedEncodings("*;q=0.1, gzip")).toEqual(["gzip", "br"]);
  });

  it("refuses a coding with q=0 or an invalid quality, and offers nothing without a header", () => {
    expect(acceptedEncodings("br;q=0, gzip;q=0")).toEqual([]);
    expect(acceptedEncodings("br;q=2, gzip;q=abc")).toEqual([]);
    expect(acceptedEncodings("deflate")).toEqual([]);
    expect(acceptedEncodings()).toEqual([]);
    expect(acceptedEncodings("")).toEqual([]);
  });

  it("keeps the gzip answer", () => {
    expect(acceptsGzip("br, gzip;q=0.5")).toBe(true);
    expect(acceptsGzip("br")).toBe(false);
    expect(acceptsGzip("*;q=1, gzip;q=0")).toBe(false);
  });
});
