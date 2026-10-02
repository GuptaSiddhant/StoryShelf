import { describe, expect, it } from "vitest";
import { assertScreenshotBuffer, MAX_SCREENSHOT_BYTES } from "./guards.ts";

function png(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
}

describe("assertScreenshotBuffer", () => {
  it("accepts a PNG within budget", () => {
    expect(() => assertScreenshotBuffer(png(1024))).not.toThrow();
  });

  it("rejects empty buffers", () => {
    expect(() => assertScreenshotBuffer(Buffer.alloc(0))).toThrow("empty");
  });

  it("rejects non-PNG bytes", () => {
    expect(() => assertScreenshotBuffer(Buffer.from("not-an-image"))).toThrow("not a PNG");
  });

  it("rejects oversize buffers", () => {
    expect(() => assertScreenshotBuffer(png(MAX_SCREENSHOT_BYTES + 1))).toThrow("exceeds");
  });
});
