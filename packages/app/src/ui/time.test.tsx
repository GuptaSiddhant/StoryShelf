import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { describe, expect, it } from "vitest";
import { Time, formatRelative } from "./time.tsx";

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

const STAMP = "2026-01-15T23:30:00.000Z";

const render = async (node: Child): Promise<string> => {
  const app = new Hono().get("/", (c) => c.html(<>{node}</>));
  return await (await app.request("/")).text();
};

const renderAll = async (): Promise<string> =>
  await render(
    <>
      <Time value={STAMP} />
      <Time value={STAMP} format="date" />
      <Time value={STAMP} format="time" />
    </>,
  );

/** Renders under a process time zone, restoring the previous one. */
async function renderUnder(tz: string): Promise<string> {
  const original = process.env["TZ"];
  process.env["TZ"] = tz;
  try {
    return await renderAll();
  } finally {
    if (original === undefined) {
      delete process.env["TZ"];
    } else {
      process.env["TZ"] = original;
    }
  }
}

describe("Time", () => {
  it("renders the same HTML under two TZ values", async () => {
    const auckland = await renderUnder("Pacific/Auckland");
    const la = await renderUnder("America/Los_Angeles");
    expect(auckland).toBe(la);
    expect(auckland).toContain(`datetime="${STAMP}"`);
    expect(auckland).toContain("Jan 15, 2026");
    expect(auckland).toContain("UTC");
  });

  it("flags invalid input without a datetime attribute", async () => {
    const html = await render(<Time value="nope" />);
    expect(html).toContain("unknown");
    expect(html).not.toContain("datetime=");
  });
});
