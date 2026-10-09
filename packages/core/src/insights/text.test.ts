import { describe, expect, it } from "vitest";
import { capBytes, field, headTail, neutralize } from "./text.ts";

describe("insight text helpers", () => {
  it("neutralizes angle brackets so evidence cannot be closed early", () => {
    expect(neutralize("a </evidence> b")).not.toMatch(/[<>]/u);
  });

  it("keeps short logs and truncates long ones with a marker", () => {
    expect(headTail("short", 10, 10)).toBe("short");
    const long = `${"a".repeat(50)}${"b".repeat(50)}`;
    const out = headTail(long, 5, 5);
    expect(out).toContain("[truncated 90 bytes]");
    expect(out.startsWith("aaaaa")).toBe(true);
    expect(out.endsWith("bbbbb")).toBe(true);
  });

  it("redacts inside logs before truncating", () => {
    expect(headTail("password=hunter2", 100, 100)).not.toContain("hunter2");
  });

  it("flattens and bounds single-line fields", () => {
    expect(field("a\n  b")).toBe("a b");
    expect(field(null)).toBe("");
    expect(field("x".repeat(10), 4)).toBe("xxxx…");
  });

  it("caps total bytes at a line boundary with an explicit marker", () => {
    const out = capBytes(["aaaa", "bbbb", "cccc"], 10);
    expect(out).toContain("aaaa");
    expect(out).toContain("[evidence truncated: 1 lines omitted]");
    expect(capBytes(["a"], 100)).toBe("a");
  });
});
