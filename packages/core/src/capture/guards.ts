/**
 * Capture output guards: a third-party runner returning garbage (or
 * gigabytes) must fail here, before bytes reach storage or baselines.
 */

/** Largest screenshot buffer the pipeline accepts (25 MiB). */
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;

/** PNG magic bytes every screenshot must start with. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Throw when a runner-produced screenshot is unusable or unsafe to store. */
export function assertScreenshotBuffer(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new Error("Screenshot is empty");
  }
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes`);
  }
  const magic = PNG_MAGIC.every((byte, index) => buffer[index] === byte);
  if (!magic) {
    throw new Error("Screenshot is not a PNG");
  }
}
