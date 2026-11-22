import { describe, expect, it } from "vitest";
import { createReporter, formatDuration, isInteractive } from "./output.ts";

describe("formatDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(-5)).toBe("0.0s");
  });
});

describe("isInteractive", () => {
  it("needs a terminal and no CI", () => {
    expect(isInteractive({}, true)).toBe(true);
    expect(isInteractive({ CI: "true" }, true)).toBe(false);
    expect(isInteractive({}, false)).toBe(false);
  });
});

function reporter(): { lines: string[]; reporter: ReturnType<typeof createReporter> } {
  const lines: string[] = [];
  let clock = 0;
  return {
    lines,
    reporter: createReporter({
      write: (text) => lines.push(text),
      now: () => (clock += 400),
      interactive: false,
    }),
  };
}

describe("createReporter", () => {
  it("brackets a phase with its time", async () => {
    const { lines, reporter: report } = reporter();
    await expect(
      report.phase("Writing", "Wrote", async () => await Promise.resolve(7)),
    ).resolves.toBe(7);
    expect(lines).toEqual(["==> Writing\n", "--> Wrote (0.4s)\n"]);
  });

  it("says a phase failed and rethrows the same error", async () => {
    const { lines, reporter: report } = reporter();
    const boom = new Error("boom");
    await expect(report.phase("Writing", "Wrote", () => Promise.reject(boom))).rejects.toBe(boom);
    expect(lines.at(-1)).toBe("--> Failed: Writing (0.4s)\n");
  });
});
