import { describe, expect, it } from "vitest";
import { formatRelative } from "./time.tsx";

const now = new Date("2026-10-05T12:00:00.000Z");
const ago = (seconds: number): Date => new Date(now.getTime() - seconds * 1000);

describe("formatRelative", () => {
  it.each([
    [10, "just now"],
    [44, "just now"],
    [60, "1 min ago"],
    [59 * 60, "59 min ago"],
    [3600, "1 h ago"],
    [23 * 3600, "23 h ago"],
    [86_400, "1 d ago"],
    [6 * 86_400, "6 d ago"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatRelative(ago(seconds), now)).toBe(expected);
  });

  it("uses an ISO date after a week", () => {
    expect(formatRelative(ago(30 * 86_400), now)).toBe("2026-09-05");
  });

  it("treats timestamps from the future as just now", () => {
    expect(formatRelative(new Date(now.getTime() + 60_000), now)).toBe("just now");
  });

  it("accepts ISO strings and flags invalid input", () => {
    expect(formatRelative(ago(120).toISOString(), now)).toBe("2 min ago");
    expect(formatRelative("nope", now)).toBe("unknown");
  });
});
