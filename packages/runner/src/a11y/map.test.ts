import { describe, expect, it } from "vitest";
import { mapAxeViolations, MAX_REPORTED_VIOLATIONS, type SlimViolation } from "./map.ts";

function v(over: Partial<SlimViolation> = {}): SlimViolation {
  return {
    id: "image-alt",
    impact: "critical",
    help: "Images must have alternative text",
    target: "img",
    count: 1,
    ...over,
  };
}

describe("mapAxeViolations", () => {
  it("formats rule, impact, help, target and node count", () => {
    expect(mapAxeViolations([v(), v({ id: "a", impact: null, count: 3 })])).toEqual([
      "image-alt (critical): Images must have alternative text [img] 1 node",
      "a (unknown): Images must have alternative text [img] 3 nodes",
    ]);
  });

  it("sorts worst impact first, then by id", () => {
    const out = mapAxeViolations([
      v({ id: "b", impact: "minor" }),
      v({ id: "z", impact: "serious" }),
      v({ id: "a", impact: "serious" }),
      v({ id: "c", impact: "critical" }),
    ]);
    expect(out.map((l) => l.split(" ")[0])).toEqual(["c", "a", "z", "b"]);
  });

  it("truncates selectors and help, and never emits ';' or newlines", () => {
    const [line] = mapAxeViolations([v({ target: "x".repeat(200), help: "a;b\nc" })]);
    expect(line).toContain("a,b c");
    expect(line).not.toContain(";");
    expect(line?.length).toBeLessThan(220);
    expect(line).toContain("…");
  });

  it("caps the list and reports the remainder", () => {
    const many = Array.from({ length: MAX_REPORTED_VIOLATIONS + 4 }, (_, i) =>
      v({ id: `r${String(i).padStart(2, "0")}` }),
    );
    const out = mapAxeViolations(many);
    expect(out).toHaveLength(MAX_REPORTED_VIOLATIONS + 1);
    expect(out.at(-1)).toBe("…and 4 more");
  });

  it("returns nothing for a clean page", () => {
    expect(mapAxeViolations([])).toEqual([]);
  });
});
